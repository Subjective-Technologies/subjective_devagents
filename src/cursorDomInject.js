const http = require('http');
const net = require('net');
const { WebSocket } = require('ws');

const DEFAULT_CDP = Number(process.env.CURSOR_CDP_PORT || 9222);

function cdpPortOpen(port = DEFAULT_CDP, timeoutMs = 200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(port) }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

function buildInjectExpression(text) {
  const payload = JSON.stringify(String(text || ''));
  return `(() => {
    const text = ${payload};
    const selectors = [
      '[data-lexical-editor="true"]',
      '.aislash-editor-input [contenteditable="true"]',
      '.composer-bar [contenteditable="true"]',
      '[class*="composer"] [contenteditable="true"]',
      '.ProseMirror',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Plan"]',
      'textarea'
    ];
    const nodes = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        if (!nodes.includes(node)) nodes.push(node);
      });
    }
    const visible = nodes.filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 40 && box.height > 16;
    });
    const el = visible.at(-1);
    if (!el) return { ok: false, error: 'no composer input in DOM' };
    el.focus();
    if (el.isContentEditable) {
      document.execCommand('selectAll', false, null);
      const inserted = document.execCommand('insertText', false, text);
      if (!inserted) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      }
    } else {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const enter = (type) => el.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));
    enter('keydown');
    enter('keyup');
    return { ok: true, tag: el.tagName, editable: el.isContentEditable };
  })()`;
}

function getJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('cdp timeout'));
    });
    req.on('error', reject);
  });
}

async function listCdpTargets(port = DEFAULT_CDP) {
  const targets = await getJson(`http://127.0.0.1:${port}/json`);
  return Array.isArray(targets) ? targets : [];
}

function pickWorkbenchTarget(targets) {
  const pages = targets.filter((item) => item && item.type === 'page' && item.webSocketDebuggerUrl);
  return pages.find((item) => /workbench|cursor|vscode/i.test(`${item.title} ${item.url}`)) || pages[0] || null;
}

function evaluateOnTarget(wsUrl, expression, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch (_error) { /* ignore */ }
      reject(new Error('cdp evaluate timeout'));
    }, timeoutMs);
    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    socket.on('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      }));
    });
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch (_error) { return; }
      if (message.id !== 1) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch (_error) { /* ignore */ }
      if (message.error) {
        reject(new Error(message.error.message || 'cdp error'));
        return;
      }
      resolve(message.result && message.result.result ? message.result.result.value : null);
    });
  });
}

async function injectIntoCursorDom(text, options = {}) {
  const port = Number(options.port || DEFAULT_CDP);
  if (!await cdpPortOpen(port)) {
    return { ok: false, error: `Cursor CDP :${port} is off. Start Cursor with --remote-debugging-port=${port}` };
  }
  try {
    const targets = await listCdpTargets(port);
    const target = pickWorkbenchTarget(targets);
    if (!target) return { ok: false, error: `Cursor CDP :${port} has no workbench page` };
    const result = await evaluateOnTarget(target.webSocketDebuggerUrl, buildInjectExpression(text));
    if (!result || result.ok !== true) {
      return { ok: false, error: (result && result.error) || 'DOM inject failed', target: target.title };
    }
    return { ok: true, via: 'cdp-dom', target: target.title, detail: result };
  } catch (error) {
    const message = String(error.message || error);
    if (/ECONNREFUSED|cdp timeout|connect/i.test(message)) {
      return { ok: false, error: `Cursor CDP :${port} is off. Start Cursor with --remote-debugging-port=${port}` };
    }
    return { ok: false, error: message };
  }
}

module.exports = {
  DEFAULT_CDP,
  buildInjectExpression,
  cdpPortOpen,
  pickWorkbenchTarget,
  injectIntoCursorDom
};
