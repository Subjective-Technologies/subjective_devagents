// The web UI talks to a backend that is no longer necessarily the origin serving the page
// (the API lives at devagents-api.subjectivetechnologies.com:8080). These tests pin how
// that base is resolved and that every call and the event socket are built from it - a
// single relative fetch left behind would silently hit the page's own origin and 404.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB_DIR = path.join(__dirname, '..', 'web');
const BRIDGE_SOURCE = fs.readFileSync(path.join(WEB_DIR, 'webBridge.js'), 'utf8');
const TERMINAL_SOURCE = fs.readFileSync(path.join(WEB_DIR, 'terminalWebBridge.js'), 'utf8');

// Minimal browser stand-in: enough DOM/URL/storage surface for the bridges to initialise,
// recording every URL they reach for so the assertions can inspect them.
function loadBridge(source, {
  metaApi = '', search = '', stored = null, storedToken = null, status = 200,
  href = 'https://devagents.subjectivetechnologies.com/'
} = {}) {
  const calls = [];
  const sockets = [];
  const storage = new Map();
  if (stored) storage.set('devagents.apiBase', stored);
  if (storedToken) storage.set('devagents.apiToken', storedToken);

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      sockets.push(url);
    }
    addEventListener() {}
    close() {}
  }

  const context = {
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    fetch: (url, options) => {
      calls.push({
        url: String(url),
        method: (options && options.method) || 'GET',
        headers: (options && options.headers) || {}
      });
      return Promise.resolve({ ok: status < 400, status, json: async () => ({ ok: status < 400 }) });
    },
    WebSocket: FakeWebSocket,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value)
    },
    location: {
      href,
      protocol: new URL(href).protocol,
      host: new URL(href).host,
      pathname: new URL(href).pathname,
      hash: '',
      search
    },
    // The bridge strips a seeded ?token= from the address bar so it does not leak through
    // history or a Referer header; capture what it replaced the URL with.
    history: { replaceState: (_state, _title, nextUrl) => { context.replacedUrl = nextUrl; } },
    document: {
      querySelector: (selector) =>
        (selector.includes('devagents-api') && metaApi !== null ? { content: metaApi } : null),
      createElement: () => ({ style: {}, addEventListener() {}, appendChild() {}, remove() {}, classList: { add() {} } }),
      addEventListener() {},
      removeEventListener() {},
      body: { appendChild() {} }
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, calls, sockets, storage };
}

test('every request goes to the configured API origin, not the page origin', async () => {
  const { context, calls } = loadBridge(BRIDGE_SOURCE, { metaApi: 'https://devagents-api.subjectivetechnologies.com:8080' });
  await context.window.subjectiveChat.getConfig();
  await context.window.subjectiveChat.listLlmConversations({ limit: 5 });
  await context.window.subjectiveChat.sendLlmMessage('llm:codex:x', 'hello', []);

  assert.ok(calls.length >= 3, 'expected the bridge to issue requests');
  for (const call of calls) {
    assert.ok(
      call.url.startsWith('https://devagents-api.subjectivetechnologies.com:8080/api/'),
      `request went to the wrong origin: ${call.url}`
    );
  }
});

test('the event socket is derived from the API base, not from location', () => {
  const { sockets } = loadBridge(BRIDGE_SOURCE, { metaApi: 'https://devagents-api.subjectivetechnologies.com:8080' });
  assert.deepStrictEqual(sockets, ['wss://devagents-api.subjectivetechnologies.com:8080/ws']);
});

test('no API base falls back to same-origin so a local checkout still works', async () => {
  const { context, calls, sockets } = loadBridge(BRIDGE_SOURCE, { metaApi: '', href: 'http://127.0.0.1:8787/' });
  await context.window.subjectiveChat.getConfig();
  assert.strictEqual(calls[0].url, '/api/config');
  assert.deepStrictEqual(sockets, ['ws://127.0.0.1:8787/ws']);
});

test('?api= overrides the meta tag and is remembered for later loads', async () => {
  const { context, calls, storage } = loadBridge(BRIDGE_SOURCE, {
    metaApi: 'https://devagents-api.subjectivetechnologies.com:8080',
    search: '?api=http://100.92.112.62:8787'
  });
  await context.window.subjectiveChat.getConfig();
  assert.strictEqual(calls[0].url, 'http://100.92.112.62:8787/api/config');
  assert.strictEqual(storage.get('devagents.apiBase'), 'http://100.92.112.62:8787');
});

test('a stored base is used when the page ships no meta tag', async () => {
  const { context, calls } = loadBridge(BRIDGE_SOURCE, { metaApi: '', stored: 'https://elsewhere.example:9000' });
  await context.window.subjectiveChat.getConfig();
  assert.strictEqual(calls[0].url, 'https://elsewhere.example:9000/api/config');
});

test('a trailing slash on the configured base does not produce a double slash', async () => {
  const { context, calls } = loadBridge(BRIDGE_SOURCE, { metaApi: 'https://devagents-api.subjectivetechnologies.com:8080/' });
  await context.window.subjectiveChat.getConfig();
  assert.strictEqual(calls[0].url, 'https://devagents-api.subjectivetechnologies.com:8080/api/config');
});

test('the backend-fact endpoints are exposed on the bridge', async () => {
  const { context, calls } = loadBridge(BRIDGE_SOURCE, { metaApi: 'https://devagents-api.subjectivetechnologies.com:8080' });
  const bridge = context.window.subjectiveChat;
  // The page's own stamped version describes whoever served the HTML, which is no longer
  // the machine answering calls - the UI has to be able to ask the API instead.
  for (const method of ['getVersion', 'getDatasources', 'getD1SyncStatus', 'syncD1Now']) {
    assert.strictEqual(typeof bridge[method], 'function', `${method} is missing from the bridge`);
  }
  await bridge.getVersion();
  await bridge.getDatasources();
  await bridge.getD1SyncStatus();
  assert.deepStrictEqual(
    calls.map((call) => call.url.replace('https://devagents-api.subjectivetechnologies.com:8080', '')),
    ['/api/version', '/api/datasources', '/api/d1/sync']
  );
  assert.strictEqual(bridge.apiBase, 'https://devagents-api.subjectivetechnologies.com:8080');
});

test('the terminal bridge targets the same backend as the main page', async () => {
  const { context, calls, sockets } = loadBridge(TERMINAL_SOURCE, {
    metaApi: 'https://devagents-api.subjectivetechnologies.com:8080',
    href: 'https://devagents.subjectivetechnologies.com/terminal.html?username=worktwins'
  });
  assert.deepStrictEqual(sockets, ['wss://devagents-api.subjectivetechnologies.com:8080/ws']);
  await context.window.terminalBridge.sendInput('ls\n');
  assert.ok(
    calls.some((call) => call.url === 'https://devagents-api.subjectivetechnologies.com:8080/api/switchuser/pty-input'),
    `pty input did not reach the API: ${JSON.stringify(calls)}`
  );
});

test('no relative /api path is left in either bridge', () => {
  // A literal fetch('/api/...') would resolve against the page origin and 404 in the
  // split-origin deployment. Every call must go through the apiUrl() helper.
  for (const [name, source] of [['webBridge.js', BRIDGE_SOURCE], ['terminalWebBridge.js', TERMINAL_SOURCE]]) {
    const bareFetch = source.match(/fetch\(\s*['"`]\/api\//g) || [];
    assert.strictEqual(bareFetch.length, 0, `${name} still fetches a relative /api path`);
  }
});

// --- API token -------------------------------------------------------------------------
// The backend requires a shared secret. It must never be stamped into the public page, so
// the browser seeds it once from ?token= and remembers it.

test('the token rides as a header on every request', async () => {
  const { context, calls } = loadBridge(BRIDGE_SOURCE, {
    metaApi: 'https://api.example.test:8080',
    stored: null,
    search: '?token=secret-abc',
  });
  await context.window.subjectiveChat.getConfig();
  assert.strictEqual(calls[0].headers['X-DevAgents-Token'], 'secret-abc');
});

test('a seeded token is remembered and kept out of the URL', () => {
  const { storage, context } = loadBridge(BRIDGE_SOURCE, {
    metaApi: 'https://api.example.test:8080',
    search: '?token=secret-abc',
  });
  assert.strictEqual(storage.get('devagents.apiToken'), 'secret-abc');
  // Left in the address bar it would leak through history and Referer headers.
  assert.ok(context.replacedUrl !== undefined, 'the token was not stripped from the URL');
  assert.ok(!String(context.replacedUrl).includes('secret-abc'));
});

test('the socket carries the token in the query string', () => {
  // A browser cannot set headers on a WebSocket handshake.
  const { sockets } = loadBridge(BRIDGE_SOURCE, {
    metaApi: 'https://api.example.test:8080',
    stored: null,
    search: '?token=secret-abc',
  });
  assert.strictEqual(sockets[0], 'wss://api.example.test:8080/ws?token=secret-abc');
});

test('a stored token is reused on later loads without a query parameter', async () => {
  const { context, calls, sockets } = loadBridge(BRIDGE_SOURCE, {
    metaApi: 'https://api.example.test:8080',
    storedToken: 'remembered-xyz',
  });
  await context.window.subjectiveChat.getConfig();
  assert.strictEqual(calls[0].headers['X-DevAgents-Token'], 'remembered-xyz');
  assert.ok(sockets[0].endsWith('?token=remembered-xyz'));
});

test('a 401 is reported as locked rather than as an empty result', async () => {
  // Without this the sidebar renders empty and the app looks broken instead of locked.
  const { context } = loadBridge(BRIDGE_SOURCE, {
    metaApi: 'https://api.example.test:8080',
    status: 401,
  });
  const result = await context.window.subjectiveChat.getConfig();
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.unauthorized, true);
  assert.match(result.error, /token/i);
});

test('no token configured still sends a clean request', async () => {
  const { context, calls, sockets } = loadBridge(BRIDGE_SOURCE, { metaApi: 'https://api.example.test:8080' });
  await context.window.subjectiveChat.getConfig();
  assert.strictEqual(calls[0].headers['X-DevAgents-Token'], undefined);
  assert.ok(!sockets[0].includes('token='));
});

test('meta wins over stored — request goes to the meta origin', async () => {
  const { context, calls } = loadBridge(BRIDGE_SOURCE, {
    metaApi: 'https://devagents-api.subjectivetechnologies.com:8080',
    stored: 'https://stale-old-origin.example',
  });
  await context.window.subjectiveChat.getConfig();
  assert.ok(
    calls[0].url.startsWith('https://devagents-api.subjectivetechnologies.com:8080/api/'),
    `stale stored base shadowed the meta tag: ${calls[0].url}`,
  );
});

test('?api= still overrides even when a meta tag is present', async () => {
  const { context, calls, storage } = loadBridge(BRIDGE_SOURCE, {
    metaApi: 'https://devagents-api.subjectivetechnologies.com:8080',
    search: '?api=http://100.92.112.62:8787',
  });
  await context.window.subjectiveChat.getConfig();
  assert.strictEqual(calls[0].url, 'http://100.92.112.62:8787/api/config');
  assert.strictEqual(storage.get('devagents.apiBase'), 'http://100.92.112.62:8787');
});
