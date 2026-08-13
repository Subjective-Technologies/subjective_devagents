// Browser implementation of window.terminalBridge - matches terminalPreload.js's shape
// exactly so terminal-renderer.js and terminal.html run completely unmodified here too.
(function () {
  if (window.terminalBridge) return;

  const username = new URL(window.location.href).searchParams.get('username') || '';
  const dataListeners = new Set();
  const statusListeners = new Set();

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const socket = new WebSocket(url);
  socket.addEventListener('message', (message) => {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch (_error) {
      return;
    }
    if (event.username !== username) return;
    if (event.type === 'switchuser-pty-data') for (const listener of dataListeners) listener(event.chunk);
    if (event.type === 'switchuser-status') for (const listener of statusListeners) listener(event);
  });

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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
