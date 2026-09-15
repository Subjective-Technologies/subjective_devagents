// There was no way to stop a running agent: the composer disables itself while a turn is
// in flight, so a turn ran until the CLI returned or the 30-minute timeout expired.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

function bootRenderer() {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8').replace(/DEVAGENTS_DEPLOY_VERSION/g, 'test');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://devagents.subjectivetechnologies.com/' });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.scrollTo = () => {};

  const cancelled = [];
  const state = { eventHandler: null };
  window.subjectiveChat = {
    getConfig: () => Promise.resolve({ channel: '#subjective', nick: 'You', host: 'h', port: 1, bookmarks: [] }),
    listLlmConversations: () => Promise.resolve({ ok: true, conversations: [], total: 0 }),
    getLlmConversation: () => Promise.resolve({ ok: false }),
    activateLlmConversation: () => Promise.resolve({ ok: true }),
    reloadLlmConversation: () => Promise.resolve({ ok: false }),
    refreshLlmHistory: () => Promise.resolve({ ok: true }),
    sendLlmMessage: () => Promise.resolve({ ok: true }),
    cancelLlmMessage: (target) => { cancelled.push(target); return Promise.resolve({ ok: true, running: true, stopped: true }); },
    onEvent: (cb) => { state.eventHandler = cb; return () => {}; },
    getSwitchUserStatus: () => Promise.resolve({ ok: true, status: { status: 'idle' } }),
    listSystemUsers: () => Promise.resolve({ ok: true, users: [] }),
    log: () => {},
  };
  window.SubjectiveMessageRenderer = require(path.join(ROOT, 'src', 'messageRenderer.js'));
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer.js'), 'utf8'), dom.getInternalVMContext(), { filename: 'renderer.js' });
  return { dom, window, cancelled, state };
}

async function openBusyChat(harness, { busy }) {
  const { state, dom } = harness;
  const target = 'llm:claude:local:probe';
  state.eventHandler({
    type: 'llm-conversation',
    conversation: { target, label: 'probe', kind: 'llm', provider: 'claude', writable: true, messages: [], icon: '', events: [] },
  });
  vm.runInContext(`setActiveTarget(${JSON.stringify(target)})`, dom.getInternalVMContext());
  state.eventHandler({ type: 'llm-busy', target, busy });
  await tick(120);
  return target;
}

const stopButton = (window) => window.document.querySelector('.chat-frame .frame-stop');

test('the Stop button appears only while the agent is working', async (t) => {
  const harness = bootRenderer();
  t.after(() => harness.dom.window.close());
  await tick(100);

  await openBusyChat(harness, { busy: false });
  assert.ok(stopButton(harness.window), 'the button should exist in the composer');
  assert.strictEqual(stopButton(harness.window).hidden, true, 'hidden while idle');

  await openBusyChat(harness, { busy: true });
  assert.strictEqual(stopButton(harness.window).hidden, false, 'shown while the turn runs');
});

test('pressing Stop asks the backend to cancel that conversation', async (t) => {
  const harness = bootRenderer();
  t.after(() => harness.dom.window.close());
  await tick(100);
  const target = await openBusyChat(harness, { busy: true });

  stopButton(harness.window).dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await tick(120);

  assert.deepStrictEqual(harness.cancelled, [target]);
});

test('Stop does nothing on an idle chat', async (t) => {
  const harness = bootRenderer();
  t.after(() => harness.dom.window.close());
  await tick(100);
  await openBusyChat(harness, { busy: false });

  const button = stopButton(harness.window);
  button.hidden = false; // force it visible; the guard must still hold
  button.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await tick(120);

  assert.deepStrictEqual(harness.cancelled, [], 'no cancel should be sent for an idle turn');
});
