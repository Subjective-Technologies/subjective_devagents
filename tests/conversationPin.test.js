const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');

function extract(pattern) {
  const match = source.match(pattern);
  assert.ok(match, `renderer.js is missing ${pattern}`);
  return match[0];
}

// Pull out only the list-rendering code so the test runs without Electron.
const listCode = [
  extract(/^function conversationTimestamp\([^]*?^}/m),
  extract(/^function conversationSearchText\([^]*?^}/m),
  extract(/^\/\/ Pinned conversations[^]*?(?=^function conversationUserHue)/m),
  extract(/^function conversationUserHue\([^]*?^}/m),
  extract(/^function conversationUserPillHtml\([^]*?^}/m),
  extract(/^function renderConversationsNow\([^]*?^}/m),
].join('\n');

function harness(storage = new Map()) {
  const dom = new JSDOM('<div id="conversationList"></div><input id="search">');
  const { document } = dom.window;
  const opened = [];
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const conversations = new Map([
    ['#general', { target: '#general', kind: 'channel', label: '#general', sortAt: 300 }],
    ['#random', { target: '#random', kind: 'channel', label: '#random', sortAt: 200 }],
    ['#old', { target: '#old', kind: 'channel', label: '#old', sortAt: 100 }],
    ['llm:1', { target: 'llm:1', kind: 'llm', label: 'Agent chat', sortAt: 400 }],
  ]);
  const context = vm.createContext({
    document,
    localStorage,
    CSS: { escape: (value) => value },
    conversations,
    conversationList: document.getElementById('conversationList'),
    conversationSearch: document.getElementById('search'),
    conversationSearchCount: null,
    llmListTotal: 0,
    activeTarget: null,
    frameTargets: [],
    framesEnabled: () => false,
    escapeHtml: (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    setActiveTarget: (target) => opened.push(target),
    beginRenameConversation() {},
    window: { subjectiveChat: {} },
  });
  vm.runInContext(`${listCode}\nthis.api = { renderConversationsNow, toggleConversationPin };`, context);
  const order = () => [...document.querySelectorAll('.conversation-row')].map((row) => row.dataset.target);
  const pinButton = (target) =>
    document.querySelector(`.conversation-row[data-target="${target}"] .conversation-pin-button`);
  return { api: context.api, document, opened, storage, order, pinButton, search: context.conversationSearch };
}

test('every row has a pin button and default order is unchanged', () => {
  const h = harness();
  h.api.renderConversationsNow();
  assert.deepEqual(h.order(), ['#general', '#random', '#old', 'llm:1']);
  for (const target of h.order()) {
    const button = h.pinButton(target);
    assert.ok(button, `pin button for ${target}`);
    assert.equal(button.getAttribute('aria-pressed'), 'false');
  }
});

test('clicking pin moves the channel above all others without opening it', () => {
  const h = harness();
  h.api.renderConversationsNow();
  h.pinButton('#old').click();
  assert.deepEqual(h.order(), ['#old', '#general', '#random', 'llm:1']);
  assert.deepEqual(h.opened, []);
  const button = h.pinButton('#old');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.ok(button.classList.contains('is-pinned'));
  assert.ok(h.document.querySelector('.conversation-row[data-target="#old"]').classList.contains('pinned'));
});

test('pinned agent chats also go above unpinned channels; unpin restores order', () => {
  const h = harness();
  h.api.renderConversationsNow();
  h.pinButton('llm:1').click();
  h.pinButton('#random').click();
  // Pinned group keeps the normal ordering rules inside it: channels before agent chats.
  assert.deepEqual(h.order(), ['#random', 'llm:1', '#general', '#old']);
  h.pinButton('llm:1').click();
  h.pinButton('#random').click();
  assert.deepEqual(h.order(), ['#general', '#random', '#old', 'llm:1']);
});

test('pins survive a reload via localStorage', () => {
  const storage = new Map();
  const first = harness(storage);
  first.api.renderConversationsNow();
  first.pinButton('#old').click();
  assert.equal(storage.get('subjective-pinned-conversations'), '["#old"]');
  const second = harness(storage);
  second.api.renderConversationsNow();
  assert.deepEqual(second.order(), ['#old', '#general', '#random', 'llm:1']);
});

test('corrupt stored pins are ignored', () => {
  const storage = new Map([['subjective-pinned-conversations', '{not json']]);
  const h = harness(storage);
  h.api.renderConversationsNow();
  assert.deepEqual(h.order(), ['#general', '#random', '#old', 'llm:1']);
});

test('search keeps pinned matches at the top', () => {
  const h = harness();
  h.api.renderConversationsNow();
  h.pinButton('#random').click();
  h.search.value = 'r';
  h.api.renderConversationsNow();
  assert.equal(h.order()[0], '#random');
});
