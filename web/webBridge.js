// Browser implementation of window.subjectiveChat - the same interface preload.js exposes
// to renderer.js under Electron, so renderer.js/messageRenderer.js/index.html/styles.css
// run completely unmodified here. Electron's ipcRenderer.invoke(channel, payload) becomes
// a POST to /api/<channel-ish-path>; Electron's ipcRenderer.on('app:event', ...) becomes
// one shared WebSocket that ChatCore's whole event stream is broadcast over (see
// webServer.js) - config/status/message/llm-*/switchuser-*/dcc-* all arrive on it, exactly
// as onEvent() below hands them to every listener renderer.js registered.
(function () {
  if (window.subjectiveChat) return;

  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!response.ok && response.status >= 500) return { ok: false, error: `Server error (${response.status})` };
    try {
      return await response.json();
    } catch (_error) {
      return { ok: false, error: 'Malformed server response.' };
    }
  }

  const get = (path) => api('GET', path);
  const post = (path, body = {}) => api('POST', path, body);

  // --- live event stream --------------------------------------------------------------

  const listeners = new Set();
  let socket = null;
  let reconnectTimer = null;

  function connectSocket() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    socket = new WebSocket(url);
    socket.addEventListener('message', (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch (_error) {
        return;
      }
      for (const listener of listeners) listener(event);
    });
    socket.addEventListener('close', () => {
      socket = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectSocket, 2000);
    });
    socket.addEventListener('error', () => socket && socket.close());
  }
  connectSocket();

  function emitLocal(event) {
    for (const listener of listeners) listener(event);
  }

  // --- "Continue as..." terminal popup -------------------------------------------------
  // The desktop app opens a native window for this (terminalWindow.js); a browser tab pops
  // a same-origin window instead. window.open() with a stable name reuses/focuses an
  // already-open popup for that username instead of stacking duplicates.
  listeners.add((event) => {
    if (event.type === 'switchuser-terminal-needed' && event.username) {
      window.open(`/terminal.html?username=${encodeURIComponent(event.username)}`, `terminal-${event.username}`, 'width=760,height=500');
    }
  });

  // --- DOM context menu -----------------------------------------------------------------
  // Electron's native Menu.buildFromTemplate()/.popup() has no browser equivalent - this
  // renders the same items (see chatCore.js buildContextMenuModel) as a small absolutely
  // positioned dropdown instead. renderer.js only ever calls
  // showConversationContextMenu(target, x, y) and doesn't know or care how it's shown.
  let openMenu = null;

  function closeContextMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
      document.removeEventListener('click', closeContextMenu, true);
      document.removeEventListener('keydown', onMenuKeydown, true);
    }
  }

  function onMenuKeydown(event) {
    if (event.key === 'Escape') closeContextMenu();
  }

  function statusDot(status) {
    if (status === 'ready') return '●';
    if (status && status !== 'idle' && status !== 'disconnected') return '◐';
    return '○';
  }

  function menuRow({ label, disabled, onClick }) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'web-context-menu-item';
    row.textContent = label;
    row.disabled = Boolean(disabled);
    if (onClick && !disabled) row.addEventListener('click', (event) => { event.stopPropagation(); closeContextMenu(); onClick(); });
    return row;
  }

  function separator() {
    const hr = document.createElement('div');
    hr.className = 'web-context-menu-separator';
    return hr;
  }

  async function showConversationContextMenu(target, x, y) {
    closeContextMenu();
    const model = await get(`/api/context-menu?target=${encodeURIComponent(target)}`);

    const menu = document.createElement('div');
    menu.className = 'web-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    menu.appendChild(menuRow({ label: 'Rename…', onClick: () => emitLocal({ type: 'conversation-rename-request', target }) }));
    menu.appendChild(separator());

    if (!model.continueAs) {
      menu.appendChild(menuRow({ label: 'Continue as…', disabled: true }));
    } else {
      const { candidates, activeSessions } = model.continueAs;
      const submenuLabel = document.createElement('div');
      submenuLabel.className = 'web-context-menu-label';
      submenuLabel.textContent = 'Continue as…';
      menu.appendChild(submenuLabel);

      if (!candidates.length) {
        menu.appendChild(menuRow({ label: 'No other Linux users found on this computer', disabled: true }));
      } else {
        for (const candidate of candidates) {
          menu.appendChild(menuRow({
            label: `${statusDot(candidate.status)} ${candidate.username}`,
            onClick: () => post('/api/switchuser/continue-as', { target, username: candidate.username })
          }));
        }
      }

      if (activeSessions.length) {
        menu.appendChild(separator());
        for (const entry of activeSessions) {
          menu.appendChild(menuRow({
            label: `Disconnect ${entry.username}`,
            onClick: () => post('/api/switchuser/disconnect', { username: entry.username })
          }));
        }
      }
    }

    document.body.appendChild(menu);
    openMenu = menu;
    // Keep the menu on-screen if it was opened near the right/bottom edge.
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${Math.max(0, window.innerWidth - rect.width - 8)}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(0, window.innerHeight - rect.height - 8)}px`;
    setTimeout(() => {
      document.addEventListener('click', closeContextMenu, true);
      document.addEventListener('keydown', onMenuKeydown, true);
    }, 0);
    return { ok: true };
  }

  // --- image send via <input type=file> instead of a native file dialog -----------------

  function fileToBytes(file) {
    return file.arrayBuffer().then((buffer) => Array.from(new Uint8Array(buffer)));
  }

  function pickAndSendImage(target) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) return resolve({ ok: false, canceled: true });
        const bytes = await fileToBytes(file);
        resolve(await post('/api/dcc/send-image-data', { target, fileName: file.name, mimeType: file.type, bytes }));
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  window.subjectiveChat = {
    connect: () => post('/api/connect'),
    disconnect: () => post('/api/disconnect'),
    sendMessage: (target, text) => post('/api/send-message', { target, text }),
    executeCommand: (command, target) => post('/api/execute-command', { command, target }),
    listLlmConversations: () => get('/api/llm/conversations'),
    getLlmConversation: (target) => get(`/api/llm/conversation?target=${encodeURIComponent(target)}`),
    activateLlmConversation: (target) => post('/api/llm/activate-conversation', { target }),
    createLlmConversation: (payload) => post('/api/llm/create-conversation', payload),
    renameLlmConversation: (target, name) => post('/api/llm/rename-conversation', { target, name }),
    getLlmStatus: (provider) => get(`/api/llm/status?provider=${encodeURIComponent(provider || '')}`),
    sendLlmMessage: (target, text, files = []) => post('/api/llm/send-message', { target, text, files }),
    listSystemUsers: () => get('/api/system/users'),
    getSwitchUserStatus: (username) => get(`/api/switchuser/status?username=${encodeURIComponent(username || '')}`),
    showConversationContextMenu,
    continueAsUser: (target, username) => post('/api/switchuser/continue-as', { target, username }),
    disconnectSwitchUser: (username) => post('/api/switchuser/disconnect', { username }),
    onSwitchUserEvent: (callback) => {
      const wrapped = (event) => { if (event.type && event.type.startsWith('switchuser-')) callback({ type: event.type.replace(/^switchuser-/, ''), ...event }); };
      listeners.add(wrapped);
      return () => listeners.delete(wrapped);
    },
    sendImage: (target) => pickAndSendImage(target),
    sendImageData: (payload) => post('/api/dcc/send-image-data', payload),
    openFile: () => post('/api/file/open'),
    revealPath: () => post('/api/file/reveal'),
    openExternal: (url) => {
      const target = String(url || '');
      if (!/^https?:\/\//i.test(target) && !/^mailto:/i.test(target)) return Promise.resolve({ ok: false });
      window.open(target, '_blank', 'noopener,noreferrer');
      return Promise.resolve({ ok: true });
    },
    log: (level, message, details) => post('/api/log', { level, message, details }),
    getConfig: () => get('/api/config'),
    saveConfig: (payload) => post('/api/save-config', payload),
    onEvent: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
}());
