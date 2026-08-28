const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const { LlmService, exportFilenameTime, providerIcon, providerLabel, cleanVisibleMessage } = require('../src/llmService');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subjective-chat-'));
  const contextDir = path.join(root, 'context');
  fs.mkdirSync(contextDir);
  return {
    root,
    contextDir,
    statePath: path.join(root, 'state', 'llm-conversations.json')
  };
}

function writeChat(directory, name, payload) {
  fs.writeFileSync(path.join(directory, name), JSON.stringify({ type: 'localchat', ...payload }));
}

test('LocalChats exports become newest-first channel conversations with Codex icon', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  writeChat(paths.contextDir, 'old-Localchats-test-context.json', {
    title: 'Old Codex chat', product: 'codex', thread_id: 'thread-old', source_mtime: 100,
    messages: [{ role: 'user', text: 'old', timestamp: '2020-01-01T00:00:00Z' }]
  });
  writeChat(paths.contextDir, 'new-Localchats-test-context.json', {
    title: 'New Codex chat', product: 'codex', thread_id: 'thread-new', source_mtime: 200,
    messages: [{ role: 'assistant', text: 'new', timestamp: '2021-01-01T00:00:00Z' }]
  });

  const conversations = new LlmService(paths).listConversations();
  assert.equal(conversations.length, 2);
  assert.equal(conversations[0].label, 'New Codex chat');
  assert.equal(conversations[0].kind, 'llm');
  assert.equal(conversations[0].writable, true);
  assert.match(conversations[0].icon, /assets\/providers\/codex\.svg$/);
});

test('every supported chat provider receives its bundled icon and display name', () => {
  const providers = [
    ['codex', 'codex.svg', 'Codex'],
    ['cursor', 'cursor.svg', 'Cursor'],
    ['claude', 'claude.svg', 'Claude'],
    ['anthropic_claude', 'claude.svg', 'Claude'],
    ['gemini', 'gemini.svg', 'Gemini'],
    ['grok', 'grok.svg', 'Grok'],
    ['xai', 'grok.svg', 'Grok'],
    ['chatgpt', 'chatgpt.svg', 'ChatGPT'],
    ['openai_chat_gpt', 'chatgpt.svg', 'ChatGPT']
  ];

  for (const [provider, icon, label] of providers) {
    assert.match(providerIcon(provider), new RegExp(`assets/providers/${icon.replace('.', '\\.')}$`));
    assert.equal(providerLabel(provider), label);
  }
  assert.equal(providerIcon('unknown-provider'), '');
});

test('lazy history manifest sorts chats by per-chat filename time, not shared database mtime', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const olderFile = '2025_01_02_03_04_05_old-Localchats-test-context.json';
  const newerFile = '2026_08_11_17_30_00_new-Localchats-test-context.json';
  fs.writeFileSync(path.join(paths.contextDir, olderFile), '{}');
  fs.writeFileSync(path.join(paths.contextDir, newerFile), '{}');
  const sharedFingerprint = {
    product: 'cursor', kind: 'ide', mtime_ns: 1999999999999999999
  };
  fs.writeFileSync(path.join(paths.contextDir, '.subjective_localchats_manifest.json'), JSON.stringify({
    version: 1,
    sources: {
      old: { source_file: '/tmp/state.vscdb#old', fingerprint: sharedFingerprint, export_filename: olderFile, title: 'Older chat' },
      new: { source_file: '/tmp/state.vscdb#new', fingerprint: sharedFingerprint, export_filename: newerFile, title: 'Newest chat' }
    }
  }));

  const conversations = new LlmService(paths).listConversations();
  assert.deepEqual(conversations.map((item) => item.label), ['Newest chat', 'Older chat']);
  assert.equal(conversations[0].sortAt, Date.UTC(2026, 7, 11, 17, 30, 0));
  assert.equal(exportFilenameTime(olderFile), Date.UTC(2025, 0, 2, 3, 4, 5));
});

test('listConversations exposes sourceUser from fingerprint, path, Continue-as, and local process user', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const gordonFile = '2026_08_11_17_30_00_gordon-Localchats-test-context.json';
  const pathFile = '2026_08_11_17_31_00_path-Localchats-test-context.json';
  fs.writeFileSync(path.join(paths.contextDir, gordonFile), '{}');
  fs.writeFileSync(path.join(paths.contextDir, pathFile), '{}');
  fs.writeFileSync(path.join(paths.contextDir, '.subjective_localchats_manifest.json'), JSON.stringify({
    version: 1,
    sources: {
      gordon: {
        source_file: '/home/gordon/.cursor/chats/one.jsonl',
        fingerprint: { product: 'cursor', kind: 'ide', source_user: 'gordon', mtime_ns: 1 },
        export_filename: gordonFile,
        title: 'Gordon chat'
      },
      pathOnly: {
        source_file: '/home/subjective/.claude/projects/x/session.jsonl',
        fingerprint: { product: 'claude', kind: 'cli', mtime_ns: 2 },
        export_filename: pathFile,
        title: 'Path chat'
      }
    }
  }));

  const service = new LlmService(paths);
  const listed = service.listConversations();
  assert.equal(listed.find((item) => item.label === 'Gordon chat').sourceUser, 'gordon');
  assert.equal(listed.find((item) => item.label === 'Path chat').sourceUser, 'subjective');

  const local = service.createConversation({ name: 'Local chat', provider: 'codex' });
  assert.ok(local.sourceUser);
  const sibling = service.createSiblingForUser(local.target, 'bob');
  assert.equal(sibling.sourceUser, 'bob');
});

test('local first-message copies do not hide Cursor tab names from history', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const composerId = '1caed09f-85be-4d7d-8db5-7994b94da04c';
  const exportFile = '2026_08_11_17_30_00_tab-Localchats-test-context.json';
  fs.writeFileSync(path.join(paths.contextDir, exportFile), '{}');
  fs.writeFileSync(path.join(paths.contextDir, '.subjective_localchats_manifest.json'), JSON.stringify({
    version: 1,
    sources: {
      tab: {
        source_file: `/tmp/state.vscdb#composer:${composerId}`,
        fingerprint: { product: 'cursor', kind: 'composer', source_user: 'gordon', mtime_ns: 3 },
        export_filename: exportFile,
        title: 'VAI-238',
        last_activity_at: 2000
      }
    }
  }));
  fs.mkdirSync(path.dirname(paths.statePath), { recursive: true });
  fs.writeFileSync(paths.statePath, JSON.stringify({
    version: 2,
    conversations: [{
      type: 'localchat',
      product: 'cursor',
      title: 'you a',
      source_file: `/home/gordon/.cursor/projects/p/agent-transcripts/${composerId}/${composerId}.jsonl`,
      messages: [{ role: 'user', text: 'you a', timestamp: 1 }]
    }],
    activeTargets: [],
    labelOverrides: {}
  }));

  const listed = new LlmService(paths).listConversations();
  const matches = listed.filter((item) => String(item.sessionId) === composerId || String(item.sourceFile).includes(composerId));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].label, 'VAI-238');
});

test('new Codex channel persists and adopts native session id after first message', async (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const service = new LlmService(paths);
  service._runPipeline = async () => ({
    success: true,
    result: {
      pipeline_result: {
        success: true,
        status: 'completed',
        response: 'Implemented.',
        session_id: 'thread-created',
        events: [],
        usage: {}
      }
    }
  });
  const created = service.createConversation({ name: 'Build feature', workspace: '/subjective' });
  const result = await service.sendMessage(created.target, 'Start work');

  assert.equal(result.ok, true);
  assert.equal(result.conversation.sessionId, 'thread-created');
  assert.deepEqual(result.conversation.messages.map((message) => message.role), ['user', 'assistant']);
  const restored = new LlmService(paths).findConversation(created.target);
  assert.equal(restored.sessionId, 'thread-created');
  assert.equal(restored.messages[1].text, 'Implemented.');
  assert.equal(new LlmService(paths).listConversations().find((item) => item.target === created.target).activeOnIrc, true);
});

// Regression test: a big agentic ask ("generate a whole new app") can genuinely run past
// the datasource's own 10-minute connection default. sendMessage must hand the CLI
// subprocess an explicit per-turn budget (not just rely on the outer wrapper's timeout,
// which only stops the *wrapper* - the datasource's own subprocess.run(..., timeout=...)
// fires first and reports "timed out" on its own, well before that outer stop ever runs).
test('sendMessage gives the agent turn a timeout budget well beyond the datasource default, and the outer wrapper a bit more than that', async (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const service = new LlmService(paths);
  let capturedTimeoutSeconds = null;
  let capturedRequest = null;
  service._runPipeline = async (_runtimePath, request, timeoutSeconds) => {
    capturedRequest = request;
    capturedTimeoutSeconds = timeoutSeconds;
    return {
      success: true,
      result: { pipeline_result: { success: true, response: 'ok', session_id: 's1', events: [], usage: {} } }
    };
  };
  const created = service.createConversation({ name: 'Big build', workspace: '/subjective' });
  await service.sendMessage(created.target, 'Build the whole thing');

  assert.equal(capturedRequest.timeout, 1800);
  assert.equal(capturedTimeoutSeconds, 1860);
  assert.ok(capturedTimeoutSeconds > capturedRequest.timeout, 'the wrapper must outlive the datasource-level timeout it is meant to back up');
});

test('migrates copied v1 history to live history reference and preserves local replies', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const exportName = '2026_08_10_12_00_00_chat-Localchats-test-context.json';
  const exportPath = path.join(paths.contextDir, exportName);
  const sourceFile = '/home/test/.codex/sessions/thread-migrated.jsonl';
  writeChat(paths.contextDir, exportName, {
    title: 'Migrated chat',
    product: 'codex',
    source_file: sourceFile,
    messages: [{
      role: 'tool',
      kind: 'command',
      command: 'curl -s https://example.com',
      text: 'curl -s https://example.com',
      shell: 'bash',
      timestamp: '2026-08-10T12:00:00Z'
    }]
  });
  fs.mkdirSync(path.dirname(paths.statePath), { recursive: true });
  fs.writeFileSync(paths.statePath, JSON.stringify({
    version: 1,
    activeTargets: [],
    conversations: [{
      target: 'llm:codex:migrated',
      provider: 'codex',
      label: 'Migrated chat',
      sourceFile,
      exportPath,
      messageCount: 2,
      messages: [
        { role: 'system', text: 'curl', time: Date.parse('2026-08-10T12:00:00Z') },
        { role: 'system', text: '-s', time: Date.parse('2026-08-10T12:00:00Z') },
        { role: 'user', text: 'Keep this unsynced reply', time: Date.parse('2026-08-11T12:00:00Z') }
      ]
    }]
  }));

  const service = new LlmService(paths);
  const saved = JSON.parse(fs.readFileSync(paths.statePath, 'utf8'));
  const hydrated = service.findConversation('llm:codex:migrated', { includeMessages: true });

  assert.equal(saved.version, 2);
  assert.equal(saved.conversations[0].messages.length, 1);
  assert.equal(saved.conversations[0].messages[0].text, 'Keep this unsynced reply');
  assert.equal(fs.existsSync(`${paths.statePath}.v1-backup`), true);
  assert.deepEqual(hydrated.messages.map((message) => message.text), [
    'curl -s https://example.com',
    'Keep this unsynced reply'
  ]);
  assert.equal(hydrated.messages[0].kind, 'command');
});

test('renameConversation updates a local chat and persists the new name', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const service = new LlmService({ ...paths, appHome: paths.root });
  const created = service.createConversation({ name: 'Draft chat', provider: 'codex' });

  const result = service.renameConversation(created.target, '  Release notes  ');
  assert.equal(result.ok, true);
  assert.equal(result.conversation.label, 'Release notes');
  assert.equal(service.findConversation(created.target).label, 'Release notes');

  // Survives a reload from disk.
  const reloaded = new LlmService({ ...paths, appHome: paths.root });
  assert.equal(reloaded.findConversation(created.target).label, 'Release notes');

  // Empty/whitespace names are rejected without mutating the label.
  assert.equal(reloaded.renameConversation(created.target, '   ').ok, false);
  assert.equal(reloaded.findConversation(created.target).label, 'Release notes');
});

test('renameConversation overrides a read-only history chat and survives re-import', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  writeChat(paths.contextDir, 'chat-Localchats-test-context.json', {
    title: 'Auto-derived title', product: 'grok', thread_id: 'thread-history', source_mtime: 100,
    messages: [{ role: 'user', text: 'hello', timestamp: '2026-01-01T00:00:00Z' }]
  });
  const service = new LlmService({ ...paths, appHome: paths.root });
  const target = service.listConversations()[0].target;
  assert.equal(service.listConversations()[0].writable, false);

  assert.equal(service.renameConversation(target, 'My grok session').ok, true);
  assert.equal(service.listConversations()[0].label, 'My grok session');

  // A fresh service rebuilds the history conversation from disk yet keeps the custom name.
  const reloaded = new LlmService({ ...paths, appHome: paths.root });
  assert.equal(reloaded.listConversations()[0].label, 'My grok session');
});

test('successful pipeline with null datasource result remains successful', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const service = new LlmService(paths);
  assert.deepEqual(
    service._pipelineResult({ success: true, result: { pipeline_result: null } }),
    { success: true, status: 'completed', result: null }
  );
});

test('application nests each standard pipeline home under its own home', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const service = new LlmService({ root: paths.root, appHome: paths.root });
  assert.equal(service.codexHome, path.join(paths.root, '.subjective_chat_codex'));
  assert.equal(service.historyHome, path.join(paths.root, '.subjective_chat_history'));
  assert.equal(service.contextDir, path.join(paths.root, '.subjective_chat_history', 'context'));
});

test('exported runtime receives request and isolated application paths', async (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const runtimePath = path.join(paths.root, 'run.py');
  const pipelineRuntime = path.join(paths.root, 'pipeline_runtime.py');
  fs.writeFileSync(runtimePath, '# exported runtime fixture\n');
  fs.writeFileSync(pipelineRuntime, '# application runtime fixture\n');
  let invocation;
  const fakeSpawn = (_python, args, options) => {
    invocation = { args, options, request: '' };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = {
      end(value) {
        invocation.request = value;
        child.stdout.end('{"success":true,"result":{"pipeline_result":null}}');
        queueMicrotask(() => child.emit('close', 0));
      }
    };
    return child;
  };
  const service = new LlmService({ ...paths, appHome: paths.root, pipelineRuntime, spawn: fakeSpawn });
  const result = await service._runPipeline(runtimePath, { action: 'status' }, 30);

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(invocation.request), { action: 'status' });
  assert.deepEqual(invocation.args, [pipelineRuntime, runtimePath, '--timeout', '30']);
  assert.equal(invocation.options.env.SUBJECTIVE_CHAT_PIPELINE_PARENT_HOME, paths.root);
  assert.equal(invocation.options.env.HOME, process.env.HOME);
  assert.equal(invocation.options.env.CONTEXT_STORAGE, undefined);
  assert.equal(invocation.options.env.USERDATA_PATH, undefined);
});

test('createSiblingForUser clones provider/workspace but starts a fresh session for the new osUser', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const service = new LlmService({ ...paths, appHome: paths.root });
  const source = service.createConversation({ name: 'Ops chat', provider: 'codex', workspace: '/repo' });
  source.sessionId = 'session-abc';
  source.messages.push({ role: 'user', text: 'hi', time: Date.now() });

  const sibling = service.createSiblingForUser(source.target, 'bob');

  assert.notEqual(sibling.target, source.target);
  assert.equal(sibling.provider, 'codex');
  assert.equal(sibling.workspace, '/repo');
  assert.equal(sibling.osUser, 'bob');
  assert.equal(sibling.sourceUser, 'bob');
  assert.equal(sibling.sessionId, '');
  assert.deepEqual(sibling.messages, []);
  assert.match(sibling.label, /Ops chat \(as bob\)/);
  // The original conversation is untouched.
  const original = service.findConversation(source.target);
  assert.equal(original.osUser, null);
  assert.equal(original.sessionId, 'session-abc');
});

test('sendMessage short-circuits when the conversation\'s osUser has no ready session', async (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  let spawnCalls = 0;
  const suSessionManager = {
    getStatus: () => ({ status: 'idle' }),
    runInSession: () => { throw new Error('must not be called'); }
  };
  const service = new LlmService({
    ...paths,
    appHome: paths.root,
    suSessionManager,
    spawn: () => { spawnCalls += 1; throw new Error('must not spawn locally either'); }
  });
  const source = service.createConversation({ provider: 'codex' });
  const sibling = service.createSiblingForUser(source.target, 'bob');

  const result = await service.sendMessage(sibling.target, 'hello');

  assert.equal(result.ok, false);
  assert.equal(result.status, 'os_user_not_connected');
  assert.match(result.error, /Reconnect as bob/);
  assert.equal(spawnCalls, 0);
  // The message that failed to send was never appended to the transcript.
  const reloaded = service.findConversation(sibling.target, { includeMessages: true });
  assert.deepEqual(reloaded.messages, []);
});

test('sendMessage routes osUser conversations through SuSessionManager.runInSession instead of a local spawn', async (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const runtimePath = path.join(paths.root, 'pipelines', 'codex', 'run.py');
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  fs.writeFileSync(runtimePath, '# fixture\n');
  const pipelineRuntime = path.join(paths.root, 'pipeline_runtime.py');
  fs.writeFileSync(pipelineRuntime, '# fixture\n');

  let bridgedCall = null;
  const suSessionManager = {
    getStatus: (username) => ({ status: username === 'bob' ? 'ready' : 'idle' }),
    runInSession: async (username, argv, stdin, options) => {
      bridgedCall = { username, argv, stdin, options };
      return {
        stdout: JSON.stringify({ success: true, result: { pipeline_result: { success: true, session_id: 'new-session', response: 'hi from bob' } } }),
        stderr: '',
        exitCode: 0
      };
    }
  };
  const service = new LlmService({
    ...paths,
    appHome: paths.root,
    pipelineRuntime,
    codexRuntime: runtimePath,
    suSessionManager,
    spawn: () => { throw new Error('must not spawn locally when osUser is set'); }
  });
  const source = service.createConversation({ provider: 'codex' });
  const sibling = service.createSiblingForUser(source.target, 'bob');

  const result = await service.sendMessage(sibling.target, 'hello as bob');

  assert.equal(result.ok, true);
  assert.equal(result.assistantMessage.text, 'hi from bob');
  assert.equal(bridgedCall.username, 'bob');
  assert.deepEqual(bridgedCall.argv, [service.pythonPath, pipelineRuntime, runtimePath, '--timeout', '1860']);
  assert.deepEqual(JSON.parse(bridgedCall.stdin), {
    action: 'send',
    prompt: 'hello as bob',
    files: [],
    session_id: '',
    new_session: true,
    working_directory: sibling.workspace,
    timeout: 1800,
    sandbox_mode: 'workspace-write'
  });
});

test('cleanVisibleMessage unwraps Cursor user_query XML and hides task pings', () => {
  const real = cleanVisibleMessage(
    '<timestamp>Tuesday, Aug 18, 2026, 10:59 AM (UTC-3)</timestamp>\n<user_query>\nFix the login form\n</user_query>',
    'user'
  );
  assert.deepEqual(real, { role: 'user', text: 'Fix the login form' });

  const ping = cleanVisibleMessage([
    '<timestamp>Tuesday, Aug 18, 2026, 10:59 AM (UTC-3)</timestamp>',
    '<system_notification>',
    'The above task is complete.',
    '<task>',
    'kind: shell',
    'status: success',
    'title: Rebuild API and start Vite on VAI 281',
    '</task>',
    '</system_notification_>',
    '<user_query>Briefly inform the user about the task result and perform any follow-up actions (if needed). If there\'s no follow-ups needed, don\'t explicitly say that.</user_query>'
  ].join('\n'), 'user');
  assert.deepEqual(ping, { role: 'system', text: 'Task finished: Rebuild API and start Vite on VAI 281' });

  const boilerplate = cleanVisibleMessage(
    '<timestamp>now</timestamp>\n<user_query>Briefly inform the user about the task result and perform any follow-up actions (if needed).</user_query>',
    'user'
  );
  assert.equal(boilerplate, null);

  assert.deepEqual(cleanVisibleMessage('plain user text', 'user'), { role: 'user', text: 'plain user text' });
  assert.deepEqual(
    cleanVisibleMessage('Use a `<div>` in the template', 'assistant'),
    { role: 'assistant', text: 'Use a `<div>` in the template' }
  );
});

test('history hydrate shows Cursor user_query text, not the XML envelope', (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  writeChat(paths.contextDir, 'cursor-Localchats-test-context.json', {
    title: 'selenium_agent',
    product: 'cursor',
    thread_id: 'thread-xml',
    source_mtime: 200,
    messages: [
      {
        role: 'user',
        text: '<timestamp>Tue</timestamp>\n<user_query>\nsee all messages for selenium_agent\n</user_query>',
        timestamp: '2026-08-18T10:58:00Z'
      },
      {
        role: 'user',
        text: [
          '<timestamp>Tue</timestamp>',
          '<system_notification><task>\ntitle: Restart Vite proxying API to wittycoast\n</task></system_notification_>',
          '<user_query>Briefly inform the user about the task result and perform any follow-up actions (if needed).</user_query>'
        ].join('\n'),
        timestamp: '2026-08-18T10:59:00Z'
      },
      {
        role: 'assistant',
        text: '3 passed / 3 skipped',
        timestamp: '2026-08-18T11:22:00Z'
      }
    ]
  });

  const service = new LlmService(paths);
  const conversation = service.listConversations({ includeMessages: true })[0];
  assert.deepEqual(conversation.messages.map((message) => ({ role: message.role, text: message.text })), [
    { role: 'user', text: 'see all messages for selenium_agent' },
    { role: 'system', text: 'Task finished: Restart Vite proxying API to wittycoast' },
    { role: 'assistant', text: '3 passed / 3 skipped' }
  ]);
});
