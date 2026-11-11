'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/firebaseAuth.js'), 'utf8');
const token = (expiry = Date.now() / 1000 + 3600) => `header.${Buffer.from(JSON.stringify({ exp: expiry })).toString('base64url')}.signature`;
const tick = () => new Promise(resolve => setImmediate(resolve));

function load(href = 'https://devagents.subjectivetechnologies.com/?api=https://evil.test&token=old') {
  const elements = new Map();
  const element = (extra = {}) => ({
    hidden: false, inert: false, textContent: '', disabled: true, value: '',
    addEventListener() {}, closest() { return this; }, classList: { remove() {} }, appendChild() {},
    querySelector() { return { disabled: false }; },
    ...extra,
  });
  const userField = element();
  const tokenField = element();
  const companyField = element();
  let onSubmit = null;
  const form = element({
    addEventListener(type, callback) { if (type === 'submit') onSubmit = callback; },
  });
  for (const [id, node] of [
    ['ownerAuthPanel', element()],
    ['ownerAuthStatus', element()],
    ['ownerIdentitySignIn', form],
    ['ownerUserId', userField],
    ['ownerFirebaseToken', tokenField],
    ['ownerCompanyName', companyField],
    ['ownerSignOut', element()],
  ]) elements.set(id, node);
  const shell = element();
  const calls = [], messages = [], sockets = [], timers = new Set();
  let handler, reloads = 0, denySession = false;
  const parent = { postMessage: (message, origin) => messages.push({ message, origin }) };
  const context = {
    URL, atob, console, Date, Promise,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    location: { href, reload() { reloads++; } },
    history: { replaceState() {} }, localStorage: { removeItem() {} },
    document: { referrer: 'https://dashboard.subjectivetechnologies.com/dashboard/st-backend/my-agents',
      querySelector(selector) { return selector.includes('devagents-api') ? { content: 'https://devagents-api.subjectivetechnologies.com:8080' } : shell; },
      getElementById(id) { return elements.get(id); } },
    parent,
    addEventListener(type, callback) { if (type === 'message') handler = callback; },
    async fetch(url, options = {}) {
      calls.push({ url, options });
      const denied = denySession && url.endsWith('/api/auth/session');
      return { ok: !denied, status: denied ? 401 : 200, json: async () => ({
        mode: 'owner', required: true, companyName: 'acme',
        parentOrigins: ['https://dashboard.subjectivetechnologies.com'],
        dashboardUrl: 'https://dashboard.subjectivetechnologies.com/dashboard/st-backend/my-agents',
        ...(denied ? { error: 'invalid firebase token' } : {}),
      }) };
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
  return { context, calls, messages, sockets, shell, elements, userField, tokenField, companyField,
    send(data, origin = 'https://dashboard.subjectivetechnologies.com', sender = parent) {
      return handler({ origin, source: sender, data });
    },
    submit() { return onSubmit({ preventDefault() {}, target: form }); },
    deny() { denySession = true; }, get reloads() { return reloads; },
    close() { for (const timer of timers) clearTimeout(timer); },
  };
}

test('dashboard login gates app, ignores wrong origins, and sends the three credentials', async () => {
  const app = load();
  try {
    await tick();
    assert.equal(app.shell.hidden, true);
    assert.equal(app.calls.length, 1);
    const idToken = token();
    await app.send({ type: 'devagents:auth', userId: 'uid-1', firebaseToken: idToken, companyName: 'acme' }, 'https://attacker.test');
    await app.send({ type: 'devagents:auth', userId: 'uid-1', firebaseToken: idToken, companyName: 'acme' }, undefined, {});
    assert.equal(app.calls.length, 1);
    await app.send({ type: 'devagents:auth', userId: 'uid-1', firebaseToken: idToken, companyName: 'acme' });
    await app.context.devagentsAuth.ready;
    assert.equal(app.shell.hidden, false);
    await app.context.devagentsAuth.request('/api/config');
    const request = app.calls.at(-1);
    assert.equal(request.url, 'https://devagents-api.subjectivetechnologies.com:8080/api/config');
    assert.equal(request.options.headers.Authorization, `Bearer ${idToken}`);
    assert.equal(request.options.headers['X-User-Id'], 'uid-1');
    assert.equal(request.options.headers['X-Company-Name'], 'acme');
    assert.ok(app.calls.every(call => !call.url.includes(idToken)));
    const socket = await app.context.devagentsAuth.socket('wss://devagents-api.subjectivetechnologies.com:8080/ws');
    assert.ok(!socket.url.includes(idToken));
    socket.listeners.open();
    assert.deepEqual(JSON.parse(socket.sent[0]), {
      type: 'auth', token: idToken, user_id: 'uid-1', company_name: 'acme',
    });
    await app.send({ type: 'devagents:auth', firebaseToken: '' });
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
    await app.send({ type: 'devagents:auth', userId: 'uid-1', firebaseToken: token(), companyName: 'acme' });
    assert.equal(app.shell.hidden, true);
    assert.match(app.elements.get('ownerAuthStatus').textContent, /invalid firebase token/);
  } finally { app.close(); }
});

test('the sign-in form posts user id, firebase token, and company name', async () => {
  const app = load('https://devagents.subjectivetechnologies.com/');
  try {
    await tick();
    const idToken = token();
    app.userField.value = ' uid-9 ';
    app.tokenField.value = idToken;
    app.companyField.value = 'acme';
    await app.submit();
    await app.context.devagentsAuth.ready;
    const session = app.calls.find(call => call.url.endsWith('/api/auth/session'));
    assert.equal(session.options.headers['X-User-Id'], 'uid-9');
    assert.equal(session.options.headers['X-Company-Name'], 'acme');
    assert.equal(session.options.headers.Authorization, `Bearer ${idToken}`);
    assert.equal(app.tokenField.value, '');
    assert.equal(app.shell.hidden, false);
  } finally { app.close(); }
});

test('forced refresh requests a fresh dashboard token before next request', async () => {
  const app = load();
  try {
    await tick();
    const first = token();
    await app.send({ type: 'devagents:auth', userId: 'uid-1', firebaseToken: first, companyName: 'acme' });
    const refreshed = app.context.devagentsAuth.getToken(true);
    assert.equal(app.messages.at(-1).message.forceRefresh, true);
    const next = token(Date.now() / 1000 + 7200);
    await app.send({ type: 'devagents:auth', userId: 'uid-1', firebaseToken: next, companyName: 'acme' });
    assert.equal(await refreshed, next);
  } finally { app.close(); }
});
