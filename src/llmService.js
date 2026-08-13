const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROVIDER_ICONS = Object.freeze({
  codex: '../assets/providers/codex.svg',
  cursor: '../assets/providers/cursor.svg',
  claude: '../assets/providers/claude.svg',
  anthropic: '../assets/providers/claude.svg',
  'anthropic-claude': '../assets/providers/claude.svg',
  gemini: '../assets/providers/gemini.svg',
  'google-gemini': '../assets/providers/gemini.svg',
  grok: '../assets/providers/grok.svg',
  xai: '../assets/providers/grok.svg',
  chatgpt: '../assets/providers/chatgpt.svg',
  'chat-gpt': '../assets/providers/chatgpt.svg',
  openai: '../assets/providers/chatgpt.svg',
  'openai-chat-gpt': '../assets/providers/chatgpt.svg'
});

const PROVIDER_LABELS = Object.freeze({
  codex: 'Codex',
  cursor: 'Cursor',
  claude: 'Claude',
  anthropic: 'Claude',
  'anthropic-claude': 'Claude',
  gemini: 'Gemini',
  'google-gemini': 'Gemini',
  grok: 'Grok',
  xai: 'Grok',
  chatgpt: 'ChatGPT',
  'chat-gpt': 'ChatGPT',
  openai: 'ChatGPT',
  'openai-chat-gpt': 'ChatGPT'
});

const CODEX_ICON = PROVIDER_ICONS.codex;
const STATE_VERSION = 2;

// Providers with an exported CLI datasource bundle that can create and resume sessions.
const WRITABLE_PROVIDERS = Object.freeze({
  codex: { bundle: 'codex', label: 'Codex' },
  claude: { bundle: 'claude', label: 'Claude' }
});
const DEFAULT_PROVIDER = 'codex';

// A single agent turn ("generate a whole new app", not just "fix this typo") can
// legitimately run far longer than the datasource's own 10-minute connection default -
// send an explicit per-turn timeout through the request so the CLI subprocess itself is
// given this budget (see SubjectiveClaudeCliDataSource/SubjectiveCodexDataSource
// handle_message), and give the outer process wrapper a little more than that so it never
// cuts the run off before the datasource's own timeout has a chance to report cleanly.
const AGENT_TURN_TIMEOUT_SECONDS = 1800;
const AGENT_TURN_WRAPPER_TIMEOUT_SECONDS = AGENT_TURN_TIMEOUT_SECONDS + 60;

function providerKey(provider) {
  return String(provider || 'unknown').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function providerIcon(provider) {
  return PROVIDER_ICONS[providerKey(provider)] || '';
}

function providerLabel(provider) {
  const key = providerKey(provider);
  return PROVIDER_LABELS[key] || String(provider || 'Unknown');
}

function writableProvider(provider) {
  return WRITABLE_PROVIDERS[providerKey(provider)] || null;
}

function epochMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function normalizeRole(role) {
  const value = String(role || '').toLowerCase();
  if (value === 'assistant' || value === 'agent') return 'assistant';
  if (value === 'user' || value === 'human') return 'user';
  if (value === 'tool') return 'tool';
  if (value === 'tool_output' || value === 'output') return 'tool_output';
  return 'system';
}

function latestMessageTime(messages) {
  return messages.reduce((latest, message) => Math.max(latest, epochMs(message.time || message.timestamp)), 0);
}

function exportFilenameTime(filePath) {
  const match = path.basename(String(filePath || '')).match(/^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_/);
  if (!match) return 0;
  return Date.UTC(...match.slice(1).map(Number).map((value, index) => index === 1 ? value - 1 : value));
}

function conversationKey(item) {
  return `${item.provider}:${item.sessionId || item.sourceFile || item.target}`;
}

function ircChannelName(label, identity, provider = DEFAULT_PROVIDER) {
  const slug = String(label || 'chat').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'chat';
  const suffix = crypto.createHash('sha1').update(String(identity)).digest('hex').slice(0, 8);
  return `#${providerKey(provider) || DEFAULT_PROVIDER}-${slug}-${suffix}`;
}

class LlmService {
  constructor(options = {}) {
    this.root = options.root || path.resolve(__dirname, '..');
    this.appHome = options.appHome
      || process.env.SUBJECTIVE_CHAT_HOME
      || (options.statePath ? path.dirname(options.statePath) : path.join(os.homedir(), '.subjective_chat'));
    this.codexHome = path.join(this.appHome, '.subjective_chat_codex');
    this.historyHome = path.join(this.appHome, '.subjective_chat_history');
    this.contextDir = options.contextDir
      || path.join(this.historyHome, 'context');
    this.statePath = options.statePath || path.join(this.appHome, 'llm-conversations.json');
    const virtualenvPython = process.platform === 'win32'
      ? path.join(this.root, '.venv', 'Scripts', 'python.exe')
      : path.join(this.root, '.venv', 'bin', 'python');
    this.pythonPath = options.pythonPath
      || process.env.SUBJECTIVE_CHAT_PYTHON
      || (fs.existsSync(virtualenvPython) ? virtualenvPython : 'python3');
    this.codexRuntime = options.codexRuntime || path.join(this.root, 'pipelines', 'codex', 'run.py');
    this.claudeRuntime = options.claudeRuntime || path.join(this.root, 'pipelines', 'claude', 'run.py');
    this.historyRuntime = options.historyRuntime || path.join(this.root, 'pipelines', 'history', 'run.py');
    this.pipelineRuntime = options.pipelineRuntime || path.join(this.root, 'src', 'pipeline_runtime.py');
    this.spawn = options.spawn || spawn;
    // Optional: only needed for conversations with `osUser` set ("Continue as…").
    // Passed in from main.js to avoid a circular require between llmService.js and
    // suSessionManager.js.
    this.suSessionManager = options.suSessionManager || null;
    this.busy = new Set();
    fs.mkdirSync(this.appHome, { recursive: true });
    const saved = this._loadState();
    this.local = saved.conversations;
    this.activeTargets = new Set(saved.activeTargets);
    // User-assigned chat names, keyed by conversation target. Kept separate from the
    // conversation records so a rename survives across history re-imports (which rebuild
    // read-only conversations from disk on every listing).
    this.labelOverrides = saved.labelOverrides || {};
    if (saved.migrated) {
      const backupPath = `${this.statePath}.v1-backup`;
      if (fs.existsSync(this.statePath) && !fs.existsSync(backupPath)) {
        fs.copyFileSync(this.statePath, backupPath);
      }
      this._saveState();
    }
  }

  _loadState() {
    const payload = safeJson(this.statePath);
    if (!payload || !Array.isArray(payload.conversations)) {
      return { conversations: [], activeTargets: [], migrated: false, labelOverrides: {} };
    }
    const oldVersion = Number(payload.version || 1);
    let migrated = false;
    const conversations = payload.conversations.map((item) => {
      if (oldVersion >= STATE_VERSION || !item?.sourceFile || !item?.exportPath) return item;
      const messages = Array.isArray(item.messages) ? item.messages : [];
      const importedCount = Math.max(0, Number(item.messageCount || 0));
      if (importedCount > messages.length) return item;
      migrated = true;
      return {
        ...item,
        historyExportPath: item.exportPath,
        messages: messages.slice(importedCount)
      };
    });
    return {
      conversations: conversations.map((item) => this._normalizeConversation(item, 'local')).filter(Boolean),
      activeTargets: Array.isArray(payload.activeTargets) ? payload.activeTargets.map(String) : [],
      migrated,
      labelOverrides: (payload.labelOverrides && typeof payload.labelOverrides === 'object') ? { ...payload.labelOverrides } : {}
    };
  }

  _saveState() {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({
      version: STATE_VERSION,
      conversations: this.local,
      activeTargets: [...this.activeTargets].slice(-20),
      labelOverrides: this.labelOverrides
    }, null, 2)}\n`);
    fs.renameSync(temporary, this.statePath);
  }

  _normalizeConversation(payload, origin = 'history', filePath = '') {
    if (!payload || (origin === 'history' && payload.type !== 'localchat')) return null;
    const provider = String(payload.provider || payload.product || 'unknown').toLowerCase();
    const sessionId = String(payload.sessionId || payload.thread_id || payload.session_id || '');
    const sourceFile = String(payload.sourceFile || payload.source_file || filePath || '');
    const identity = sessionId || sourceFile || crypto.randomUUID();
    const target = String(payload.target || `llm:${provider}:${Buffer.from(identity).toString('base64url')}`);
    const messages = (payload.messages || []).map((message) => ({
      role: normalizeRole(message.role),
      kind: String(message.kind || 'message'),
      text: String(message.text || message.content || ''),
      command: String(message.command || ''),
      shell: String(message.shell || ''),
      toolName: String(message.toolName || message.tool_name || ''),
      workdir: String(message.workdir || ''),
      time: epochMs(message.time || message.timestamp) || Date.now()
    })).filter((message) => message.text || message.command);
    const messageUpdatedAt = latestMessageTime(messages);
    const contentUpdatedAt = Math.max(
      epochMs(payload.updatedAt || payload.source_mtime || payload.source_timestamp),
      messageUpdatedAt
    );
    const updatedAt = contentUpdatedAt
      || (filePath && fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0);
    const workspace = String(payload.workspace || payload.cwd || this.root);
    const createdAt = epochMs(payload.createdAt || payload.chat_started_at || payload.chat_started_timestamp) || updatedAt || Date.now();
    const sortAt = epochMs(payload.sortAt || payload.sort_at) || messageUpdatedAt || createdAt || updatedAt;
    return {
      target,
      label: String(payload.label || payload.title || payload.chat_name || `${provider} conversation`),
      description: String(payload.description || `${provider} ${payload.kind || 'chat'}`),
      kind: 'llm',
      provider,
      sessionId,
      sourceFile,
      exportPath: String(payload.exportPath || filePath || ''),
      historyExportPath: String(payload.historyExportPath || payload.history_export_path || ''),
      messageCount: Number(payload.messageCount ?? payload.message_count ?? messages.length),
      workspace,
      ircChannel: String(payload.ircChannel || ircChannelName(payload.label || payload.title || payload.chat_name, identity, provider)),
      messages,
      updatedAt: updatedAt || Date.now(),
      createdAt,
      sortAt,
      writable: Boolean(writableProvider(provider)),
      origin,
      // Which OS user this conversation's CLI calls should run as. Omitted/null means the
      // OS user currently running Subjective Chat - the default, and the only value every
      // conversation had before "Continue as…" existed, so this is a purely additive field.
      osUser: payload.osUser ? String(payload.osUser) : null,
      icon: providerIcon(provider),
      participants: [
        { nick: 'You', modes: '' },
        { nick: providerLabel(provider), modes: 'bot' }
      ],
      loaded: payload.loaded !== false
    };
  }

  _historyConversations() {
    if (!fs.existsSync(this.contextDir)) return [];
    const manifestPath = path.join(this.contextDir, '.subjective_localchats_manifest.json');
    const manifest = safeJson(manifestPath);
    if (manifest?.sources && typeof manifest.sources === 'object') {
      return Object.values(manifest.sources).map((record) => {
        const fingerprint = record.fingerprint || {};
        const sourceFile = String(record.source_file || fingerprint.source_file || '');
        const sessionMatch = sourceFile.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        const exportPath = path.join(this.contextDir, path.basename(record.export_filename || record.export_path || ''));
        const filenameTimestamp = exportFilenameTime(exportPath);
        return this._normalizeConversation({
          type: 'localchat',
          title: record.title || path.basename(sourceFile),
          product: fingerprint.product || 'unknown',
          kind: fingerprint.kind || 'chat',
          thread_id: sessionMatch?.[1] || '',
          source_file: sourceFile,
          source_mtime: Number(fingerprint.mtime_ns || 0) / 1e9,
          chat_started_at: filenameTimestamp / 1000,
          sort_at: filenameTimestamp,
          messages: [],
          messageCount: Number(record.message_count || 0),
          exportPath,
          loaded: false
        }, 'history', exportPath);
      }).filter((conversation) => conversation && fs.existsSync(conversation.exportPath));
    }
    const conversations = [];
    const directory = fs.opendirSync(this.contextDir);
    let entry;
    while ((entry = directory.readSync()) !== null) {
      const name = entry.name;
      if (!entry.isFile() || !name.includes('-Localchats-') || !name.endsWith('-context.json')) continue;
      const filePath = path.join(this.contextDir, name);
      const payload = safeJson(filePath);
      const conversation = this._normalizeConversation(payload, 'history', filePath);
      if (conversation) conversations.push(conversation);
    }
    directory.closeSync();
    return conversations;
  }

  listConversations(options = {}) {
    const includeMessages = options.includeMessages === true;
    const deduplicated = new Map();
    for (const conversation of [...this._historyConversations(), ...this.local]) {
      const key = conversationKey(conversation);
      const previous = deduplicated.get(key);
      if (!previous || conversation.updatedAt >= previous.updatedAt || conversation.origin === 'local') {
        deduplicated.set(key, conversation);
      }
    }
    return [...deduplicated.values()]
      .sort((left, right) => (right.sortAt || right.updatedAt) - (left.sortAt || left.updatedAt))
      .map((conversation) => this._withLabelOverride(includeMessages ? this._hydrateLocalConversation(conversation) : {
        ...conversation,
        messages: [],
        loaded: conversation.origin === 'local' && conversation.messages.length === 0,
        activeOnIrc: this.activeTargets.has(conversation.target)
      }));
  }

  // Apply a user-assigned name (see this.labelOverrides) to a conversation record without
  // mutating the underlying object, so the override wins over the title derived from disk.
  _withLabelOverride(conversation) {
    if (!conversation) return conversation;
    const override = this.labelOverrides[conversation.target];
    if (!override || override === conversation.label) return conversation;
    return { ...conversation, label: override };
  }

  // Rename a chat. Works for both writable (local) and read-only (history) conversations:
  // the local record is updated in place when present, and the override map guarantees the
  // name persists even for history conversations that are rebuilt from disk on each listing.
  renameConversation(target, name) {
    const key = String(target || '');
    if (!key) return { ok: false, error: 'Missing conversation target.' };
    const clean = String(name || '').trim().slice(0, 200);
    if (!clean) return { ok: false, error: 'Name cannot be empty.' };
    const local = this.local.find((conversation) => conversation.target === key);
    if (local) local.label = clean;
    this.labelOverrides[key] = clean;
    this._saveState();
    return { ok: true, conversation: this.findConversation(key) };
  }

  _runtimeFor(provider) {
    return providerKey(provider) === 'claude' ? this.claudeRuntime : this.codexRuntime;
  }

  createConversation(input = {}) {
    const now = Date.now();
    const provider = writableProvider(input.provider) ? providerKey(input.provider) : DEFAULT_PROVIDER;
    const label = providerLabel(provider);
    const conversation = this._normalizeConversation({
      target: `llm:${provider}:local:${crypto.randomUUID()}`,
      provider,
      label: String(input.name || `New ${label} chat`).trim() || `New ${label} chat`,
      description: `${label} CLI conversation`,
      workspace: String(input.workspace || this.root).trim() || this.root,
      messages: [],
      createdAt: now,
      updatedAt: now,
      loaded: true
    }, 'local');
    this.local.unshift(conversation);
    this.markActive(conversation.target);
    this._saveState();
    return conversation;
  }

  // "Continue as <username>" creates a fresh sibling conversation rather than mutating
  // the source in place. This is not just a UI choice: Codex/Claude's own session store
  // (~/.codex, ~/.claude) lives under whichever OS user's $HOME the CLI actually runs as,
  // so a sessionId created as one OS user cannot be resumed as another - there is no
  // shared session to continue across that boundary, only a fresh one to start.
  createSiblingForUser(sourceTarget, username) {
    const source = this.findConversation(sourceTarget, { includeMessages: false });
    if (!source) throw new Error('Conversation was not found.');
    if (!writableProvider(source.provider)) throw new Error(`${source.provider} has no writable datasource.`);
    const now = Date.now();
    const conversation = this._normalizeConversation({
      target: `llm:${source.provider}:local:${crypto.randomUUID()}`,
      provider: source.provider,
      label: `${source.label} (as ${username})`,
      description: `${source.description} — continued as ${username}`,
      workspace: source.workspace,
      osUser: username,
      messages: [],
      createdAt: now,
      updatedAt: now,
      loaded: true
    }, 'local');
    this.local.unshift(conversation);
    this.markActive(conversation.target);
    this._saveState();
    return conversation;
  }

  findConversation(target, options = {}) {
    const local = this.local.find((conversation) => conversation.target === target);
    if (local) return this._withLabelOverride(options.includeMessages === true ? this._hydrateLocalConversation(local) : local);
    const metadata = this.listConversations().find((conversation) => conversation.target === target) || null;
    if (!metadata || options.includeMessages !== true || !metadata.exportPath) return metadata;
    const payload = safeJson(metadata.exportPath);
    if (!payload) return metadata;
    return this._withLabelOverride(this._normalizeConversation({ ...payload, target: metadata.target, exportPath: metadata.exportPath, loaded: true }, 'history', metadata.exportPath));
  }

  _hydrateLocalConversation(conversation) {
    if (!conversation || conversation.origin !== 'local' || !conversation.historyExportPath) return conversation;
    const payload = safeJson(conversation.historyExportPath);
    if (!payload) return conversation;
    const history = this._normalizeConversation({
      ...payload,
      target: conversation.target,
      exportPath: conversation.historyExportPath,
      loaded: true
    }, 'history', conversation.historyExportPath);
    if (!history) return conversation;

    const historyTimes = new Map();
    for (const message of history.messages) {
      const signature = `${message.role}\0${message.command || message.text}`;
      const times = historyTimes.get(signature) || [];
      times.push(Number(message.time || 0));
      historyTimes.set(signature, times);
    }
    const localOnly = conversation.messages.filter((message) => {
      const signature = `${message.role}\0${message.command || message.text}`;
      const matches = historyTimes.get(signature) || [];
      return !matches.some((time) => Math.abs(time - Number(message.time || 0)) <= 300000);
    });
    const messages = [...history.messages, ...localOnly]
      .sort((left, right) => Number(left.time || 0) - Number(right.time || 0));
    return {
      ...conversation,
      messages,
      messageCount: messages.length,
      loaded: true
    };
  }

  markActive(target) {
    this.activeTargets.delete(target);
    this.activeTargets.add(target);
    while (this.activeTargets.size > 20) this.activeTargets.delete(this.activeTargets.values().next().value);
    this._saveState();
  }

  async status(provider = DEFAULT_PROVIDER) {
    const key = writableProvider(provider) ? providerKey(provider) : DEFAULT_PROVIDER;
    const result = this._pipelineResult(await this._runPipeline(this._runtimeFor(key), { action: 'status' }, 30));
    return { provider: key, ...result };
  }

  async refreshHistory() {
    const response = await this._runPipeline(this.historyRuntime, {
      context_folder: this.contextDir,
      max_files: 0
    }, 1800);
    return this._pipelineResult(response);
  }

  async sendMessage(target, text, files = []) {
    const clean = String(text || '').trim();
    if (!clean) return { ok: false, status: 'invalid_request', error: 'Message is empty.' };
    const source = this.findConversation(target, { includeMessages: true });
    if (!source) return { ok: false, status: 'not_found', error: 'Conversation was not found.' };
    const provider = writableProvider(source.provider);
    if (!provider) return { ok: false, status: 'read_only', error: `${source.provider} history has no writable datasource.` };
    if (this.busy.has(target)) return { ok: false, status: 'busy', error: `${provider.label} is already responding in this conversation.` };

    let conversation = this.local.find((item) => item.target === target);
    if (!conversation) {
      conversation = {
        ...source,
        origin: 'local',
        historyExportPath: source.exportPath,
        messageCount: source.messages.length,
        messages: []
      };
      this.local.unshift(conversation);
    }

    // "Continue as <osUser>" conversations must run through that user's own connected
    // session (see suSessionManager.js) rather than the OS user Subjective Chat itself
    // is running as. Check this before touching the transcript/busy state, same as the
    // read_only/busy checks above, so a not-connected user never leaves a dangling
    // "sent" message behind.
    const runningAsOtherUser = Boolean(conversation.osUser) && conversation.osUser !== os.userInfo().username;
    if (runningAsOtherUser) {
      const sessionStatus = this.suSessionManager ? this.suSessionManager.getStatus(conversation.osUser) : { status: 'idle' };
      if (sessionStatus.status !== 'ready') {
        return {
          ok: false,
          status: 'os_user_not_connected',
          error: `Reconnect as ${conversation.osUser} first (right-click the conversation).`
        };
      }
    }

    const userMessage = { role: 'user', text: clean, time: Date.now() };
    conversation.messages.push(userMessage);
    conversation.updatedAt = userMessage.time;
    conversation.sortAt = userMessage.time;
    this._saveState();
    this.busy.add(target);

    try {
      const request = {
        action: 'send',
        prompt: clean,
        files,
        session_id: conversation.sessionId,
        new_session: !conversation.sessionId,
        working_directory: conversation.workspace,
        timeout: AGENT_TURN_TIMEOUT_SECONDS
      };
      // Codex sandboxes per request; Claude takes an equivalent permission mode.
      if (provider.bundle === 'claude') {
        request.permission_mode = 'acceptEdits';
      } else {
        request.sandbox_mode = 'workspace-write';
      }
      const runtimePath = this._runtimeFor(source.provider);
      const pipelineResponse = runningAsOtherUser
        ? await this._runPipelineForUser(conversation.osUser, runtimePath, request, AGENT_TURN_WRAPPER_TIMEOUT_SECONDS)
        : await this._runPipeline(runtimePath, request, AGENT_TURN_WRAPPER_TIMEOUT_SECONDS);
      const result = this._pipelineResult(pipelineResponse);
      if (!result.success) return { ok: false, ...result, userMessage };
      conversation.sessionId = String(result.session_id || conversation.sessionId || '');
      const assistantMessage = { role: 'assistant', text: String(result.response || ''), time: Date.now() };
      conversation.messages.push(assistantMessage);
      conversation.updatedAt = assistantMessage.time;
      conversation.sortAt = assistantMessage.time;
      this._saveState();
      return {
        ok: true,
        result,
        conversation: this._hydrateLocalConversation(conversation),
        userMessage,
        assistantMessage
      };
    } finally {
      this.busy.delete(target);
    }
  }

  _pipelineResult(response) {
    if (!response?.success) return response || { success: false, status: 'runtime_error', error: 'Pipeline returned no response.' };
    const hasPipelineResult = response.result
      && typeof response.result === 'object'
      && Object.prototype.hasOwnProperty.call(response.result, 'pipeline_result');
    const result = hasPipelineResult ? response.result.pipeline_result : response.result;
    if (result && typeof result === 'object') return result;
    return { success: true, status: 'completed', result };
  }

  _runPipeline(runtimePath, payload, timeoutSeconds) {
    return new Promise((resolve) => {
      if (!fs.existsSync(runtimePath) || !fs.existsSync(this.pipelineRuntime)) {
        const missing = !fs.existsSync(runtimePath) ? runtimePath : this.pipelineRuntime;
        resolve({ success: false, status: 'runtime_missing', error: `Pipeline runtime is missing: ${missing}` });
        return;
      }
      const runtimeEnv = {
        ...process.env,
        SUBJECTIVE_CHAT_PIPELINE_PARENT_HOME: this.appHome
      };
      for (const key of [
        'USERDATA_PATH',
        'LOG_PATH',
        'CONTEXT_STORAGE',
        'DATASOURCES_TEMP_STORAGE',
        'DS_CONNECTION_TMP_SPACE',
        'DATASOURCES_PLUGIN_PATH',
        'SUBJECTIVE_PIPELINE_HOME'
      ]) delete runtimeEnv[key];
      const child = this.spawn(this.pythonPath, [
        this.pipelineRuntime,
        runtimePath,
        '--timeout',
        String(timeoutSeconds)
      ], {
        cwd: this.root,
        env: runtimeEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => resolve({ success: false, status: 'runtime_error', error: error.message }));
      child.on('close', () => resolve(this._parsePipelineOutput(stdout, stderr)));
      child.stdin.end(JSON.stringify(payload));
    });
  }

  _parsePipelineOutput(stdout, stderr) {
    try {
      const result = JSON.parse(stdout || '{}');
      if (!result.error && String(stderr || '').trim() && !result.success) result.error = String(stderr).trim();
      return result;
    } catch (_error) {
      return { success: false, status: 'runtime_error', error: String(stderr || '').trim() || String(stdout || '').trim() || 'Exported pipeline returned invalid JSON.' };
    }
  }

  // Routes the same one-shot pipeline invocation _runPipeline performs directly, but
  // through `osUser`'s already-authenticated background session (see suSessionManager.js)
  // instead of a subprocess of the current OS user. Only called once sendMessage() has
  // already confirmed that session is ready.
  async _runPipelineForUser(osUser, runtimePath, payload, timeoutSeconds) {
    if (!fs.existsSync(runtimePath) || !fs.existsSync(this.pipelineRuntime)) {
      const missing = !fs.existsSync(runtimePath) ? runtimePath : this.pipelineRuntime;
      return { success: false, status: 'runtime_missing', error: `Pipeline runtime is missing: ${missing}` };
    }
    try {
      const argv = [this.pythonPath, this.pipelineRuntime, runtimePath, '--timeout', String(timeoutSeconds)];
      const bridged = await this.suSessionManager.runInSession(osUser, argv, JSON.stringify(payload), {
        timeoutMs: timeoutSeconds * 1000 + 10000
      });
      return this._parsePipelineOutput(bridged.stdout, bridged.stderr);
    } catch (error) {
      return { success: false, status: 'runtime_error', error: error.message };
    }
  }
}

module.exports = {
  CODEX_ICON,
  PROVIDER_ICONS,
  WRITABLE_PROVIDERS,
  LlmService,
  epochMs,
  exportFilenameTime,
  ircChannelName,
  normalizeRole,
  providerIcon,
  providerLabel
};
