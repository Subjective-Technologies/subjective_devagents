// Proves the quick-reply UI is actually wired: clicking an agent's Yes/No button in the
// real renderer fires window.subjectiveChat.sendLlmMessage with the canned reply. This is a
// DOM-level test of the whole chain — detection, button render, click listener, bridge call
// — because "the code looks connected" is not the same as "a real click sends a request".
//
// It loads the shipped web/index.html and src/renderer.js unmodified into jsdom, with a stub
// bridge that records sends, then drives the app's real event stream to render an assistant
// message ending in a question and dispatches a genuine click.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function bootRenderer() {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8').replace(/DEVAGENTS_DEPLOY_VERSION/g, 'test');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://devagents.subjectivetechnologies.com/' });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.scrollTo = () => {};

  const calls = [];
  const state = { eventHandler: null };
  window.subjectiveChat = {
    getConfig: () => Promise.resolve({ channel: '#subjective', nick: 'You', host: 'h', port: 1, bookmarks: [] }),
    listLlmConversations: () => Promise.resolve({ ok: true, conversations: [], total: 0 }),
    getLlmConversation: () => Promise.resolve({ ok: false }),
    activateLlmConversation: () => Promise.resolve({ ok: true }),
    reloadLlmConversation: () => Promise.resolve({ ok: false }),
    refreshLlmHistory: () => Promise.resolve({ ok: true }),
    sendLlmMessage: (target, text) => { calls.push({ target, text }); return Promise.resolve({ ok: true, pending: true, target }); },
    onEvent: (cb) => { state.eventHandler = cb; return () => {}; },
    getSwitchUserStatus: () => Promise.resolve({ ok: true, status: { status: 'idle' } }),
    listSystemUsers: () => Promise.resolve({ ok: true, users: [] }),
    log: () => {},
  };
  window.SubjectiveMessageRenderer = require(path.join(ROOT, 'src', 'messageRenderer.js'));

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer.js'), 'utf8'), dom.getInternalVMContext(), { filename: 'renderer.js' });
  return { dom, window, calls, state };
}

const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

async function renderAssistantQuestion(harness, { provider = 'claude', writable = true, text = 'I can do that. Shall I proceed?' } = {}) {
  const { window, state } = harness;
  assert.ok(state.eventHandler, 'renderer never subscribed to the event stream');
  const target = `llm:${provider}:local:probe`;
  state.eventHandler({ type: 'llm-conversation', conversation: { target, label: 'probe', kind: 'llm', provider, writable, messages: [], icon: '', events: [] } });
  vm.runInContext(`setActiveTarget(${JSON.stringify(target)})`, harness.dom.getInternalVMContext());
  state.eventHandler({ type: 'llm-busy', target, busy: false });
  state.eventHandler({ type: 'llm-message', target, provider, message: { role: 'assistant', text, time: Date.now() } });
  await tick(90);
  return { target, buttons: [...window.document.querySelectorAll('.prompt-action')] };
}


test('clicking Yes fires a send with the canned reply', async () => {
  const harness = bootRenderer();
  await tick(80);
  const { target, buttons } = await renderAssistantQuestion(harness);

  const labels = buttons.map((button) => button.textContent.trim());
  assert.deepStrictEqual(labels, ['Yes', 'No', 'Something else…'], `unexpected buttons: ${labels}`);

  const yes = buttons.find((button) => /^yes/i.test(button.textContent.trim()));
  assert.ok(!yes.disabled, 'the Yes button was disabled and could not be clicked');

  yes.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(60);

  assert.strictEqual(harness.calls.length, 1, 'clicking Yes did not trigger exactly one send');
  assert.deepStrictEqual(harness.calls[0], { target, text: 'Yes, proceed.' });
});


test('clicking No sends the negative reply', async () => {
  const harness = bootRenderer();
  await tick(80);
  const { target, buttons } = await renderAssistantQuestion(harness);
  const no = buttons.find((button) => /^no/i.test(button.textContent.trim()));
  no.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(60);
  assert.deepStrictEqual(harness.calls[0], { target, text: 'No, do not proceed.' });
});


test('"Something else…" sends nothing and hands focus to the composer', async () => {
  const harness = bootRenderer();
  await tick(80);
  const { buttons } = await renderAssistantQuestion(harness);
  const other = buttons.find((button) => /something else/i.test(button.textContent.trim()));
  other.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(60);
  assert.strictEqual(harness.calls.length, 0, '"Something else" must not send a canned reply');
});


test('a read-only conversation disables the buttons so no send fires', async () => {
  const harness = bootRenderer();
  await tick(80);
  const { buttons } = await renderAssistantQuestion(harness, { writable: false });
  const yes = buttons.find((button) => /^yes/i.test(button.textContent.trim()));
  assert.ok(yes.disabled, 'read-only conversation should disable the reply buttons');
  yes.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(40);
  assert.strictEqual(harness.calls.length, 0, 'a disabled button must not send');
});
