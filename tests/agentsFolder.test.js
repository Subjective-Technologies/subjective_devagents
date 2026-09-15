// The Agents folder in the chat pane: one row per registry entry, a + to add one, and a
// per-agent model picker. Models are runtime metadata in registry.md and must never
// become part of an agent's identity, so the picker re-points an agent rather than
// defining a new one.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const tick = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

const AGENTS = [
  { id: 'manager_agent', roleFile: 'roles/manager_agent.md', capability: 'orchestration', model: 'claude', exists: true },
  { id: 'coder_agent', roleFile: 'roles/coder_agent.md', capability: 'feature implementation', model: '', exists: true },
  { id: 'ghost_agent', roleFile: 'roles/ghost_agent.md', capability: 'missing file', model: '', exists: false },
];

function boot({ agents = AGENTS, withBridge = true } = {}) {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8').replace(/DEVAGENTS_DEPLOY_VERSION/g, 'test');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://devagents.subjectivetechnologies.com/' });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };

  const calls = { models: [], created: [], chats: [] };
  let current = agents.map((agent) => ({ ...agent }));
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
    listLlmProviders: () => Promise.resolve({
      ok: true, default: 'codex',
      providers: [
        { key: 'codex', label: 'Codex', available: true },
        { key: 'claude', label: 'Claude', available: true },
        { key: 'grok', label: 'Grok', available: true },
      ],
    }),
    createLlmConversation: (payload) => {
      calls.chats.push(payload);
      return Promise.resolve({ ok: true, conversation: { target: `llm:${payload.provider}:local:x`, label: payload.name, kind: 'llm', provider: payload.provider, writable: true, messages: [], events: [], icon: '' } });
    },
    log: () => {},
  };
  if (withBridge) {
    window.subjectiveChat.listAgents = () => Promise.resolve({ ok: true, agents: current.map((a) => ({ ...a })) });
    window.subjectiveChat.setAgentModel = (id, model) => {
      calls.models.push({ id, model });
      current = current.map((a) => (a.id === id ? { ...a, model } : a));
      return Promise.resolve({ ok: true, id, model });
    };
    window.subjectiveChat.createAgent = (payload) => {
      calls.created.push(payload);
      current = [...current, { id: payload.id, roleFile: `roles/${payload.id}.md`, capability: payload.capability, model: payload.model, exists: true }];
      return Promise.resolve({ ok: true, agent: current[current.length - 1] });
    };
  }
  window.SubjectiveMessageRenderer = require(path.join(ROOT, 'src', 'messageRenderer.js'));
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer.js'), 'utf8'), dom.getInternalVMContext(), { filename: 'renderer.js' });
  return { dom, window, calls };
}

const rows = (window) => [...window.document.querySelectorAll('#agentsList .agent-row')];

test('every registered agent gets a row, with its assigned model selected', async (t) => {
  const h = boot();
  t.after(() => h.dom.window.close());
  await tick(200);

  assert.deepStrictEqual(rows(h.window).map((r) => r.dataset.agent), ['manager_agent', 'coder_agent', 'ghost_agent']);
  assert.strictEqual(h.window.document.getElementById('agentsCount').textContent, '3');
  const manager = rows(h.window)[0].querySelector('.agent-model');
  assert.strictEqual(manager.value, 'claude');
  // A role may deliberately leave the model to the caller.
  assert.strictEqual(rows(h.window)[1].querySelector('.agent-model').value, '');
});

test('an agent whose role file is missing is flagged, not hidden', async (t) => {
  const h = boot();
  t.after(() => h.dom.window.close());
  await tick(200);

  const ghost = rows(h.window).find((r) => r.dataset.agent === 'ghost_agent');
  assert.ok(ghost, 'the row must still be listed');
  assert.ok(ghost.classList.contains('is-missing'));
  assert.match(ghost.title, /missing/i);
});

test('changing an agent model writes it through to the registry', async (t) => {
  const h = boot();
  t.after(() => h.dom.window.close());
  await tick(200);

  const select = rows(h.window)[1].querySelector('.agent-model');
  select.value = 'grok';
  select.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await tick(150);

  assert.deepStrictEqual(h.calls.models, [{ id: 'coder_agent', model: 'grok' }]);
});

test('the + button creates an agent and the list is re-read from disk', async (t) => {
  const h = boot();
  t.after(() => h.dom.window.close());
  await tick(200);

  h.window.document.getElementById('agentCreateButton').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  await tick(120);
  assert.ok(h.window.document.getElementById('agentDialog').hasAttribute('open'), 'dialog did not open');

  h.window.document.getElementById('agentIdInput').value = 'triage_agent';
  h.window.document.getElementById('agentCapabilityInput').value = 'incident triage';
  h.window.document.getElementById('agentModelSelect').value = 'claude';
  h.window.document.getElementById('agentForm').dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(200);

  // Spread across the realm boundary: the payload is built inside the page's own realm,
  // so its prototype is not this file's Object.
  assert.strictEqual(h.calls.created.length, 1);
  assert.deepStrictEqual({ ...h.calls.created[0] }, { id: 'triage_agent', capability: 'incident triage', model: 'claude' });
  assert.ok(rows(h.window).some((r) => r.dataset.agent === 'triage_agent'), 'new agent never appeared');
});

test('clicking an agent starts a chat on its own model', async (t) => {
  const h = boot();
  t.after(() => h.dom.window.close());
  await tick(200);

  rows(h.window)[0].querySelector('.agent-open').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  await tick(200);

  assert.strictEqual(h.calls.chats.length, 1);
  assert.strictEqual(h.calls.chats[0].provider, 'claude');
  assert.strictEqual(h.calls.chats[0].name, 'manager_agent');
});

test('an agent with no model set does not silently start on the default', async (t) => {
  const h = boot();
  t.after(() => h.dom.window.close());
  await tick(200);

  rows(h.window)[1].querySelector('.agent-open').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  await tick(200);

  assert.deepStrictEqual(h.calls.chats, [], 'a chat was started without a model chosen');
});

test('a backend with no agent registry renders no agents section at all', async (t) => {
  const h = boot({ withBridge: false });
  t.after(() => h.dom.window.close());
  await tick(200);

  assert.strictEqual(h.window.document.getElementById('agentsFolder'), null);
});

test('agents and chats share one scroll container, with no nested scrollbar', async (t) => {
  // A nested scroller made the agents a fixed-height pane stuck above the chats.
  const h = boot();
  t.after(() => h.dom.window.close());
  await tick(200);

  const list = h.window.document.getElementById('conversationList');
  const section = h.window.document.getElementById('agentsFolder');
  assert.ok(section, 'the agents section should exist');
  assert.ok(list.contains(section), 'agents must live inside the chat list, not beside it');
  assert.strictEqual(section.previousElementSibling, null, 'agents come first in the single list');

  const css = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');
  const agentRules = css.slice(css.indexOf('--- agents section'));
  assert.ok(!/\.agents-list\s*\{[^}]*overflow/.test(agentRules), '.agents-list must not scroll on its own');
  assert.ok(!/\.agents-list\s*\{[^}]*max-height/.test(agentRules), '.agents-list must not be height-capped');
});

test('a chat-list re-render keeps the agents section and its model pickers', async (t) => {
  const h = boot();
  t.after(() => h.dom.window.close());
  await tick(200);

  const before = h.window.document.getElementById('agentsFolder');
  vm.runInContext('renderConversationsNow()', h.dom.getInternalVMContext());
  await tick(150);

  const after = h.window.document.getElementById('agentsFolder');
  assert.ok(after, 'the agents section was dropped by a chat-list render');
  assert.strictEqual(after, before, 'it must be the same node, or an open <select> would be closed');
  assert.strictEqual(rows(h.window).length, 3);
});

test('the folder starts collapsed so 28 roles cannot bury the chats', async (t) => {
  const h = boot();
  t.after(() => h.dom.window.close());
  await tick(200);

  const section = h.window.document.getElementById('agentsFolder');
  assert.ok(section.classList.contains('is-collapsed'), 'expanded by default would push chats off-screen');

  section.querySelector('.agents-head').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  assert.ok(!section.classList.contains('is-collapsed'), 'the header should toggle it open');
  assert.strictEqual(h.window.localStorage.getItem('subjective-chat-agents-collapsed'), 'false');
});

test('the + button opens the dialog without collapsing the folder', async (t) => {
  const h = boot();
  t.after(() => h.dom.window.close());
  await tick(200);

  const section = h.window.document.getElementById('agentsFolder');
  section.querySelector('.agents-head').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  assert.ok(!section.classList.contains('is-collapsed'));

  h.window.document.getElementById('agentCreateButton').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  await tick(120);

  assert.ok(h.window.document.getElementById('agentDialog').hasAttribute('open'));
  assert.ok(!section.classList.contains('is-collapsed'), 'the + must not also toggle the folder');
});
