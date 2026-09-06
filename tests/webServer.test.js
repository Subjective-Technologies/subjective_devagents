// End-to-end (real HTTP + real WebSocket, in-process ChatCore) coverage of webServer.js's
// createApp(): the individual routes' business logic is already covered via chatCore.test.js
// and llmService.test.js's mocks - this test is about the HTTP/WS plumbing itself (routing,
// static files, path-traversal fencing, the WS broadcast) actually working end to end.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const WebSocket = require('ws');

const { ChatCore } = require('../src/chatCore');
const { createApp } = require('../src/webServer');

function startServer() {
  const appHome = fs.mkdtempSync(path.join(os.tmpdir(), 'subjective-chat-web-'));
  const core = new ChatCore({ appHome, log: () => {} });
  core.loadSettings();
  const { server, refreshHistory } = createApp(core);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        core,
        server,
        refreshHistory,
        baseUrl: `http://127.0.0.1:${port}`,
        wsUrl: `ws://127.0.0.1:${port}/ws`,
        close: () => new Promise((done) => {
          core.shutdown();
          // A WebSocket connection is a long-lived TCP socket: http.Server#close() only
          // stops accepting *new* connections and waits for existing ones to end on their
          // own, so a still-open WS client from an earlier test would otherwise hang this
          // forever. Force every socket closed so teardown is always prompt.
          server.closeAllConnections();
          server.close(done);
        })
      });
    });
  });
}

test('serves the static app shell and vendored assets, and fences /assets/ against traversal', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);

  const index = await fetch(`${ctx.baseUrl}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<title>Subjective Chat<\/title>/);

  const bridge = await fetch(`${ctx.baseUrl}/webBridge.js`);
  assert.equal(bridge.status, 200);
  assert.match(bridge.headers.get('content-type'), /javascript/);

  const xterm = await fetch(`${ctx.baseUrl}/assets/vendor/xterm.js`);
  assert.equal(xterm.status, 200);

  const traversal = await fetch(`${ctx.baseUrl}/assets/../../.env`);
  assert.equal(traversal.status, 404);

  const missing = await fetch(`${ctx.baseUrl}/does-not-exist`);
  assert.equal(missing.status, 404);
});

test('GET /api/config reflects ChatCore state and POST routes reach ChatCore methods', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);

  const config = await (await fetch(`${ctx.baseUrl}/api/config`)).json();
  assert.equal(config.channel, '#subjective');

  const emptyMessage = await (await fetch(`${ctx.baseUrl}/api/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: '#subjective', text: '' })
  })).json();
  assert.equal(emptyMessage.ok, false); // disconnected + empty text both fail closed

  const conversations = await (await fetch(`${ctx.baseUrl}/api/llm/conversations`)).json();
  assert.equal(conversations.ok, true);
  assert.deepEqual(conversations.conversations, []);
});

test('a malformed JSON body is rejected with 400 rather than crashing the request', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);

  const response = await fetch(`${ctx.baseUrl}/api/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json'
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.ok, false);
});

test('the WebSocket stream sends an initial snapshot and then broadcasts ChatCore events live', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);

  const socket = new WebSocket(ctx.wsUrl);
  const received = [];
  // Attached before awaiting 'open': the server sends its initial config/status snapshot
  // the instant the connection is accepted, which can beat a listener registered only
  // after 'open' resolves (EventEmitter doesn't replay events to late listeners).
  socket.on('message', (data) => received.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    socket.on('open', resolve);
    socket.on('error', reject);
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(received.some((event) => event.type === 'config'));
  assert.ok(received.some((event) => event.type === 'status'));

  ctx.core._broadcast('system', { target: '#subjective', text: 'hello from the core' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const systemEvent = received.find((event) => event.type === 'system');
  assert.equal(systemEvent.text, 'hello from the core');

  socket.close();
});

test('GET /api/context-menu proxies buildContextMenuModel for a nonexistent target', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);

  const result = await (await fetch(`${ctx.baseUrl}/api/context-menu?target=${encodeURIComponent('llm:codex:missing')}`)).json();
  assert.deepEqual(result, { ok: true, renamable: false, continueAs: null });
});

test('startup can call the shared history refresh function', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);
  let calls = 0;
  ctx.core.llmService.refreshHistory = async () => { calls++; return { success: true }; };
  const result = await ctx.refreshHistory('startup');
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test('LLM HTTP route passes a multiline prompt to ChatCore without truncation', async (t) => {
  const ctx = await startServer();
  t.after(ctx.close);
  const prompt = 'first line\n\n    indented line\nlast line';
  const calls = [];
  ctx.core.llmService.findConversation = () => ({ target: 'llm:codex:test', provider: 'codex' });
  ctx.core.sendLlmMessage = async (...args) => { calls.push(args); return { ok: true, pending: true }; };
  const response = await fetch(`${ctx.baseUrl}/api/llm/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'llm:codex:test', text: prompt })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pending, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], prompt);
});
