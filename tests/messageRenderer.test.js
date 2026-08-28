const assert = require('node:assert/strict');
const test = require('node:test');

const {
  detectPromptActions,
  isCommandBlock,
  isLocalPath,
  normalizeToolMessages,
  renderCode,
  renderCommand,
  renderMessage
} = require('../src/messageRenderer');

test('renders safe markdown with highlighted fenced code and command controls', () => {
  const markup = renderMessage([
    'Use **this command**:',
    '',
    '```bash',
    'npm test',
    '```'
  ].join('\n'));

  assert.match(markup, /<strong>this command<\/strong>/);
  assert.match(markup, /class="code-card command-card"/);
  assert.match(markup, /data-code-action="copy"/);
  assert.match(markup, /data-code-action="run"/);
  assert.match(markup, /class="hljs-built_in">test<\/span>/);
});

test('escapes raw HTML and rejects executable link protocols', () => {
  const markup = renderMessage('<img src=x onerror=alert(1)> [bad](javascript:alert(1))');
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /href="javascript:/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('renders regular code without Run and recognizes unlabeled commands', () => {
  const javascript = renderMessage('```javascript\nconst answer = 42;\n```');
  assert.match(javascript, /data-code-action="copy"/);
  assert.doesNotMatch(javascript, /data-code-action="run"/);
  assert.equal(isCommandBlock('', 'git status'), true);
  assert.equal(isCommandBlock('', 'const answer = 42;'), false);
});

test('maps latest agent questions to suitable response buttons, always with a way to type something else', () => {
  assert.deepEqual(detectPromptActions('Would you like me to continue?').map((item) => item.label), ['Yes', 'No', 'Something else…']);
  assert.deepEqual(detectPromptActions('Permission required. Allow this operation?').map((item) => item.label), ['Allow', 'Deny', 'Something else…']);
  assert.deepEqual(detectPromptActions('Should I run the test command?').map((item) => item.label), ['Run', "Don't run", 'Something else…']);
  assert.deepEqual(detectPromptActions('Do you want to keep these code changes?').map((item) => item.label), ['Keep code', 'Revert', 'Something else…']);
  assert.deepEqual(detectPromptActions('Work completed.'), []);
  const other = detectPromptActions('Would you like me to continue?').find((item) => item.id === 'other');
  assert.equal(other.custom, true);
  assert.equal(other.reply, undefined);
});

test('a closing question that names lettered/numbered options gets one button per option', () => {
  const lettered = detectPromptActions([
    'A. You run 3 commands, paste output (fastest, zero friction):',
    'B. Let me probe directly - add an allow-rule so curl stop prompting. Want that?',
    '',
    'Which - A or B?'
  ].join('\n'));
  assert.deepEqual(lettered.map((item) => item.id), ['choice-a', 'choice-b', 'other']);
  assert.match(lettered[0].label, /^A — You run 3 commands/);
  assert.match(lettered[1].label, /^B — Let me probe directly/);
  assert.equal(lettered[0].reply, 'A');
  assert.equal(lettered[1].reply, 'B');
  assert.equal(lettered[0].primary, true);
  assert.equal(Boolean(lettered[1].primary), false);

  const numbered = detectPromptActions([
    '1. Roll back the migration',
    '2. Patch forward instead',
    '3. Pause and wait for you',
    '4. Something else entirely',
    '',
    'Which fix should I apply - 1, 2, 3, or 4?'
  ].join('\n')).map((item) => item.id);
  assert.deepEqual(numbered, ['choice-1', 'choice-2', 'choice-3', 'choice-4', 'other']);

  const five = detectPromptActions([
    'A. Check logs',
    'B. Fix frozen chats',
    'C. Show hidden LLM questions',
    'D. Stop IRC reconnect spam',
    'E. All of the above',
    '',
    'Which — A, B, C, D, or E?'
  ].join('\n'));
  assert.deepEqual(five.map((item) => item.id), ['choice-a', 'choice-b', 'choice-c', 'choice-d', 'choice-e', 'other']);
  assert.equal(five[4].reply, 'E');
  assert.match(five[4].label, /^E — All of the above/);
});

test('an unrelated numbered list followed by a plain yes/no question does not become a choice menu', () => {
  // Ranked findings (1-5) that are NOT the actual options being offered - the real
  // question at the end is a separate approve/deny ask, so this must fall through to the
  // Allow/Deny bucket instead of misreading "5" as a selectable choice.
  const labels = detectPromptActions([
    '1. Firebase authorized domains missing dashboard subdomains.',
    '2. Instrument the SPA.',
    '3. The sync endpoint should be 401.',
    '4. Point the CTA at /sign-up.',
    '5. Bot traffic may skew the count.',
    '',
    'I can run the live probes but permission was denied this session.',
    'Approve it and I will confirm in one pass. Want me to?'
  ].join('\n')).map((item) => item.label);
  assert.deepEqual(labels, ['Allow', 'Deny', 'Something else…']);
});

test('turns Markdown and plain absolute paths into show-in-folder controls', () => {
  const markdownLink = renderMessage('[proposal](/subjective/APPLICATION_SHIPPING_PROPOSAL.md)');
  const plainPath = renderMessage('Created /subjective/docs/report.md.');

  assert.match(markdownLink, /class="local-path-link"/);
  assert.match(markdownLink, /data-local-path="\/subjective\/APPLICATION_SHIPPING_PROPOSAL\.md"/);
  assert.match(plainPath, /<button[^>]+data-local-path="\/subjective\/docs\/report\.md"/);
  assert.equal(isLocalPath('/subjective/docs/report.md'), true);
  assert.equal(isLocalPath('C:\\work\\report.md'), true);
  assert.equal(isLocalPath('https://example.com/report.md'), false);
});

test('collapses flattened shell tool calls into structured command cards', () => {
  const commandOne = 'GH_TOKEN="$(token-command)"; gh run list --limit 3';
  const commandTwo = 'npm test';
  const normalized = normalizeToolMessages([
    { role: 'system', text: commandOne, time: 1 },
    { role: 'system', text: 'bash', time: 1 },
    { role: 'system', text: '-lc', time: 1 },
    { role: 'system', text: 'bash', time: 2 },
    { role: 'system', text: '-lc', time: 2 },
    { role: 'system', text: commandTwo, time: 2 },
    { role: 'assistant', text: 'Make sure tests remain readable.', time: 3 }
  ]);

  assert.equal(normalized.length, 3);
  assert.deepEqual(normalized.slice(0, 2).map(({ type, command, shell }) => ({ type, command, shell })), [
    { type: 'command', command: commandOne, shell: 'bash -lc' },
    { type: 'command', command: commandTwo, shell: 'bash -lc' }
  ]);
  assert.equal(normalized[2].type, 'message');
  assert.equal(normalized[2].message.text, 'Make sure tests remain readable.');
  assert.match(renderCommand(commandTwo, 'bash -lc'), /class="code-card command-card"/);
  assert.match(renderCommand(commandTwo, 'bash -lc'), /data-code-action="run"/);
});

test('preserves complete structured commands without splitting argv fragments', () => {
  const command = [
    'git -C /brainboost/subjective_v2 add',
    'subjective_user_service/src/subjective_user_service/routers/domain/billing.py',
    'subjective_user_service/tests/test_billing_domain.py'
  ].join(' ');
  const normalized = normalizeToolMessages([{
    role: 'tool',
    kind: 'command',
    command,
    text: command,
    shell: 'bash',
    workdir: '/subjective'
  }]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].type, 'command');
  assert.equal(normalized[0].command, command);
  assert.equal(normalized[0].shell, 'bash');
});

test('renders tool output as copyable non-executable code card', () => {
  const normalized = normalizeToolMessages([{
    role: 'tool_output',
    kind: 'output',
    text: 'line one\nline two'
  }]);
  const markup = renderCode(normalized[0].code, normalized[0].language);

  assert.equal(normalized[0].type, 'code');
  assert.match(markup, /class="code-card"/);
  assert.match(markup, /data-code-action="copy"/);
  assert.doesNotMatch(markup, /data-code-action="run"/);
});
