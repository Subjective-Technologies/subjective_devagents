const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInjectExpression, pickWorkbenchTarget } = require('../src/cursorDomInject');

test('buildInjectExpression embeds the prompt and Cursor composer selectors', () => {
  const expression = buildInjectExpression('hello from web');
  assert.match(expression, /hello from web/);
  assert.match(expression, /data-lexical-editor/);
  assert.match(expression, /insertText/);
  assert.match(expression, /keydown/);
});

test('pickWorkbenchTarget prefers a Cursor/workbench page', () => {
  const picked = pickWorkbenchTarget([
    { type: 'iframe', title: 'webview', webSocketDebuggerUrl: 'ws://x/1' },
    { type: 'page', title: 'Welcome', url: 'about:blank', webSocketDebuggerUrl: 'ws://x/2' },
    { type: 'page', title: 'Cursor', url: 'vscode-file://vscode-app/workbench.html', webSocketDebuggerUrl: 'ws://x/3' }
  ]);
  assert.equal(picked.webSocketDebuggerUrl, 'ws://x/3');
});
