const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function harness(clear, kind = 'llm') {
  const chat = { kind, label: 'Keep pane', events: ['old history'], unread: 1 };
  const alerts = [];
  const context = vm.createContext({
    conversations: new Map([['target', chat]]),
    window: { subjectiveChat: { clearLlmConversation: clear }, alert: (text) => alerts.push(text) },
    upsertLlmConversation: (payload) => { chat.events = payload.messages; },
    framesEnabled: () => true,
    renderVisibleFrameTranscripts() {}, renderConversations() {}, rendererLog() {},
  });
  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
  vm.runInContext(renderer.match(/^async function clearConversationMessages\([^]*?^}/m)[0], context);
  return { chat, alerts, clear: () => context.clearConversationMessages('target') };
}

test('saved history remains visible until server confirms clear', async () => {
  let finish;
  let calls = 0;
  const h = harness(() => { calls += 1; return new Promise((resolve) => { finish = resolve; }); });
  const pending = h.clear();
  await h.clear();
  assert.equal(calls, 1);
  assert.equal(h.chat.events.length, 1);
  finish({ ok: true, conversation: { messages: [] } });
  await pending;
  assert.equal(h.chat.events.length, 0);
  assert.equal(h.chat.label, 'Keep pane');
});

test('server refusal and transport failure preserve messages', async () => {
  for (const clear of [async () => ({ ok: false, error: 'Read only' }), async () => { throw new Error('Offline'); }]) {
    const h = harness(clear);
    await h.clear();
    assert.equal(h.chat.events.length, 1);
    assert.equal(h.alerts.length, 1);
    assert.equal(h.chat.clearing, false);
  }
});

test('older desktop bridge reports unsupported clear instead of pretending success', async () => {
  const h = harness(undefined);
  await h.clear();
  assert.equal(h.chat.events.length, 1);
  assert.match(h.alerts[0], /does not support/);
});

test('IRC clears ephemeral transcript without a backend call', async () => {
  const h = harness(() => { throw new Error('must not call'); }, 'channel');
  await h.clear();
  assert.equal(h.chat.events.length, 0);
  assert.equal(h.alerts.length, 0);
});
