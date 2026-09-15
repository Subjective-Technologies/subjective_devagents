// The "new chat" agent picker hard-coded its <option>s in web/index.html and
// src/index.html, so it drifted from the backend it talks to: Grok was creatable through
// the FastAPI service but never offered, while Cursor was offered on hosts where its
// datasource module is absent. The picker must come from the backend.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

function bootRenderer({ providers } = {}) {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8').replace(/DEVAGENTS_DEPLOY_VERSION/g, 'test');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://devagents.subjectivetechnologies.com/' });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.scrollTo = () => {};

  window.subjectiveChat = {
    getConfig: () => Promise.resolve({ channel: '#subjective', nick: 'You', host: 'h', port: 1, bookmarks: [] }),
    listLlmConversations: () => Promise.resolve({ ok: true, conversations: [], total: 0 }),
    getLlmConversation: () => Promise.resolve({ ok: false }),
    activateLlmConversation: () => Promise.resolve({ ok: true }),
    reloadLlmConversation: () => Promise.resolve({ ok: false }),
    refreshLlmHistory: () => Promise.resolve({ ok: true }),
    sendLlmMessage: () => Promise.resolve({ ok: true }),
    onEvent: () => () => {},
    getSwitchUserStatus: () => Promise.resolve({ ok: true, status: { status: 'idle' } }),
    listSystemUsers: () => Promise.resolve({ ok: true, users: [] }),
    log: () => {},
  };
  if (providers !== undefined) window.subjectiveChat.listLlmProviders = () => Promise.resolve(providers);
  window.SubjectiveMessageRenderer = require(path.join(ROOT, 'src', 'messageRenderer.js'));

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer.js'), 'utf8'), dom.getInternalVMContext(), { filename: 'renderer.js' });
  return { dom, window };
}

const options = (window) =>
  [...window.document.getElementById('llmProviderSelect').options].map((o) => ({ value: o.value, text: o.textContent }));

test('the picker offers every agent the backend reports, Grok included', async () => {
  const { window } = bootRenderer({
    providers: {
      ok: true,
      default: 'codex',
      providers: [
        { key: 'codex', label: 'Codex', available: true },
        { key: 'claude', label: 'Claude', available: true },
        { key: 'cursor', label: 'Cursor', available: true },
        { key: 'grok', label: 'Grok', available: true },
      ],
    },
  });
  await tick(120);

  assert.deepStrictEqual(options(window).map((o) => o.value), ['codex', 'claude', 'cursor', 'grok']);
  assert.strictEqual(window.document.getElementById('llmProviderSelect').value, 'codex');
});

test('an agent whose datasource is missing stays selectable but is flagged', async () => {
  // It can still run through its exported bundle, so hiding it would remove a working
  // option — the mistake the hard-coded list made in the other direction.
  const { window } = bootRenderer({
    providers: {
      ok: true,
      default: 'codex',
      providers: [
        { key: 'codex', label: 'Codex', available: true },
        { key: 'cursor', label: 'Cursor', available: false },
      ],
    },
  });
  await tick(120);

  const cursor = options(window).find((o) => o.value === 'cursor');
  assert.ok(cursor, 'cursor must remain selectable');
  assert.match(cursor.text, /unavailable/i);
});

test('a backend that cannot list agents leaves the shipped options alone', async () => {
  const { window } = bootRenderer({ providers: { ok: false } });
  await tick(120);

  const values = options(window).map((o) => o.value);
  assert.ok(values.includes('codex'), `picker was emptied: ${values}`);
});

test('the shipped web fallback already lists every agent the FastAPI backend creates', () => {
  // Belt and braces for the moment before loadLlmProviders() resolves.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  const select = html.slice(html.indexOf('id="llmProviderSelect"'));
  for (const key of ['codex', 'claude', 'cursor', 'grok']) {
    assert.ok(select.includes(`value="${key}"`), `web/index.html is missing ${key}`);
  }
});

test('the run-as list is rebuilt per agent, since logins differ between them', async (t) => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8').replace(/DEVAGENTS_DEPLOY_VERSION/g, 'test');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://devagents.subjectivetechnologies.com/' });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.scrollTo = () => {};

  const asked = [];
  const created = [];
  const byProvider = {
    codex: [{ username: 'subjective', current: true, ready: true }, { username: 'goldenthinker', current: false, ready: true }],
    claude: [{ username: 'subjective', current: true, ready: true }],
  };
  window.subjectiveChat = {
    getConfig: () => Promise.resolve({ channel: '#subjective', nick: 'You', host: 'h', port: 1, bookmarks: [] }),
    listLlmConversations: () => Promise.resolve({ ok: true, conversations: [], total: 0 }),
    getLlmConversation: () => Promise.resolve({ ok: false }),
    activateLlmConversation: () => Promise.resolve({ ok: true }),
    reloadLlmConversation: () => Promise.resolve({ ok: false }),
    refreshLlmHistory: () => Promise.resolve({ ok: true }),
    sendLlmMessage: () => Promise.resolve({ ok: true }),
    onEvent: () => () => {},
    getSwitchUserStatus: () => Promise.resolve({ ok: true, status: { status: 'idle' } }),
    listSystemUsers: () => Promise.resolve({ ok: true, users: [] }),
    getLlmStatus: () => Promise.resolve({ ok: true, cli_version: 'test' }),
    listLlmProviders: () => Promise.resolve({
      ok: true, default: 'codex',
      providers: [{ key: 'codex', label: 'Codex', available: true }, { key: 'claude', label: 'Claude', available: true }],
    }),
    listProviderSessions: (provider) => {
      asked.push(provider);
      return Promise.resolve({ ok: true, provider, currentUser: 'subjective', users: byProvider[provider] || [] });
    },
    createLlmConversation: (payload) => { created.push(payload); return Promise.resolve({ ok: false, error: 'stop here' }); },
    log: () => {},
  };
  window.SubjectiveMessageRenderer = require(path.join(ROOT, 'src', 'messageRenderer.js'));
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer.js'), 'utf8'), dom.getInternalVMContext(), { filename: 'renderer.js' });
  await tick(150);

  vm.runInContext('openLlmDialog()', dom.getInternalVMContext());
  await tick(150);

  const runAs = window.document.getElementById('llmOsUserSelect');
  assert.deepStrictEqual(
    [...runAs.options].map((o) => o.value),
    ['', 'goldenthinker'],
    'our own account must map to an empty osUser; others by name'
  );
  assert.match([...runAs.options][0].textContent, /this machine/i);

  // Switching agent re-asks, because the Codex logins are not the Claude ones.
  window.document.getElementById('llmProviderSelect').value = 'claude';
  window.document.getElementById('llmProviderSelect').dispatchEvent(new window.Event('change'));
  await tick(150);
  assert.deepStrictEqual([...runAs.options].map((o) => o.value), ['']);
  assert.ok(asked.includes('codex') && asked.includes('claude'), `asked: ${asked}`);

  // And the chosen account reaches the create call.
  window.document.getElementById('llmProviderSelect').value = 'codex';
  window.document.getElementById('llmProviderSelect').dispatchEvent(new window.Event('change'));
  await tick(150);
  runAs.value = 'goldenthinker';
  window.document.getElementById('llmNameInput').value = 'pair with goldenthinker';
  window.document.getElementById('llmForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(150);

  assert.strictEqual(created.length, 1, 'create was never called');
  assert.strictEqual(created[0].osUser, 'goldenthinker');
  assert.strictEqual(created[0].provider, 'codex');
});
