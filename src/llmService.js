const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { listProviderSessions, sessionsForProvider } = require('./providerSessions');
const { injectIntoCursorDom } = require('./cursorDomInject');

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
  claude: { bundle: 'claude', label: 'Claude' },
  cursor: { bundle: 'cursor', label: 'Cursor' }
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
const CURSOR_INJECT_POLL_MS = Number(process.env.CURSOR_INJECT_POLL_MS || 2000);
const CURSOR_INJECT_POLL_MAX_MS = Number(process.env.CURSOR_INJECT_POLL_MAX_MS || AGENT_TURN_TIMEOUT_SECONDS * 1000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

const ENVELOPE_TAG_NAMES = [
  'timestamp',
  'user_query',
  'user_info',
  'user_instructions',
  'system_notification',
  'system-reminder',
  'system_reminder',
  'environment_context',
  'git_status',
  'open_and_recently_viewed_files',
  'agent_skills',
  'image_files',
  'external_links',
  'attached_files'
];
const ENVELOPE_TAG_RE = new RegExp(`<(?:${ENVELOPE_TAG_NAMES.join('|')})_?\\b`, 'i');
const TASK_BLOCK_RE = /<task_?\b[^>]*>([\s\S]*?)<\/task_?>/i;
const TASK_TITLE_RE = /^\s*title:\s*(.+)$/im;
const INTERNAL_QUERY_RE = /^(?:briefly inform the user about the task result\b|the (?:above|following) task (?:has finished|is complete)\b)/i;
const ENVELOPE_BLOCK_RE = new RegExp(
  `<(${ENVELOPE_TAG_NAMES.join('|')})_?\\b[^>]*>[\\s\\S]*?</\\1_?>`,
  'gi'
);

function looksWrapped(text) {
  return ENVELOPE_TAG_RE.test(String(text || ''));
}

function extractTaskTitle(text) {
  const block = String(text || '').match(TASK_BLOCK_RE);
  const body = block ? block[1] : String(text || '');
  const title = body.match(TASK_TITLE_RE);
  return title ? title[1].trim() : '';
}

function isAgentInternalQuery(text) {
  return INTERNAL_QUERY_RE.test(String(text || '').replace(/\s+/g, ' ').trim());
}

function extractUserQueries(text) {
  return [...String(text || '').matchAll(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/gi)]
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
}

function stripEnvelopeBlocks(text) {
  return String(text || '').replace(ENVELOPE_BLOCK_RE, ' ').trim();
}

function cleanVisibleMessage(raw, role = 'user') {
  const originalRole = normalizeRole(role);
  const source = String(raw || '').trim();
  if (!source) return null;
  if (!looksWrapped(source)) return { role: originalRole, text: source };

  const queries = extractUserQueries(source);
  if (queries.length) {
    const visible = queries.filter((query) => !isAgentInternalQuery(query));
    if (!visible.length) {
      const title = extractTaskTitle(source);
      return title ? { role: 'system', text: `Task finished: ${title}` } : null;
    }
    return { role: originalRole, text: visible.join('\n\n') };
  }

  const stripped = stripEnvelopeBlocks(source).replace(/^\s*<\/?[a-z][\w:-]*_?\s*>\s*$/gim, '').trim();
  if (!stripped || isAgentInternalQuery(stripped)) {
    const title = extractTaskTitle(source);
    return title ? { role: 'system', text: `Task finished: ${title}` } : null;
  }
  return { role: originalRole, text: stripped };
}

const HYDRATE_MESSAGE_LIMIT = 80;

function isGenericProviderLabel(label, provider) {
  const text = String(label || '').trim();
  if (!text) return true;
  if (/^(cursor|codex|claude|chatgpt|gemini|grok|chat)\s+conversation$/i.test(text)) return true;
  const name = String(provider || '').trim();
  return Boolean(name) && new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+conversation$`, 'i').test(text);
}

function preferConversationLabel(existing, incoming, provider) {
  const next = String(incoming || '').trim();
  const prev = String(existing || '').trim();
  if (!next) return prev;
  if (prev && isGenericProviderLabel(next, provider) && !isGenericProviderLabel(prev, provider)) return prev;
  return next;
}

function tailConversationForClient(conversation, limit = HYDRATE_MESSAGE_LIMIT) {
  if (!conversation || !Array.isArray(conversation.messages)) return conversation;
  const total = conversation.messages.length;
  if (total <= limit) return conversation;
  return {
    ...conversation,
    messages: conversation.messages.slice(-limit),
    messageCount: Number(conversation.messageCount || total),
    truncated: true,
    hiddenBefore: total - limit
  };
}

function cleanChatTitle(raw) {
  const cleaned = cleanVisibleMessage(raw, 'user');
  let text = cleaned && cleaned.role !== 'system' ? cleaned.text : String(raw || '').trim();
  if (!text) return '';
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/<[^>]*$/g, ' ');
  return text.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function clipText(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

// "Continue as <provider>" across providers has no shared session to resume (each CLI's
// own session store is provider-specific), so the only way to carry context over is to
// hand the new agent the old transcript as plain prompt text - it works identically on
// every writable provider, unlike file attachments (Cursor's datasource ignores `files`
// entirely; see SubjectiveCursorDataSource.handle_message).
const HANDOFF_TRANSCRIPT_MAX_CHARS = 20000;

function formatTranscriptForHandoff(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const lines = messages
    .filter((message) => message?.text && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${String(message.text).trim()}`);
  if (!lines.length) return '';

  let body = lines.join('\n\n');
  let truncated = false;
  if (body.length > HANDOFF_TRANSCRIPT_MAX_CHARS) {
    body = body.slice(body.length - HANDOFF_TRANSCRIPT_MAX_CHARS);
    truncated = true;
  }

  const fromLabel = providerLabel(conversation.provider);
  const asUser = conversation.sourceUser ? ` as ${conversation.sourceUser}` : '';
  return [
    `Continuing a prior conversation from ${fromLabel}${asUser}. Here is the transcript so far`
      + `${truncated ? ' (truncated to the most recent messages)' : ''}:`,
    '---',
    body,
    '---',
    'Please continue from here.'
  ].join('\n\n');
}

function conversationKey(item) {
  return `${item.provider}:${sessionIdentity(item)}`;
}

function sessionIdentity(item) {
  const sessionId = String(item?.sessionId || '').trim().toLowerCase();
  if (sessionId) return sessionId;
  const fromPath = uuidFromPath(item?.sourceFile || item?.source_file || '');
  if (fromPath) return fromPath;
  return String(item?.target || '');
}

function uuidFromPath(filePath) {
  const match = String(filePath || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0].toLowerCase() : '';
}

function composerIdFromSource(filePath) {
  const source = String(filePath || '');
  const composer = source.match(/#composer:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (composer) return composer[1].toLowerCase();
  if (source.includes('agent-transcripts')) return uuidFromPath(source);
  return '';
}

function currentOsUsername() {
  try {
    return String(os.userInfo().username || '').trim();
  } catch (_error) {
    return String(process.env.USER || process.env.LOGNAME || '').trim();
  }
}

function sourceUserFromPath(filePath) {
  const match = String(filePath || '').match(/(?:^|\/)home\/([^/]+)\//);
  const user = match ? String(match[1] || '').trim() : '';
  if (!user || user === '.' || user === '..') return '';
  return user;
}

function resolveSourceUser(payload, sourceFile, origin) {
  const fingerprint = payload?.fingerprint && typeof payload.fingerprint === 'object' ? payload.fingerprint : {};
  const named = String(
    payload?.osUser
    || payload?.sourceUser
    || payload?.source_user
    || fingerprint.source_user
    || ''
  ).trim();
  if (named) return named;
  const fromPath = sourceUserFromPath(sourceFile || payload?.sourceFile || payload?.source_file);
  if (fromPath) return fromPath;
  if (origin === 'local') return currentOsUsername();
  return '';
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
    this.cursorRuntime = options.cursorRuntime || path.join(this.root, 'pipelines', 'cursor', 'run.py');
    this.historyRuntime = options.historyRuntime || path.join(this.root, 'pipelines', 'history', 'run.py');
    this.reloadRuntime = options.reloadRuntime || path.join(this.root, 'pipelines', 'history', 'reload_one.py');
    this.pipelineRuntime = options.pipelineRuntime || path.join(this.root, 'src', 'pipeline_runtime.py');
    this.spawn = options.spawn || spawn;
    // Optional: only needed for conversations with `osUser` set ("Continue as…").
    // Passed in from main.js to avoid a circular require between llmService.js and
    // suSessionManager.js.
    this.suSessionManager = options.suSessionManager || null;
    this.log = typeof options.log === 'function' ? options.log : () => {};
    this.busy = new Set();
    this._historyCache = null;
    this._sortedCache = null;
    fs.mkdirSync(this.appHome, { recursive: true });
    const saved = this._loadState();
    this.local = saved.conversations;
    this.activeTargets = new Set(saved.activeTargets);
    // User-assigned chat names, keyed by conversation target. Kept separate from the
    // conversation records so a rename survives across history re-imports (which rebuild
    // read-only conversations from disk on every listing).
    this.labelOverrides = saved.labelOverrides || {};
    // "Delete chat" on a read-only history import can't remove the CLI's own export file
    // (and shouldn't - that's the actual codex/claude/cursor history, not ours to destroy),
    // so deletion is a standing hide-list instead. Local conversations are also added here
    // as a defensive no-op: they're already spliced out of this.local, this just guarantees
    // a target string can never resurface even if some future path re-derives the same one.
    this.hiddenTargets = new Set(saved.hiddenTargets || []);
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
      return { conversations: [], activeTargets: [], migrated: false, labelOverrides: {}, hiddenTargets: [] };
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
      labelOverrides: (payload.labelOverrides && typeof payload.labelOverrides === 'object') ? { ...payload.labelOverrides } : {},
      hiddenTargets: Array.isArray(payload.hiddenTargets) ? payload.hiddenTargets.map(String) : []
    };
  }

  _saveState() {
    this._sortedCache = null;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({
      version: STATE_VERSION,
      conversations: this.local,
      activeTargets: [...this.activeTargets].slice(-20),
      labelOverrides: this.labelOverrides,
      hiddenTargets: [...this.hiddenTargets]
    }, null, 2)}\n`);
    fs.renameSync(temporary, this.statePath);
  }

  _normalizeConversation(payload, origin = 'history', filePath = '') {
    if (!payload || (origin === 'history' && payload.type !== 'localchat')) return null;
    const provider = String(payload.provider || payload.product || 'unknown').toLowerCase();
    const sourceFile = String(payload.sourceFile || payload.source_file || filePath || '');
    const sessionId = String(payload.sessionId || payload.thread_id || payload.session_id || uuidFromPath(sourceFile) || '');
    const identity = sessionId || sourceFile || crypto.randomUUID();
    const target = String(payload.target || `llm:${provider}:${Buffer.from(identity).toString('base64url')}`);
    const messages = (payload.messages || []).map((message) => {
      const role = normalizeRole(message.role);
      const command = String(message.command || '');
      const cleaned = cleanVisibleMessage(String(message.text || message.content || ''), role);
      if (!cleaned && !command) return null;
      const attachments = Array.isArray(message.attachments)
        ? message.attachments.filter((file) => /^image\//i.test(String(file?.mime_type || '')) && file?.content)
          .map((file) => ({ filename: String(file.filename || 'pasted-image'), mime_type: String(file.mime_type), content: String(file.content) }))
        : [];
      return {
        role: cleaned ? cleaned.role : role,
        kind: String(message.kind || 'message'),
        text: cleaned ? cleaned.text : command,
        command,
        shell: String(message.shell || ''),
        toolName: String(message.toolName || message.tool_name || ''),
        workdir: String(message.workdir || ''),
        time: epochMs(message.time || message.timestamp) || Date.now(),
        ...(attachments.length ? { attachments } : {}),
        ...(message.sendFailed ? { sendFailed: true, error: String(message.error || '') } : {})
      };
    }).filter((message) => message && (message.text || message.command));
    const messageUpdatedAt = latestMessageTime(messages);
    const contentUpdatedAt = Math.max(
      epochMs(payload.updatedAt || payload.source_mtime || payload.source_timestamp),
      messageUpdatedAt
    );
    const updatedAt = contentUpdatedAt
      || (filePath && fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0);
    const workspace = String(payload.workspace || payload.cwd || this.root);
    const createdAt = epochMs(payload.createdAt || payload.chat_started_at || payload.chat_started_timestamp) || updatedAt || Date.now();
    const sortAt = epochMs(payload.sortAt || payload.sort_at || payload.last_activity_at || payload.lastActivityAt) || messageUpdatedAt || updatedAt || createdAt;
    const rawLabel = String(payload.label || payload.title || payload.chat_name || `${provider} conversation`);
    const cleanedLabel = cleanChatTitle(rawLabel);
    return {
      target,
      label: cleanedLabel || (rawLabel.trim().startsWith('<') ? `${provider} conversation` : rawLabel),
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
      // Display-only: who owns the session on disk (history scan) or the Continue-as user.
      sourceUser: resolveSourceUser(payload, sourceFile, origin),
      icon: providerIcon(provider),
      participants: [
        { nick: 'You', modes: '' },
        { nick: providerLabel(provider), modes: 'bot' }
      ],
      loaded: payload.loaded !== false
    };
  }

  _historyConversations() {
    if (this._historyCache) return this._historyCache;
    if (!fs.existsSync(this.contextDir)) return [];
    const manifestPath = path.join(this.contextDir, '.subjective_localchats_manifest.json');
    const manifest = safeJson(manifestPath);
    if (manifest?.sources && typeof manifest.sources === 'object') {
      // Trust the manifest. existsSync() on tens of thousands of files in one
      // directory blocks the event loop long enough that the web UI's
      // /api/llm/conversations fetch times out and the sidebar stays empty.
      const conversations = Object.values(manifest.sources).map((record) => {
        const fingerprint = record.fingerprint || {};
        const sourceFile = String(record.source_file || fingerprint.source_file || '');
        const sessionMatch = sourceFile.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        const exportPath = path.join(this.contextDir, path.basename(record.export_filename || record.export_path || ''));
        const filenameTimestamp = exportFilenameTime(exportPath);
        const lastActivityMs = Number(record.last_activity_at || 0)
          || (String(sourceFile).includes('state.vscdb') ? 0 : Number(fingerprint.mtime_ns || 0) / 1e6)
          || filenameTimestamp;
        const rawTitle = record.title || path.basename(sourceFile);
        const cleanedTitle = cleanChatTitle(rawTitle);
        return this._normalizeConversation({
          type: 'localchat',
          title: cleanedTitle || (String(rawTitle).trim().startsWith('<') ? `${fingerprint.product || 'chat'} conversation` : rawTitle),
          product: fingerprint.product || 'unknown',
          kind: fingerprint.kind || 'chat',
          thread_id: sessionMatch?.[1] || '',
          source_file: sourceFile,
          source_user: fingerprint.source_user || record.source_user || '',
          fingerprint,
          source_mtime: Number(fingerprint.mtime_ns || 0) / 1e9,
          chat_started_at: filenameTimestamp / 1000,
          last_activity_at: lastActivityMs,
          sort_at: lastActivityMs,
          messages: [],
          messageCount: Number(record.message_count || 0),
          exportPath,
          loaded: false
        }, 'history', exportPath);
      }).filter(Boolean);
      this._historyCache = conversations;
      this._sortedCache = null;
      return conversations;
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
    this._historyCache = conversations;
    this._sortedCache = null;
    return conversations;
  }

  // Deduplicating and sorting every known conversation costs ~35ms once the archive
  // reaches tens of thousands of chats, and it is identical for every caller until the
  // history cache or the saved state changes — so do it once and reuse it. Every mutation
  // path goes through _saveState() or nulls _historyCache, and both drop this.
  _sortedConversations() {
    if (this._sortedCache) return this._sortedCache.list;
    const list = this._buildSortedConversations();
    this._sortedCache = { list, haystacks: null };
    return list;
  }

  // Lowercased search text per conversation, in the same order as _sortedConversations().
  // Built once instead of re-concatenating and re-lowercasing five fields per record on
  // every keystroke, which is the whole cost of a search over a large archive.
  _searchHaystacks() {
    this._sortedConversations();
    if (!this._sortedCache.haystacks) {
      this._sortedCache.haystacks = this._sortedCache.list.map((conversation) => (
        `${conversation.label || ''} ${conversation.provider || ''} ${conversation.description || ''} ${conversation.sourceUser || ''} ${conversation.osUser || ''}`
      ).toLowerCase());
    }
    return this._sortedCache.haystacks;
  }

  // Number of distinct conversations, without building a projection for each one.
  countConversations() {
    return this._sortedConversations().length;
  }

  _buildSortedConversations() {
    const deduplicated = new Map();
    for (const conversation of [...this._historyConversations(), ...this.local]) {
      const key = conversationKey(conversation);
      const previous = deduplicated.get(key);
      if (!previous) {
        deduplicated.set(key, conversation);
        continue;
      }
      const history = previous.origin === 'history' ? previous : (conversation.origin === 'history' ? conversation : null);
      const local = previous.origin === 'local' ? previous : (conversation.origin === 'local' ? conversation : null);
      if (history && local) {
        const override = this.labelOverrides[local.target] || this.labelOverrides[history.target];
        deduplicated.set(key, {
          ...local,
          label: override || history.label || local.label,
          sourceUser: local.sourceUser || history.sourceUser,
          sessionId: local.sessionId || history.sessionId,
          sortAt: Math.max(Number(local.sortAt || 0), Number(history.sortAt || 0)),
          updatedAt: Math.max(Number(local.updatedAt || 0), Number(history.updatedAt || 0))
        });
        continue;
      }
      if (conversation.updatedAt >= previous.updatedAt) {
        deduplicated.set(key, conversation);
      }
    }
    // Sort by last message time, newest first. History records store last
    // activity on last_activity_at / sortAt; local sends update both.
    const lastActivity = (conversation) => Number(
      conversation.sortAt || conversation.updatedAt || conversation.createdAt || 0
    );
    return [...deduplicated.values()]
      .filter((conversation) => !this.hiddenTargets.has(conversation.target))
      .sort((left, right) => lastActivity(right) - lastActivity(left));
  }

  listConversations(options = {}) {
    const includeMessages = options.includeMessages === true;
    const query = String(options.query || options.q || '').trim().toLowerCase();
    const limit = options.limit == null || options.limit === '' ? null : Number(options.limit);
    let list = this._sortedConversations();
    if (query) {
      const haystacks = this._searchHaystacks();
      list = list.filter((_conversation, index) => haystacks[index].includes(query));
    }
    const total = list.length;
    if (Number.isFinite(limit) && limit > 0) list = list.slice(0, limit);
    const conversations = list.map((conversation) => this._withLabelOverride(includeMessages ? this._hydrateLocalConversation(conversation) : {
      target: conversation.target,
      label: conversation.label,
      kind: conversation.kind,
      provider: conversation.provider,
      icon: conversation.icon,
      writable: conversation.writable,
      origin: conversation.origin,
      updatedAt: conversation.updatedAt,
      sortAt: conversation.sortAt,
      createdAt: conversation.createdAt,
      messageCount: conversation.messageCount,
      sessionId: conversation.sessionId,
      osUser: conversation.osUser,
      sourceUser: conversation.sourceUser,
      workspace: conversation.workspace,
      ircChannel: conversation.ircChannel,
      exportPath: conversation.exportPath,
      historyExportPath: conversation.historyExportPath,
      sourceFile: conversation.sourceFile,
      messages: [],
      loaded: conversation.origin === 'local' && conversation.messages.length === 0,
      activeOnIrc: this.activeTargets.has(conversation.target)
    }));
    conversations.total = total;
    return conversations;
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
    this.log('info', 'LLM conversation renamed', {
      target: key,
      label: clean,
      local: Boolean(local),
      previous: local ? undefined : 'override-only'
    });
    return { ok: true, conversation: this.findConversation(key) };
  }

  // "Delete chat": local conversations are removed outright (it's just our own state
  // file); a read-only history import instead goes on the standing hide-list, since it is
  // rebuilt from the CLI's own export on every listing and that export is never touched.
  deleteConversation(target) {
    const key = String(target || '');
    if (!key) return { ok: false, error: 'Missing conversation target.' };
    const index = this.local.findIndex((conversation) => conversation.target === key);
    if (index !== -1) this.local.splice(index, 1);
    this.hiddenTargets.add(key);
    delete this.labelOverrides[key];
    this.activeTargets.delete(key);
    this._saveState();
    this.log('info', 'LLM conversation deleted', { target: key, wasLocal: index !== -1 });
    return { ok: true };
  }

  _runtimeFor(provider) {
    const key = providerKey(provider);
    if (key === 'claude') return this.claudeRuntime;
    if (key === 'cursor') return this.cursorRuntime;
    return this.codexRuntime;
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
      sourceUser: currentOsUsername(),
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
  //
  // options.provider lets the same sibling also switch which agent CLI answers it
  // ("Continue as Claude · worktwins" from a Codex chat) - the caller (chatCore) is
  // responsible for feeding the old transcript to the new provider since there is no
  // session to carry across a provider change either.
  createSiblingForUser(sourceTarget, username, options = {}) {
    const source = this.findConversation(sourceTarget, { includeMessages: false });
    if (!source) throw new Error('Conversation was not found.');
    const provider = options.provider ? providerKey(options.provider) : providerKey(source.provider);
    if (!writableProvider(provider)) throw new Error(`${provider} has no writable datasource.`);
    const crossProvider = provider !== providerKey(source.provider);
    const label = providerLabel(provider);
    const now = Date.now();
    const conversation = this._normalizeConversation({
      target: `llm:${provider}:local:${crypto.randomUUID()}`,
      provider,
      label: crossProvider ? `${source.label} (${label} as ${username})` : `${source.label} (as ${username})`,
      description: crossProvider
        ? `${label} CLI conversation — continued from ${providerLabel(source.provider)} as ${username}`
        : `${source.description} — continued as ${username}`,
      workspace: source.workspace,
      osUser: username,
      sourceUser: username,
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
    // Look up the full history record (exportPath lives here). The sidebar list is
    // a slim projection without exportPath, so using listConversations() here made
    // click-to-open return an empty transcript.
    const metadata = this._historyConversations().find((conversation) => conversation.target === target) || null;
    if (!metadata) {
      if (options.includeMessages === true) {
        this.log('error', 'LLM conversation not found', { target });
      }
      return null;
    }
    if (options.includeMessages !== true || !metadata.exportPath) return this._withLabelOverride(metadata);
    const payload = safeJson(metadata.exportPath);
    if (!payload) return this._withLabelOverride(metadata);
    return this._withLabelOverride(this._normalizeConversation({
      ...payload,
      target: metadata.target,
      label: preferConversationLabel(metadata.label, payload.label || payload.title || payload.chat_name, metadata.provider),
      sessionId: metadata.sessionId || payload.sessionId || payload.thread_id || payload.session_id,
      sourceFile: metadata.sourceFile || payload.source_file,
      exportPath: metadata.exportPath,
      loaded: true
    }, 'history', metadata.exportPath));
  }

  async reloadConversation(target) {
    const metadata = this.findConversation(target, { includeMessages: false });
    if (!metadata) return null;
    const sourceFile = String(metadata.sourceFile || '').trim();
    const sessionId = String(metadata.sessionId || '').trim();
    if (!sourceFile && !sessionId) {
      return this.findConversation(target, { includeMessages: true });
    }
    const started = Date.now();
    this.log('info', 'LLM live reload start', {
      target,
      provider: metadata.provider,
      sourceFile,
      sessionId
    });
    const response = await this._runJsonScript(this.reloadRuntime, {
      source_file: sourceFile,
      session_id: sessionId,
      provider: metadata.provider || ''
    }, 45);
    const transcript = response && response.success ? response.transcript : null;
    if (!transcript || !Array.isArray(transcript.messages)) {
      this.log('warn', 'LLM live reload empty', {
        target,
        error: response?.error || '',
        ms: Date.now() - started
      });
      return this.findConversation(target, { includeMessages: true });
    }
    this._writeLiveExport(metadata, transcript);
    this._historyCache = null;
    this._sortedCache = null;
    const normalized = this._normalizeConversation({
      ...transcript,
      type: 'localchat',
      target: metadata.target,
      label: preferConversationLabel(metadata.label, transcript.title || transcript.chat_name, metadata.provider),
      sessionId: metadata.sessionId || sessionId || uuidFromPath(transcript.source_file || sourceFile),
      sourceFile: metadata.sourceFile || transcript.source_file || sourceFile,
      exportPath: metadata.exportPath,
      loaded: true
    }, 'history', metadata.exportPath);
    const local = this.local.find((item) => item.target === target);
    if (local && normalized) {
      // Keep locally recorded sends that the provider transcript does not know
      // about yet (for example an attachment blocked by an active-writer error).
      // Otherwise live reload erases them immediately after the failed send.
      const merged = this._hydrateLocalConversation({ ...local, messages: normalized.messages });
      local.messages = merged.messages;
      local.messageCount = normalized.messages.length;
      local.updatedAt = normalized.updatedAt;
      local.sortAt = normalized.sortAt;
      local.historyExportPath = metadata.exportPath || local.historyExportPath;
      local.sourceFile = normalized.sourceFile || local.sourceFile;
      const composerId = composerIdFromSource(local.sourceFile || '');
      if (composerId) local.sessionId = composerId;
      this._saveState();
    }
    this.log('info', 'LLM live reload ok', {
      target,
      messageCount: normalized ? normalized.messages.length : 0,
      ms: Date.now() - started
    });
    return this.findConversation(target, { includeMessages: true });
  }

  _writeLiveExport(metadata, transcript) {
    const exportPath = String(metadata.exportPath || '').trim();
    if (!exportPath) return;
    const existing = safeJson(exportPath) || { type: 'localchat' };
    const next = {
      ...existing,
      type: 'localchat',
      title: transcript.title || existing.title,
      chat_name: transcript.title || existing.chat_name,
      product: transcript.product || existing.product,
      source_file: transcript.source_file || existing.source_file || metadata.sourceFile,
      last_activity_at: transcript.last_activity_at || Date.now() / 1000,
      message_count: Array.isArray(transcript.messages) ? transcript.messages.length : 0,
      messages: transcript.messages || []
    };
    try {
      fs.mkdirSync(path.dirname(exportPath), { recursive: true });
      fs.writeFileSync(exportPath, `${JSON.stringify(next, null, 2)}\n`);
    } catch (error) {
      this.log('error', 'LLM live reload export write failed', { exportPath, message: error.message });
    }
  }

  _runJsonScript(scriptPath, payload, timeoutSeconds) {
    return new Promise((resolve) => {
      if (!fs.existsSync(scriptPath)) {
        resolve({ success: false, error: `Reload script missing: ${scriptPath}` });
        return;
      }
      const child = this.spawn(this.pythonPath, [scriptPath], {
        cwd: this.root,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch (_error) { /* ignore */ }
      }, Math.max(5, Number(timeoutSeconds) || 45) * 1000);
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ success: false, error: error.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const lines = String(stdout || '').trim().split('\n').filter(Boolean);
        try {
          resolve(JSON.parse(lines[lines.length - 1] || '{}'));
        } catch (_error) {
          resolve({ success: false, error: String(stderr || stdout || `exit ${code}`).trim() });
        }
      });
      child.stdin.write(JSON.stringify(payload || {}));
      child.stdin.end();
    });
  }

  _hydrateLocalConversation(conversation) {
    if (!conversation || conversation.origin !== 'local' || !conversation.historyExportPath) return conversation;
    const payload = safeJson(conversation.historyExportPath);
    if (!payload) return conversation;
    const history = this._normalizeConversation({
      ...payload,
      target: conversation.target,
      label: preferConversationLabel(conversation.label, payload.label || payload.title || payload.chat_name, conversation.provider),
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

  async listProviderSessions(provider = '') {
    const listed = await listProviderSessions();
    if (!provider) return listed;
    return sessionsForProvider(listed, provider);
  }

  _isAuthFailure(result) {
    if (!result) return false;
    if (result.status === 'authentication_required') return true;
    const blob = `${result.error || ''} ${result.response || ''}`.toLowerCase();
    return blob.includes('authentication_required')
      || blob.includes('loggedin": false')
      || blob.includes('logged in": false')
      || blob.includes('authentication required')
      || blob.includes('agent login')
      || blob.includes('auth status');
  }

  async refreshHistory() {
    if (this.busy.size) {
      this._historyRefreshDeferred = true;
      this.log('info', 'LLM history refresh deferred (send in flight)', { busy: [...this.busy] });
      return { success: true, status: 'deferred' };
    }
    this._historyCache = null;
    this._sortedCache = null;
    const started = Date.now();
    this.log('info', 'LLM history refresh start', { contextDir: this.contextDir });
    const response = await this._runPipeline(this.historyRuntime, {
      context_folder: this.contextDir,
      max_files: 500
    }, 1800);
    this._historyCache = null;
    this._sortedCache = null;
    const result = this._pipelineResult(response);
    this.log(result.success ? 'info' : 'error', 'LLM history refresh done', {
      ok: Boolean(result.success),
      status: result.status || '',
      error: result.error || '',
      ms: Date.now() - started,
      conversations: this.countConversations()
    });
    return result;
  }

  async _injectIntoOpenCursor(text) {
    return injectIntoCursorDom(text);
  }

  async _waitForCursorIdeReply(target, userMessage, timeoutMs) {
    const maxMs = Number(timeoutMs || process.env.CURSOR_INJECT_POLL_MAX_MS || CURSOR_INJECT_POLL_MAX_MS);
    const interval = Number(process.env.CURSOR_INJECT_POLL_MS || CURSOR_INJECT_POLL_MS);
    const deadline = Date.now() + maxMs;
    while (true) {
      try {
        const live = await this.reloadConversation(target);
        if (live && Array.isArray(live.messages)) {
          const reply = [...live.messages].reverse().find((message) => (
            message.role === 'assistant'
            && Number(message.time || 0) >= Number(userMessage.time || 0)
            && String(message.text || '').trim()
          ));
          if (reply) return { ok: true, conversation: live, assistantMessage: reply };
        }
      } catch (error) {
        this.log('warn', 'Cursor DOM inject poll failed', { target, message: error.message });
      }
      if (Date.now() >= deadline) break;
      await sleep(interval);
    }
    return { ok: false, error: 'Cursor tab did not produce a reply yet' };
  }

  async sendMessage(target, text, files = []) {
    const clean = String(text || '').trim();
    if (!clean) return { ok: false, status: 'invalid_request', error: 'Message is empty.' };
    const source = this.findConversation(target, { includeMessages: true });
    if (!source) {
      this.log('error', 'LLM send aborted: conversation not found', { target, promptChars: clean.length });
      return { ok: false, status: 'not_found', error: 'Conversation was not found.' };
    }
    const provider = writableProvider(source.provider);
    if (!provider) {
      this.log('error', 'LLM send aborted: read-only provider', { target, provider: source.provider });
      return { ok: false, status: 'read_only', error: `${source.provider} history has no writable datasource.` };
    }
    if (this.busy.has(target)) {
      this.log('warn', 'LLM send aborted: already busy', { target, provider: source.provider });
      return { ok: false, status: 'busy', error: `${provider.label} is already responding in this conversation.` };
    }

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
        this.log('error', 'LLM send aborted: OS user session not ready', {
          target,
          osUser: conversation.osUser,
          sessionStatus: sessionStatus.status
        });
        return {
          ok: false,
          status: 'os_user_not_connected',
          error: `Reconnect as ${conversation.osUser} first (right-click the conversation).`
        };
      }
    }

    // The message is recorded before the turn runs so a long agent reply still shows the
    // user's own line, but it must not survive a turn that never happened - an unsent
    // message left in the transcript reads exactly like a delivered one.
    const previousUpdatedAt = conversation.updatedAt;
    const previousSortAt = conversation.sortAt;
    const userMessage = { role: 'user', text: clean, time: Date.now() };
    if (Array.isArray(files) && files.length) {
      userMessage.attachments = files
        .filter((file) => /^image\//i.test(String(file?.mime_type || '')) && file?.content)
        .map((file) => ({ filename: String(file.filename || 'pasted-image'), mime_type: String(file.mime_type), content: String(file.content) }));
    }
    conversation.messages.push(userMessage);
    conversation.updatedAt = userMessage.time;
    conversation.sortAt = userMessage.time;
    this._saveState();
    this.busy.add(target);
    const started = Date.now();
    let originalSessionId = String(conversation.sessionId || source.sessionId || '').trim();
    // IDE composer UUID and a later cursor-agent chat id are different. If we
    // --resume the CLI id, web talks to a fork and Cursor's open tab never
    // sees the turn. Prefer the composer id baked into sourceFile.
    if (provider.bundle === 'cursor') {
      const composerId = composerIdFromSource(conversation.sourceFile || source.sourceFile || '');
      if (composerId && composerId !== originalSessionId.toLowerCase()) {
        this.log('warn', 'LLM send rebound Cursor session to IDE composer', {
          target,
          from: originalSessionId,
          to: composerId
        });
      }
      if (composerId) {
        originalSessionId = composerId;
        conversation.sessionId = composerId;
      }
    }
    this.log('info', 'LLM send start', {
      target,
      provider: source.provider,
      sessionId: originalSessionId,
      newSession: !originalSessionId,
      osUser: conversation.osUser || currentOsUsername(),
      sourceUser: conversation.sourceUser || '',
      origin: conversation.origin,
      workspace: conversation.workspace,
      files: Array.isArray(files) ? files.length : 0,
      promptChars: clean.length,
      promptPreview: clipText(clean)
    });

    const rollbackUserMessage = () => {
      const index = conversation.messages.lastIndexOf(userMessage);
      if (index === -1) return;
      conversation.messages.splice(index, 1);
      conversation.updatedAt = previousUpdatedAt;
      conversation.sortAt = previousSortAt;
      this._saveState();
    };

    try {
      const composerId = provider.bundle === 'cursor'
        ? composerIdFromSource(conversation.sourceFile || source.sourceFile || '')
        : '';
      if (composerId) {
        const injected = await this._injectIntoOpenCursor(clean);
        this.log(injected.ok ? 'info' : 'info', 'Cursor DOM inject', {
          target,
          ok: injected.ok,
          error: injected.error || '',
          via: injected.via || ''
        });
        if (injected.ok) {
          const waited = await this._waitForCursorIdeReply(target, userMessage);
          conversation.sessionId = originalSessionId;
          if (waited.ok) {
            this._saveState();
            this.log('info', 'LLM send ok via Cursor DOM', {
              target,
              sessionId: conversation.sessionId,
              ms: Date.now() - started
            });
            return {
              ok: true,
              result: { success: true, response: waited.assistantMessage.text, via: 'cdp-dom' },
              conversation: waited.conversation || this._hydrateLocalConversation(conversation),
              userMessage,
              assistantMessage: waited.assistantMessage,
              cursorIdeHint: false,
              cursorDomInjected: true
            };
          }
          const pending = {
            role: 'assistant',
            text: 'Typed into the open Cursor tab. Click ↻ when the reply lands.',
            time: Date.now()
          };
          conversation.messages.push(pending);
          conversation.updatedAt = pending.time;
          conversation.sortAt = pending.time;
          this._saveState();
          return {
            ok: true,
            result: { success: true, response: pending.text, via: 'cdp-dom-pending' },
            conversation: this._hydrateLocalConversation(conversation),
            userMessage,
            assistantMessage: pending,
            cursorIdeHint: false,
            cursorDomInjected: true
          };
        }
      }
      const request = {
        action: 'send',
        prompt: clean,
        files,
        target,
        session_id: originalSessionId,
        new_session: !originalSessionId,
        working_directory: conversation.workspace,
        source_file: conversation.sourceFile || source.sourceFile || '',
        timeout: AGENT_TURN_TIMEOUT_SECONDS
      };
      // Codex sandboxes per request; Claude takes an equivalent permission
      // mode; Cursor's CLI manages its own sandboxing (no per-request flag).
      if (provider.bundle === 'claude') {
        request.permission_mode = 'acceptEdits';
      } else if (provider.bundle === 'codex') {
        request.sandbox_mode = 'workspace-write';
      }
      const runtimePath = this._runtimeFor(source.provider);
      const pipelineResponse = runningAsOtherUser
        ? await this._runPipelineForUser(conversation.osUser, runtimePath, request, AGENT_TURN_WRAPPER_TIMEOUT_SECONDS)
        : await this._runPipeline(runtimePath, request, AGENT_TURN_WRAPPER_TIMEOUT_SECONDS);
      const result = this._pipelineResult(pipelineResponse);
      if (!result.success) {
        // Preserve attachment messages so the screenshot and its failure remain
        // visible after reload; ordinary failed text keeps legacy rollback behavior.
        if (files?.length) {
          userMessage.sendFailed = true;
          userMessage.error = String(result.error || result.status || 'Send failed');
          this._saveState();
        } else {
          rollbackUserMessage();
        }
        this.log('error', 'LLM send failed', {
          target,
          provider: source.provider,
          status: result.status || '',
          error: clipText(result.error, 400),
          sessionId: conversation.sessionId || '',
          osUser: conversation.osUser || currentOsUsername(),
          authFailure: this._isAuthFailure(result),
          ms: Date.now() - started
        });
        const failure = { ok: false, ...result, userMessage };
        if (this._isAuthFailure(failure)) {
          failure.sessions = await this.listProviderSessions(source.provider);
          // This process just failed auth — don't advertise the current user as ready.
          if (failure.sessions?.users) {
            failure.sessions.users = failure.sessions.users.map((user) => (
              user.current ? { ...user, ready: false } : user
            ));
            failure.sessions.users.sort((left, right) => Number(right.ready) - Number(left.ready) || left.username.localeCompare(right.username));
          }
        }
        return failure;
      }
      if (originalSessionId) conversation.sessionId = originalSessionId;
      else conversation.sessionId = String(result.session_id || conversation.sessionId || '');
      const assistantMessage = { role: 'assistant', text: String(result.response || ''), time: Date.now() };
      conversation.messages.push(assistantMessage);
      conversation.updatedAt = assistantMessage.time;
      conversation.sortAt = assistantMessage.time;
      this._saveState();
      this.log('info', 'LLM send ok', {
        target,
        provider: source.provider,
        sessionId: conversation.sessionId,
        responseChars: String(result.response || '').length,
        responsePreview: clipText(result.response),
        ms: Date.now() - started
      });
      let shown = this._hydrateLocalConversation(conversation);
      try {
        const reloaded = await this.reloadConversation(target);
        if (reloaded && Array.isArray(reloaded.messages) && reloaded.messages.length >= conversation.messages.length) {
          shown = reloaded;
        }
      } catch (error) {
        this.log('warn', 'LLM post-send live reload failed', { target, message: error.message });
      }
      return {
        ok: true,
        result,
        conversation: shown,
        userMessage,
        assistantMessage,
        cursorIdeHint: Boolean(provider.bundle === 'cursor' && composerIdFromSource(conversation.sourceFile || source.sourceFile || ''))
      };
    } catch (error) {
      if (files?.length) {
        userMessage.sendFailed = true;
        userMessage.error = error.message;
        this._saveState();
      } else {
        rollbackUserMessage();
      }
      this.log('error', 'LLM send crashed', {
        target,
        provider: source.provider,
        message: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      this.busy.delete(target);
      if (this._historyRefreshDeferred && this.busy.size === 0) {
        this._historyRefreshDeferred = false;
        setImmediate(() => {
          this.refreshHistory().catch((error) => {
            this.log('error', 'LLM deferred history refresh failed', { message: error.message });
          });
        });
      }
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
    const action = payload && typeof payload === 'object' ? String(payload.action || 'history') : 'history';
    const started = Date.now();
    this.log('info', 'LLM pipeline spawn', {
      action,
      runtime: path.basename(runtimePath),
      timeoutSeconds,
      sessionId: payload?.session_id || '',
      workspace: payload?.working_directory || payload?.context_folder || ''
    });
    return new Promise((resolve) => {
      if (!fs.existsSync(runtimePath) || !fs.existsSync(this.pipelineRuntime)) {
        const missing = !fs.existsSync(runtimePath) ? runtimePath : this.pipelineRuntime;
        this.log('error', 'LLM pipeline runtime missing', { runtime: missing, action });
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
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        this._consumeProgress(text, payload);
      });
      child.on('error', (error) => {
        this.log('error', 'LLM pipeline spawn error', { action, runtime: path.basename(runtimePath), message: error.message, ms: Date.now() - started });
        resolve({ success: false, status: 'runtime_error', error: error.message });
      });
      child.on('close', (code) => {
        const parsed = this._parsePipelineOutput(stdout, stderr);
        this.log(parsed.success === false ? 'error' : 'info', 'LLM pipeline exit', {
          action,
          runtime: path.basename(runtimePath),
          exitCode: code,
          ok: parsed.success !== false,
          status: parsed.status || parsed.result?.pipeline_result?.status || '',
          stderrChars: String(stderr || '').length,
          stderrPreview: clipText(stderr, 240),
          ms: Date.now() - started
        });
        resolve(parsed);
      });
      child.stdin.end(JSON.stringify(payload));
    });
  }

  _consumeProgress(chunk, payload) {
    if (!chunk || typeof this.onProgress !== 'function') return;
    const lines = String(chunk).split(/\r?\n/);
    for (const line of lines) {
      const prefix = 'SUBJECTIVE_PROGRESS ';
      const index = line.indexOf(prefix);
      if (index === -1) continue;
      try {
        const body = JSON.parse(line.slice(index + prefix.length));
        const text = String(body.text || '').trim();
        if (text) this.onProgress({ text, target: payload?.target || '', sessionId: payload?.session_id || '' });
      } catch (_error) {
        /* ignore partial JSON */
      }
    }
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
    const started = Date.now();
    this.log('info', 'LLM pipeline as OS user', {
      osUser,
      action: payload && typeof payload === 'object' ? String(payload.action || '') : '',
      runtime: path.basename(runtimePath),
      timeoutSeconds,
      sessionId: payload?.session_id || ''
    });
    try {
      const argv = [this.pythonPath, this.pipelineRuntime, runtimePath, '--timeout', String(timeoutSeconds)];
      const bridged = await this.suSessionManager.runInSession(osUser, argv, JSON.stringify(payload), {
        timeoutMs: timeoutSeconds * 1000 + 10000
      });
      const parsed = this._parsePipelineOutput(bridged.stdout, bridged.stderr);
      this.log(parsed.success === false ? 'error' : 'info', 'LLM pipeline as OS user done', {
        osUser,
        ok: parsed.success !== false,
        status: parsed.status || '',
        ms: Date.now() - started
      });
      return parsed;
    } catch (error) {
      this.log('error', 'LLM pipeline as OS user failed', { osUser, message: error.message, ms: Date.now() - started });
      return { success: false, status: 'runtime_error', error: error.message };
    }
  }
}

module.exports = {
  CODEX_ICON,
  HYDRATE_MESSAGE_LIMIT,
  PROVIDER_ICONS,
  WRITABLE_PROVIDERS,
  LlmService,
  cleanVisibleMessage,
  epochMs,
  exportFilenameTime,
  formatTranscriptForHandoff,
  composerIdFromSource,
  ircChannelName,
  isGenericProviderLabel,
  normalizeRole,
  preferConversationLabel,
  providerIcon,
  providerLabel,
  resolveSourceUser,
  sourceUserFromPath,
  sessionIdentity,
  tailConversationForClient
};
