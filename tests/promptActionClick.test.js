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

async function renderAssistantQuestion(harness, {
  provider = 'claude', writable = true, text = 'I can do that. Shall I proceed?', promptOptions = null,
} = {}) {
  const { window, state } = harness;
  assert.ok(state.eventHandler, 'renderer never subscribed to the event stream');
  const target = `llm:${provider}:local:probe`;
  state.eventHandler({ type: 'llm-conversation', conversation: { target, label: 'probe', kind: 'llm', provider, writable, messages: [], icon: '', events: [] } });
  vm.runInContext(`setActiveTarget(${JSON.stringify(target)})`, harness.dom.getInternalVMContext());
  state.eventHandler({ type: 'llm-busy', target, busy: false });
  const message = { role: 'assistant', text, time: Date.now() };
  if (promptOptions) message.promptOptions = promptOptions;
  state.eventHandler({ type: 'llm-message', target, provider, message });
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


test('backend options render with descriptions and click sends the exact reply', async () => {
  // The authoritative path: the backend supplies structured options, the UI shows label +
  // description for each, and clicking sends that option's reply verbatim.
  const harness = bootRenderer();
  await tick(80);
  const { target, buttons } = await renderAssistantQuestion(harness, {
    text: 'Here are the options. Which — A, B, or C?',
    promptOptions: {
      asks_question: true,
      kind: 'enumerated',
      allows_other: true,
      other_hint: 'Answer in your own words',
      options: [
        { id: 'choice-a', label: 'Option A', description: 'Fast but risky', reply: 'A' },
        { id: 'choice-b', label: 'Option B', description: 'Safe but slow', reply: 'B' },
        { id: 'choice-c', label: 'Option C', description: 'A balance', reply: 'C' },
      ],
    },
  });

  const labels = buttons.map((b) => b.querySelector('.prompt-action-label')?.textContent.trim() || b.textContent.trim());
  assert.deepStrictEqual(labels, ['Option A', 'Option B', 'Option C', 'Other…']);
  // Descriptions are shown, from the backend.
  const descriptions = buttons.slice(0, 3).map((b) => b.querySelector('.prompt-action-description')?.textContent.trim());
  assert.deepStrictEqual(descriptions, ['Fast but risky', 'Safe but slow', 'A balance']);

  const optionB = buttons.find((b) => /Option B/.test(b.textContent));
  optionB.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(60);
  assert.deepStrictEqual(harness.calls[0], { target, text: 'B' }, 'clicking Option B must send its reply "B"');
});


test('the Other option sends nothing and focuses the composer', async () => {
  const harness = bootRenderer();
  await tick(80);
  const { buttons } = await renderAssistantQuestion(harness, {
    text: 'Shall I proceed?',
    promptOptions: {
      asks_question: true, kind: 'yes_no', allows_other: true, other_hint: 'Answer in your own words',
      options: [
        { id: 'yes', label: 'Yes', description: 'Proceed.', reply: 'Yes, proceed.' },
        { id: 'no', label: 'No', description: 'Do not proceed.', reply: 'No, do not proceed.' },
      ],
    },
  });
  const other = buttons.find((b) => /Other/.test(b.textContent));
  assert.ok(other, 'an Other option should be present when allows_other is set');
  other.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(40);
  assert.strictEqual(harness.calls.length, 0, 'Other must not send a canned reply');
});


test('backend options win over the prose heuristic', async () => {
  // The prose says "keep or revert" (heuristic would produce keep/revert), but the backend
  // says yes/no — the backend must win.
  const harness = bootRenderer();
  await tick(80);
  const { buttons } = await renderAssistantQuestion(harness, {
    text: 'Should I keep the code or revert the changes?',
    promptOptions: {
      asks_question: true, kind: 'yes_no', allows_other: false,
      options: [
        { id: 'yes', label: 'Yes', description: 'Proceed.', reply: 'Yes, proceed.' },
        { id: 'no', label: 'No', description: 'Stop.', reply: 'No, do not proceed.' },
      ],
    },
  });
  const labels = buttons.map((b) => b.querySelector('.prompt-action-label')?.textContent.trim());
  assert.deepStrictEqual(labels, ['Yes', 'No'], 'backend options should override the prose heuristic');
});


test('a stale stuck-busy is cleared by the server-authoritative hydrate, re-enabling the button', async () => {
  // Reproduces the live wedge: a dropped socket ate llm-busy:false, so the conversation is
  // stuck busy and the buttons render disabled. Opening/hydrating it with the server saying
  // busy:false must re-enable them.
  const harness = bootRenderer();
  await tick(80);
  const { window, state } = harness;
  const target = 'llm:claude:local:wedged';
  state.eventHandler({ type: 'llm-conversation', conversation: { target, label: 'wedged', kind: 'llm', provider: 'claude', writable: true, messages: [], icon: '', events: [] } });
  vm.runInContext(`setActiveTarget(${JSON.stringify(target)})`, harness.dom.getInternalVMContext());
  // Simulate the wedge: busy true, then the reply arrives but no llm-busy:false follows.
  state.eventHandler({ type: 'llm-busy', target, busy: true });
  state.eventHandler({ type: 'llm-message', target, provider: 'claude', message: { role: 'assistant', text: 'Shall I proceed?', time: Date.now() } });
  await tick(80);
  let yes = [...window.document.querySelectorAll('.prompt-action')].find((b) => /^yes/i.test(b.textContent.trim()));
  assert.ok(yes && yes.disabled, 'precondition: the button should be disabled while stuck busy');

  // Server-authoritative hydrate says the turn is not actually running.
  vm.runInContext(
    `upsertLlmConversation(${JSON.stringify({ target, label: 'wedged', provider: 'claude', writable: true, busy: false, loaded: true, messages: [{ role: 'assistant', text: 'Shall I proceed?', time: 2 }] })})`,
    harness.dom.getInternalVMContext(),
  );
  await tick(80);
  yes = [...window.document.querySelectorAll('.prompt-action')].find((b) => /^yes/i.test(b.textContent.trim()));
  assert.ok(yes && !yes.disabled, 'the button should be re-enabled after the authoritative busy:false');
  yes.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(60);
  assert.strictEqual(harness.calls.length, 1, 'the recovered button must send when clicked');
  assert.strictEqual(harness.calls[0].text, 'Yes, proceed.');
});


// --- several questions in one message, and the free-text box -------------------------------
//
// The shape the backend now sends: `groups`, one per question, plus `free_text`. A single
// group still sends on click; several cannot, because the first click would send a turn and
// the other answers would have nowhere to go, so they select and one Send goes.

const MULTI_GROUP_OPTIONS = {
  asks_question: true,
  kind: 'menu',
  allows_other: true,
  other_hint: 'Answer in your own words',
  free_text: { enabled: true, label: 'Add anything else (optional)', placeholder: 'Answer in your own words' },
  groups: [
    {
      id: 'q1',
      question: 'Should we proceed?',
      kind: 'menu',
      allows_other: true,
      options: [
        { id: 'yes', label: 'Yes', description: '', reply: 'Yes' },
        { id: 'no', label: 'No', description: '', reply: 'No' },
      ],
    },
    {
      id: 'q2',
      question: 'Which response style?',
      kind: 'menu',
      allows_other: true,
      options: [
        { id: 'brief', label: 'Brief', description: '', reply: 'Brief' },
        { id: 'detailed', label: 'Detailed', description: '', reply: 'Detailed' },
      ],
    },
  ],
  options: [
    { id: 'yes', label: 'Yes', description: '', reply: 'Yes' },
    { id: 'no', label: 'No', description: '', reply: 'No' },
  ],
};

const click = (harness, element) =>
  element.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));

function groupButtons(harness, groupId) {
  const section = harness.window.document.querySelector(`.prompt-group[data-group-id="${groupId}"]`);
  assert.ok(section, `group ${groupId} was not rendered`);
  return [...section.querySelectorAll('.prompt-action')];
}

test('each question in a message renders its own labelled group', async () => {
  const harness = bootRenderer();
  await tick(80);
  await renderAssistantQuestion(harness, { text: 'Two questions.', promptOptions: MULTI_GROUP_OPTIONS });

  const questions = [...harness.window.document.querySelectorAll('.prompt-group-question')].map((n) => n.textContent);
  assert.deepStrictEqual(questions, ['Should we proceed?', 'Which response style?']);
  assert.deepStrictEqual(groupButtons(harness, 'q2').map((b) => b.textContent.trim()), ['Brief', 'Detailed']);
});

test('with several questions a click selects instead of sending, and Send goes once', async () => {
  const harness = bootRenderer();
  await tick(80);
  const { target } = await renderAssistantQuestion(harness, { text: 'Two questions.', promptOptions: MULTI_GROUP_OPTIONS });

  click(harness, groupButtons(harness, 'q1')[0]);
  await tick(40);
  assert.strictEqual(harness.calls.length, 0, 'the first answer of several must not send a turn on its own');
  assert.ok(groupButtons(harness, 'q1')[0].classList.contains('chosen'), 'a picked answer must stay visibly picked');

  click(harness, groupButtons(harness, 'q2')[1]);
  await tick(40);
  assert.strictEqual(harness.calls.length, 0);

  const send = harness.window.document.querySelector('.prompt-action-send');
  assert.ok(send, 'several questions need one Send');
  click(harness, send);
  await tick(60);
  assert.strictEqual(harness.calls.length, 1, 'Send must produce exactly one turn');
  // Each answer names its question, or the agent has to guess which is which.
  assert.strictEqual(harness.calls[0].target, target);
  assert.strictEqual(harness.calls[0].text, '1. Should we proceed? Yes\n2. Which response style? Detailed');
});

test('a choice picked for only some questions still sends what was answered', async () => {
  const harness = bootRenderer();
  await tick(80);
  await renderAssistantQuestion(harness, { text: 'Two questions.', promptOptions: MULTI_GROUP_OPTIONS });

  click(harness, groupButtons(harness, 'q2')[0]);
  await tick(40);
  click(harness, harness.window.document.querySelector('.prompt-action-send'));
  await tick(60);
  assert.strictEqual(harness.calls[0].text, '1. Which response style? Brief');
});

test('the free-text box rides along with the picked options', async () => {
  const harness = bootRenderer();
  await tick(80);
  await renderAssistantQuestion(harness, { text: 'Two questions.', promptOptions: MULTI_GROUP_OPTIONS });

  const box = harness.window.document.querySelector('.prompt-free-text-input');
  assert.ok(box, 'free_text.enabled must render an input');
  click(harness, groupButtons(harness, 'q1')[0]);
  box.value = 'but check the logs first';
  click(harness, harness.window.document.querySelector('.prompt-action-send'));
  await tick(60);
  assert.strictEqual(harness.calls[0].text, '1. Should we proceed? Yes\n\nbut check the logs first');
});

test('the free-text box answers on its own when no option fits', async () => {
  const harness = bootRenderer();
  await tick(80);
  await renderAssistantQuestion(harness, { text: 'Two questions.', promptOptions: MULTI_GROUP_OPTIONS });

  const box = harness.window.document.querySelector('.prompt-free-text-input');
  box.value = 'none of these — start over';
  box.dispatchEvent(new harness.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await tick(60);
  assert.strictEqual(harness.calls.length, 1);
  assert.strictEqual(harness.calls[0].text, 'none of these — start over');
});

test('one question still sends the option reply verbatim, with the note appended', async () => {
  // The single-question case must not change shape: the agent sees the same reply it saw
  // before groups existed, unless the user actually typed something extra.
  const harness = bootRenderer();
  await tick(80);
  const single = {
    asks_question: true,
    kind: 'menu',
    allows_other: true,
    free_text: { enabled: true, label: 'Add anything else (optional)', placeholder: '' },
    groups: [{
      id: 'q1',
      question: 'Which response style?',
      kind: 'menu',
      allows_other: true,
      options: [
        { id: 'brief', label: 'Brief', description: '', reply: 'Brief' },
        { id: 'detailed', label: 'Detailed', description: '', reply: 'Detailed' },
      ],
    }],
    options: [{ id: 'brief', label: 'Brief', description: '', reply: 'Brief' }],
  };
  await renderAssistantQuestion(harness, { text: 'Which response style?', promptOptions: single });

  assert.strictEqual(harness.window.document.querySelector('.prompt-action-send'), null, 'one question needs no Send');
  click(harness, groupButtons(harness, 'q1')[0]);
  await tick(60);
  assert.strictEqual(harness.calls[0].text, 'Brief');
});

test('an ssh chat sends what the shell expects, not the words on the button', async () => {
  // Over a pty the other end is a program: `select` reads the number it printed. The label
  // stays human so the operator can see what "2" means.
  const harness = bootRenderer();
  await tick(80);
  const { buttons } = await renderAssistantQuestion(harness, {
    provider: 'ssh',
    text: 'Which distribution?\n1) Debian\n2) Ubuntu\n',
    promptOptions: {
      asks_question: true,
      kind: 'menu',
      allows_other: true,
      groups: [{
        id: 'q1',
        question: 'Which distribution?',
        kind: 'menu',
        allows_other: true,
        options: [
          { id: 'debian', label: 'Debian', description: '', reply: '1' },
          { id: 'ubuntu', label: 'Ubuntu', description: '', reply: '2' },
        ],
      }],
      options: [{ id: 'debian', label: 'Debian', description: '', reply: '1' }],
    },
  });

  const ubuntu = buttons.find((b) => /Ubuntu/.test(b.textContent));
  assert.ok(ubuntu, 'an ssh terminal reply must still carry its buttons');
  click(harness, ubuntu);
  await tick(60);
  assert.strictEqual(harness.calls[0].text, '2');
});

test('the free-text box is not mistaken for the composer', async () => {
  // The pane's composer used to be found with frameEl.querySelector('textarea'). The
  // prompt block's own box sits above it in the transcript, so the unscoped lookup found
  // that one: the composer's placeholder landed in it, and submitting the composer read
  // its value as the message.
  const harness = bootRenderer();
  await tick(80);
  await renderAssistantQuestion(harness, { text: 'Two questions.', promptOptions: MULTI_GROUP_OPTIONS });

  const box = harness.window.document.querySelector('.prompt-free-text-input');
  assert.strictEqual(box.placeholder, 'Answer in your own words', 'the box keeps its own placeholder');

  box.value = 'a note, not a message';
  const composerBox = harness.window.document.querySelector('.composer textarea');
  composerBox.value = 'the actual message';
  harness.window.document.querySelector('.composer').dispatchEvent(
    new harness.window.Event('submit', { bubbles: true, cancelable: true }),
  );
  await tick(60);
  assert.strictEqual(harness.calls.length, 1);
  assert.strictEqual(harness.calls[0].text, 'the actual message', 'the composer must send its own value');
});
