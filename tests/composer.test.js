const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the actual browser handlers with only DOM/transport boundaries mocked.
const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');

function composerHarness({ kind = 'llm', text = '', images = [], result = { ok: true, pending: true } } = {}) {
  const calls = [];
  const echoes = [];
  const input = { value: text };
  const target = kind === 'llm' ? 'llm:codex:test' : '#subjective';
  const context = vm.createContext({
    input,
    activeTarget: target,
    conversations: new Map([[target, { target, kind, provider: 'codex' }]]),
    pendingImages: images.map((file) => ({ file })),
    frameBroadcast: null,
    window: { subjectiveChat: {
      sendLlmMessage: async (...args) => { calls.push(['llm', ...args]); return result; },
      sendMessage: async (...args) => { calls.push(['irc', ...args]); return { ok: true }; },
      executeCommand: async (...args) => { calls.push(['command', ...args]); return { ok: true }; }
    } },
    addOptimisticLlmEcho: (_conversation, message) => echoes.push(message),
    dropOptimisticLlmEcho: (_conversation, message) => { input.value = message; },
    rendererLog() {},
    addEvent() {},
    hideCommandPalette() {},
    clearPendingImages() {},
    llmAttachment: async (file) => file,
    providerName: (provider) => provider,
    commandPalette: { hidden: true },
    framesEnabled: () => false
  });
  for (const name of ['isSlashCommand', 'normalizeLiteralSlash', 'sendTextMessages', 'onComposerSubmit', 'onComposerKeydown', 'onComposerPaste', 'uniqueImageFiles', 'imageFileSignature']) {
    const source = renderer.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'));
    assert.ok(source, `Missing renderer handler: ${name}`);
    vm.runInContext(source[0], context);
  }
  return {
    context, calls, echoes, input, target,
    submit: () => context.onComposerSubmit({ preventDefault() {}, currentTarget: { closest: () => null } })
  };
}

test('multiline paste sends one complete LLM prompt even when API returns pending', async () => {
  const prompt = 'Terminal output:\n\n    first indented line\n    second line\nlast line\n';
  const ctx = composerHarness({ text: prompt });
  let prevented = false;
  await ctx.context.onComposerPaste({
    clipboardData: { files: [], items: [], getData: () => prompt },
    preventDefault: () => { prevented = true; }
  });
  assert.equal(prevented, false, 'Let the textarea insert clipboard text normally');
  await ctx.submit();
  assert.deepEqual(ctx.calls, [['llm', ctx.target, prompt]]);
  assert.deepEqual(ctx.echoes, [prompt]);
  assert.equal(ctx.input.value, '');
});

test('CRLF and CR paste normalize newlines without removing indentation or blank lines', async () => {
  const ctx = composerHarness({ text: 'first\r\n\r\n  second\rthird' });
  await ctx.submit();
  assert.deepEqual(ctx.calls, [['llm', ctx.target, 'first\n\n  second\nthird']]);
});

test('multiline prompt beginning with a slash is sent as prompt text', async () => {
  const ctx = composerHarness({ text: '/tmp/output.log\n  error details' });
  await ctx.submit();
  assert.deepEqual(ctx.calls, [['llm', ctx.target, '/tmp/output.log\n  error details']]);
});

test('single-line slash commands still execute and escaped slash stays literal', async () => {
  const command = composerHarness({ text: '/whois user' });
  await command.submit();
  assert.deepEqual(command.calls, [['command', '/whois user', command.target]]);
  const literal = composerHarness({ text: '//whois user' });
  await literal.submit();
  assert.deepEqual(literal.calls, [['llm', literal.target, '/whois user']]);
});

test('IRC keeps sending separate nonempty lines', async () => {
  const ctx = composerHarness({ kind: 'irc', text: 'first\n\n  second\nthird' });
  await ctx.submit();
  assert.deepEqual(ctx.calls, [
    ['irc', ctx.target, 'first'], ['irc', ctx.target, 'second'], ['irc', ctx.target, 'third']
  ]);
});

test('image attachment preserves the complete multiline prompt', async () => {
  const file = { filename: 'test.png' };
  const prompt = 'Review:\n\n  details\n';
  const ctx = composerHarness({ text: prompt, images: [file] });
  await ctx.submit();
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0][2], prompt);
  assert.equal(ctx.calls[0][3][0], file);
});

test('failed LLM send restores the entire draft', async () => {
  const prompt = 'first\n\n  second\nlast';
  const ctx = composerHarness({ text: prompt, result: { ok: false, error: 'offline' } });
  await ctx.submit();
  assert.equal(ctx.input.value, prompt);
});

test('Enter allows newlines; Ctrl/Cmd+Enter submits', async () => {
  const ctx = composerHarness();
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }]) {
    let prevented = false;
    let submitted = false;
    await ctx.context.onComposerKeydown({
      key: 'Enter', ...modifiers,
      preventDefault: () => { prevented = true; },
      currentTarget: { closest: () => ({ requestSubmit: () => { submitted = true; } }) }
    });
    assert.equal(submitted, Boolean(modifiers.ctrlKey || modifiers.metaKey));
    assert.equal(prevented, submitted);
  }
});
