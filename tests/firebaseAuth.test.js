'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/firebaseAuth.js'), 'utf8');
const token = (expiry = Date.now() / 1000 + 3600) => `header.${Buffer.from(JSON.stringify({ exp: expiry })).toString('base64url')}.signature`;
const tick = () => new Promise(resolve => setImmediate(resolve));

function load() {
  const elements = new Map();
  const element = () => ({ hidden: false, inert: false, textContent: '', disabled: true,
    addEventListener() {}, closest() { return this; }, classList: { remove() {} }, appendChild() {} });
  for (const id of ['ownerAuthPanel', 'ownerAuthStatus', 'ownerGoogleSignIn', 'ownerEmailSignIn', 'ownerSignOut']) elements.set(id, element());
  const shell = element();
  const calls = [], messages = [], sockets = [], timers = new Set();
  let handler, reloads = 0, denySession = false;
  const parent = { postMessage: (message, origin) => messages.push({ message, origin }) };
  const context = {
    URL, atob, console, Date, Promise,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    location: { href: 'https://devagents.subjectivetechnologies.com/?api=https://evil.test&token=old', reload() { reloads++; } },
    history: { replaceState() {} }, localStorage: { removeItem() {} },
    document: { referrer: 'https://dashboard.subjectivetechnologies.com/dashboard/st-backend/my-agents',
      querySelector(selector) { return selector.includes('devagents-api') ? { content: 'https://devagents-api.subjectivetechnologies.com:8080' } : shell; },
      getElementById(id) { return elements.get(id); } },
    parent,
    addEventListener(type, callback) { if (type === 'message') handler = callback; },
    async fetch(url, options = {}) {
      calls.push({ url, options });
      const denied = denySession && url.endsWith('/api/auth/session');
      return { ok: !denied, status: denied ? 401 : 200, json: async () => ({ mode: 'owner', required: true }) };
    },
    WebSocket: class {
      constructor(url) { this.url = url; this.listeners = {}; this.sent = []; sockets.push(this); }
      addEventListener(type, callback) { this.listeners[type] = callback; }
      send(data) { this.sent.push(data); }
      close() { this.closed = true; this.listeners.close?.(); }
    },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { context, calls, messages, sockets, shell, elements,
    send(value, origin = 'https://dashboard.subjectivetechnologies.com', sender = parent) {
      return handler({ origin, source: sender, data: { type: 'devagents:auth-token', token: value } });
    },
    deny() { denySession = true; }, get reloads() { return reloads; },
    close() { for (const timer of timers) clearTimeout(timer); },
  };
}

test('dashboard login gates app, ignores wrong origins/windows, and pins credential destination', async () => {
  const app = load();
  try {
    await tick();
    assert.equal(app.shell.hidden, true);
    assert.equal(app.calls.length, 1); // Only public auth configuration.
    await app.send(token(), 'https://attacker.test');
    await app.send(token(), undefined, {});
    assert.equal(app.calls.length, 1);
    const idToken = token();
    await app.send(idToken);
    await app.context.devagentsAuth.ready;
    assert.equal(app.shell.hidden, false);
    await app.context.devagentsAuth.request('/api/config');
    const request = app.calls.at(-1);
    assert.equal(request.url, 'https://devagents-api.subjectivetechnologies.com:8080/api/config');
    assert.equal(request.options.headers.Authorization, `Bearer ${idToken}`);
    assert.ok(app.calls.every(call => !call.url.includes(idToken)));
    const socket = await app.context.devagentsAuth.socket('wss://devagents-api.subjectivetechnologies.com:8080/ws');
    assert.ok(!socket.url.includes(idToken));
    socket.listeners.open();
    assert.deepEqual(JSON.parse(socket.sent[0]), { type: 'auth', token: idToken });
    await app.send('');
    assert.equal(app.reloads, 1);
    assert.equal(app.shell.hidden, true);
    assert.equal(socket.closed, true);
  } finally { app.close(); }
});

test('server denial keeps shell locked; no client claim can authorize itself', async () => {
  const app = load();
  try {
    await tick();
    app.deny();
    await app.send(token());
    assert.equal(app.shell.hidden, true);
    assert.match(app.elements.get('ownerAuthStatus').textContent, /denied/);
  } finally { app.close(); }
});

test('forced refresh requests a fresh dashboard token before next request', async () => {
  const app = load();
  try {
    await tick();
    await app.send(token());
    const refreshed = app.context.devagentsAuth.getToken(true);
    assert.equal(app.messages.at(-1).message.forceRefresh, true);
    const next = token(Date.now() / 1000 + 7200);
    await app.send(next);
    assert.equal(await refreshed, next);
  } finally { app.close(); }
});
