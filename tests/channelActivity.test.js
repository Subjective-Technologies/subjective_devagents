const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');

function extract(pattern) {
  const match = source.match(pattern);
  assert.ok(match, `renderer.js is missing ${pattern}`);
  return match[0];
}

const listCode = [
  extract(/^function conversationTimestamp\([^]*?^}/m),
  extract(/^function conversationSearchText\([^]*?^}/m),
  extract(/^\/\/ Pinned conversations[^]*?(?=^function conversationUserHue)/m),
  extract(/^function conversationUserHue\([^]*?^}/m),
  extract(/^function conversationUserPillHtml\([^]*?^}/m),
  extract(/^function renderConversationsNow\([^]*?^}/m),
].join('\n');

function harness(conversationList) {
  const dom = new JSDOM('<div id="conversationList"></div><input id="search">');
  const { document } = dom.window;
  const timers = [];
  const conversations = new Map(conversationList.map((item) => [item.target, item]));
  const context = vm.createContext({
    document,
    localStorage: { getItem: () => null, setItem() {} },
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
    setActiveTarget() {},
    beginRenameConversation() {},
    window: { subjectiveChat: {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    Date,
  });
  vm.runInContext(
    `${listCode}\nthis.api = { renderConversationsNow, noteConversationActivity, isConversationActive, ACTIVITY_WINDOW_MS };`,
    context,
  );
  const ring = (target) =>
    document.querySelector(`.conversation-row[data-target="${target}"] .conversation-icon-cell .conversation-activity-ring`);
  const row = (target) => document.querySelector(`.conversation-row[data-target="${target}"]`);
  return { api: context.api, conversations, ring, row, timers };
}

test('idle channels show no ring', () => {
  const h = harness([{ target: '#quiet', kind: 'channel', label: '#quiet', sortAt: 1 }]);
  h.api.renderConversationsNow();
  assert.equal(h.ring('#quiet'), null);
  assert.ok(!h.row('#quiet').classList.contains('has-activity'));
});

test('a busy agent conversation shows the ring left of the name', () => {
  const h = harness([{ target: 'llm:1', kind: 'llm', label: 'Agent', busy: true, sortAt: 1 }]);
  h.api.renderConversationsNow();
  const ring = h.ring('llm:1');
  assert.ok(ring, 'ring rendered');
  assert.equal(ring.getAttribute('aria-label'), 'Activity in progress');
  const cells = [...h.row('llm:1').children].map((cell) => cell.className);
  assert.ok(cells.indexOf('conversation-icon-cell') < cells.indexOf('conversation-name-cell'));
  assert.ok(h.row('llm:1').classList.contains('has-activity'));
});

test('a fresh channel message lights the ring and schedules its expiry', () => {
  const channel = { target: '#live', kind: 'channel', label: '#live', sortAt: 1 };
  const h = harness([channel]);
  h.api.noteConversationActivity(channel, Date.now());
  h.api.renderConversationsNow();
  assert.ok(h.ring('#live'));
  assert.equal(h.timers.length, 1);
  assert.ok(h.timers[0].ms > 0 && h.timers[0].ms <= h.api.ACTIVITY_WINDOW_MS + 50);
});

test('replayed backlog (old timestamps) never lights the ring', () => {
  const channel = { target: '#old', kind: 'channel', label: '#old', sortAt: 1 };
  const h = harness([channel]);
  h.api.noteConversationActivity(channel, Date.now() - h.api.ACTIVITY_WINDOW_MS - 1000);
  h.api.renderConversationsNow();
  assert.equal(h.ring('#old'), null);
  assert.equal(h.timers.length, 0);
});

test('activity expires after the window', () => {
  const now = Date.now();
  const channel = { target: '#was', kind: 'channel', label: '#was', lastActivityAt: now - 1000 };
  const h = harness([channel]);
  assert.equal(h.api.isConversationActive(channel, now), true);
  assert.equal(h.api.isConversationActive(channel, now + h.api.ACTIVITY_WINDOW_MS), false);
});

test('styles define a rounded spinning ring with a reduced-motion fallback', () => {
  assert.match(styles, /\.conversation-activity-ring\s*{[^}]*border-radius:\s*50%/);
  assert.match(styles, /@keyframes conversation-activity-spin/);
  assert.match(styles, /prefers-reduced-motion[^]*conversation-activity-ring/);
});
