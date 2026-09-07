// Browser implementation of window.terminalBridge - matches terminalPreload.js's shape
// exactly so terminal-renderer.js and terminal.html run completely unmodified here too.
(function () {
  if (window.terminalBridge) return;

  const username = new URL(window.location.href).searchParams.get('username') || '';
  const dataListeners = new Set();
  const statusListeners = new Set();

  // Same backend the main page uses - resolved the same way as webBridge.js (see the note
  // there), because this terminal drives a pty that only exists on that machine. Reading
  // the same ?api=/localStorage/meta chain means opening the raw terminal from a session
  // pointed at a non-default backend keeps talking to that backend.
  const API_BASE = (function resolveApiBase() {
    const clean = (value) => String(value || '').trim().replace(/\/+$/, '');
    let base = '';
    try {
      base = clean(new URLSearchParams(location.search).get('api'))
        || clean(localStorage.getItem('devagents.apiBase'));
    } catch (_error) {
      // Sandboxed iframe: fall through to the meta tag.
    }
    if (!base) base = clean(document.querySelector('meta[name="devagents-api"]')?.content);
    return base || '';
  }());

  const apiUrl = (path) => (API_BASE ? `${API_BASE}${path}` : path);

  const url = API_BASE
    ? `${API_BASE.replace(/^http/, 'ws')}/ws`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    fetch(apiUrl(`/api/switchuser/status?username=${encodeURIComponent(username)}`))
      .then((response) => response.json())
      .then((result) => {
        if (result?.status) for (const listener of statusListeners) listener(result.status);
      })
      .catch(() => {});
  });
  socket.addEventListener('message', (message) => {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch (_error) {
      return;
    }
    if (event.username !== username) return;
    if (event.type === 'switchuser-pty-data') for (const listener of dataListeners) listener(event.chunk);
    if (event.type === 'switchuser-status' || event.type === 'switchuser-provider-status') {
      for (const listener of statusListeners) listener(event);
    }
  });

  function post(path, body) {
    return fetch(apiUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((response) => response.json())
      .catch(() => ({ ok: false }));
  }

  window.terminalBridge = {
    username,
    sendInput: (data) => post('/api/switchuser/pty-input', { username, data }),
    resize: (cols, rows) => post('/api/switchuser/pty-resize', { username, cols, rows }),
    onData: (callback) => {
      dataListeners.add(callback);
      return () => dataListeners.delete(callback);
    },
    onStatus: (callback) => {
      statusListeners.add(callback);
      return () => statusListeners.delete(callback);
    }
  };
}());
