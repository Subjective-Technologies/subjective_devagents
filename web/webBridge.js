// Browser implementation of window.subjectiveChat - the same interface preload.js exposes
// to renderer.js under Electron, so renderer.js/messageRenderer.js/index.html/styles.css
// run completely unmodified here. Electron's ipcRenderer.invoke(channel, payload) becomes
// a POST to /api/<channel-ish-path>; Electron's ipcRenderer.on('app:event', ...) becomes
// one shared WebSocket that ChatCore's whole event stream is broadcast over (see
// webServer.js) - config/status/message/llm-*/switchuser-*/dcc-* all arrive on it, exactly
// as onEvent() below hands them to every listener renderer.js registered.
(function () {
  if (window.subjectiveChat) return;

  // A proxy that gave up waiting. Only meaningful for calls that can legitimately outlive
  // its patience - see the longRunning option below.
  const PROXY_TIMEOUT_STATUSES = new Set([502, 504, 524]);

  // --- where the backend lives ------------------------------------------------------------
  // Every request and the event socket resolve against this one value, so the UI never
  // talks to whichever origin happened to serve the page. Order:
  //   1. ?api=  — an explicit override for probing a different backend; persisted so a
  //      reload keeps it, and cleared with ?api= (empty) to drop back to the default.
  //   2. the <meta> tag index.html ships — the deployment's authoritative backend.
  //   3. a persisted ?api= override, only when no meta tag is present (a local checkout).
  //   4. same-origin.
  //
  // The meta tag deliberately beats the persisted value: an old localStorage pin left over
  // from earlier testing must not silently shadow the deployment's real API origin, which
  // sent every call to the wrong host and looked like "clicking does nothing".
  //
  // Whatever origin this resolves to must also appear in index.html's CSP connect-src, or
  // the browser blocks the call before it is sent.
  const API_BASE = (function resolveApiBase() {
    const clean = (value) => String(value || '').trim().replace(/\/+$/, '');
    let override = '';
    let stored = '';
    try {
      const param = new URLSearchParams(location.search).get('api');
      if (param !== null) {
        // ?api= present (even empty) is an explicit instruction: set or clear the pin.
        override = clean(param);
        if (override) localStorage.setItem('devagents.apiBase', override);
        else localStorage.removeItem('devagents.apiBase');
      }
      stored = clean(localStorage.getItem('devagents.apiBase'));
    } catch (_error) {
      // A sandboxed iframe throws on storage/search; fall through to the meta tag.
    }
    const meta = clean(document.querySelector('meta[name="devagents-api"]')?.content);
    return override || meta || stored || '';
  }());

  // Absolute when an API base is configured, relative when it is not - so the same bundle
  // serves a local same-origin checkout and the hosted split-origin deployment.
  function apiUrl(path) {
    return API_BASE ? `${API_BASE}${path}` : path;
  }

  // --- API token -------------------------------------------------------------------------
  // The backend can read every conversation on that machine and start an agent turn, so it
  // requires a shared secret. Deliberately NOT baked into this page: the page is public, so
  // anything stamped into it is public too. Seed it once per browser with ?token=... and it
  // is remembered; thereafter it rides as a header, which is why the API can keep a wildcard
  // CORS origin - a header carries no ambient authority the way a cookie would.
  const API_TOKEN = (function resolveApiToken() {
    let token = '';
    try {
      token = String(new URLSearchParams(location.search).get('token') || '').trim();
      if (token) {
        localStorage.setItem('devagents.apiToken', token);
        // Keep the secret out of the address bar, history and any Referer header.
        history.replaceState(null, '', location.pathname + location.hash);
      }
      if (!token) token = String(localStorage.getItem('devagents.apiToken') || '').trim();
    } catch (_error) {
      // Sandboxed iframe with storage blocked - fall through to an unauthenticated attempt,
      // which surfaces as a clear 401 rather than a silent failure.
    }
    return token;
  }());

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (API_TOKEN) headers['X-DevAgents-Token'] = API_TOKEN;
    return Object.keys(headers).length ? headers : undefined;
  }

  window.subjectiveChatApiBase = API_BASE;

  async function handleApiResponse(response, options = {}) {
    // The backend rejected the shared secret. Say so plainly: without this the UI just
    // renders an empty chat list and looks broken rather than locked.
    if (response.status === 401) {
      return { ok: false, unauthorized: true, error: API_TOKEN
        ? 'The API rejected this token. Re-open with ?token=... to set a new one.'
        : 'This backend needs an API token. Open the page once with ?token=...' };
    }
    // 524/504/502: Cloudflare (or another proxy) gave up waiting. An agent turn can
    // still be running; llm-message arrives on the WebSocket. Do not treat as a failed
    // send. Scoped to longRunning calls on purpose: a read like /api/llm/conversations
    // answers in milliseconds, so a 5xx there is a real error - reporting it as a
    // successful empty result would blank the chat list.
    if (!response.ok && PROXY_TIMEOUT_STATUSES.has(response.status) && options.longRunning) {
      return { ok: true, pending: true, proxyTimeout: response.status };
    }
    if (!response.ok && response.status >= 500) return { ok: false, error: `Server error (${response.status})` };
    try {
      return await response.json();
    } catch (_error) {
      return { ok: false, error: 'Malformed server response.' };
    }
  }

  async function api(method, path, body, options = {}) {
    const response = await fetch(apiUrl(path), {
      method,
      headers: authHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    return handleApiResponse(response, options);
  }

  // Multipart upload — no Content-Type header, so the browser sets it (with the
  // boundary) itself. Kept separate from api() because that one always JSON-encodes.
  async function postFile(path, file, options = {}) {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const response = await fetch(apiUrl(path), { method: 'POST', headers: authHeaders(), body: formData });
    return handleApiResponse(response, options);
  }

  const get = (path) => api('GET', path);
  const post = (path, body = {}, options) => api('POST', path, body, options);

  // --- live event stream --------------------------------------------------------------

  const listeners = new Set();
  let socket = null;
  let reconnectTimer = null;

  // Derived from API_BASE, not from location: the event stream has to come from the same
  // backend serving the REST calls, or the UI shows a chat list from one server and live
  // messages from another.
  function socketUrl() {
    if (!API_BASE) {
      const sameOrigin = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      return API_TOKEN ? `${sameOrigin}?token=${encodeURIComponent(API_TOKEN)}` : sameOrigin;
    }
    const base = `${API_BASE.replace(/^http/, 'ws')}/ws`;
    return API_TOKEN ? `${base}?token=${encodeURIComponent(API_TOKEN)}` : base;
  }

  let reconnectDelay = 1000;
  function connectSocket() {
    socket = new WebSocket(socketUrl());
    socket.addEventListener('open', () => {
      reconnectDelay = 1000;  // reset backoff once a connection succeeds
      // A dropped socket may have swallowed an llm-busy:false, leaving the UI wedged
      // (disabled buttons/composer). Tell the renderer a fresh connection is up so it can
      // resync; the server re-asserts real busy state on the next event.
      for (const listener of listeners) listener({ type: 'socket-reconnected' });
    });
    socket.addEventListener('message', (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch (_error) {
        return;
      }
      // Heartbeat frames only keep the proxy from closing an idle socket; nothing renders.
      if (event && event.type === 'ping') return;
      for (const listener of listeners) listener(event);
    });
    socket.addEventListener('close', () => {
      socket = null;
      clearTimeout(reconnectTimer);
      // Exponential backoff (capped) instead of hammering every 2s when the socket cannot
      // establish — the old fixed retry produced dozens of failures a minute.
      reconnectTimer = setTimeout(connectSocket, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    });
    socket.addEventListener('error', () => socket && socket.close());
  }
  connectSocket();

  function emitLocal(event) {
    for (const listener of listeners) listener(event);
  }

  // --- "Continue as..." sign-in -----------------------------------------------------------
  // switchuser-terminal-needed used to pop a same-origin terminal.html window (xterm.js) for
  // this. renderer.js now handles it with an in-page password modal (suLoginDialog) styled
  // like the rest of the app instead - see its onSwitchUserEvent('terminal-needed') handler.
  // The raw terminal is still reachable from that modal's "Open full terminal instead" link
  // for logins that need more than a password (an OAuth device code, say).

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
      const { providers, activeSessions } = model.continueAs;
      const submenuLabel = document.createElement('div');
      submenuLabel.className = 'web-context-menu-label';
      submenuLabel.textContent = 'Continue as…';
      menu.appendChild(submenuLabel);

      const nonEmptyProviders = providers.filter((provider) => provider.users.length);
      if (!nonEmptyProviders.length) {
        menu.appendChild(menuRow({ label: 'No other Linux users found on this computer', disabled: true }));
      } else {
        nonEmptyProviders.forEach((provider, index) => {
          if (index) menu.appendChild(separator());
          const providerLabelRow = document.createElement('div');
          providerLabelRow.className = 'web-context-menu-label';
          providerLabelRow.textContent = provider.label;
          menu.appendChild(providerLabelRow);
          for (const candidate of provider.users) {
            const suffix = candidate.current
              ? ' · current'
              : candidate.ready ? ' · login found' : candidate.unknown ? ' · login hidden' : '';
            menu.appendChild(menuRow({
              label: `${statusDot(candidate.status)} ${candidate.username}${suffix}`,
              disabled: candidate.current,
              onClick: () => post('/api/switchuser/continue-as', { target, provider: provider.key, username: candidate.username })
            }));
          }
        });
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

    menu.appendChild(separator());
    menu.appendChild(menuRow({ label: 'Delete chat…', onClick: () => emitLocal({ type: 'conversation-delete-request', target }) }));

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
    listLlmConversations: (opts = {}) => {
      const params = new URLSearchParams();
      params.set('limit', String(opts.limit || 200));
      if (opts.q) params.set('q', String(opts.q));
      return get(`/api/llm/conversations?${params}`);
    },
    getLlmConversation: (target) => get(`/api/llm/conversation?target=${encodeURIComponent(target)}`),
    reloadLlmConversation: (target) => post('/api/llm/reload-conversation', { target }, { longRunning: true }),
    activateLlmConversation: (target) => post('/api/llm/activate-conversation', { target }),
    createLlmConversation: (payload) => post('/api/llm/create-conversation', payload),
    renameLlmConversation: (target, name) => post('/api/llm/rename-conversation', { target, name }),
    deleteLlmConversation: (target) => post('/api/llm/delete-conversation', { target }),
    // LocalChats scan can take minutes on a cold archive; treat like an agent turn.
    refreshLlmHistory: () => post('/api/llm/refresh-history', {}, { longRunning: true }),
    // A zip of another workstation's exported chat JSON files — no agent or sync setup
    // needed on that machine, just its export folder zipped up.
    importLlmChats: (file) => postFile('/api/llm/import-chats', file, { longRunning: true }),
    getLlmStatus: (provider) => get(`/api/llm/status?provider=${encodeURIComponent(provider || '')}`),
    listProviderSessions: (provider) => get(`/api/llm/sessions?provider=${encodeURIComponent(provider || '')}`),
    // The only request that routinely runs for minutes: one agent turn.
    sendLlmMessage: (target, text, files = []) => post('/api/llm/send-message', { target, text, files }, { longRunning: true }),
    listSystemUsers: () => get('/api/system/users'),
    getSwitchUserStatus: (username) => get(`/api/switchuser/status?username=${encodeURIComponent(username || '')}`),
    showConversationContextMenu,
    continueAsUser: (target, username) => post('/api/switchuser/continue-as', { target, username }),
    disconnectSwitchUser: (username) => post('/api/switchuser/disconnect', { username }),
    sendSwitchUserPtyInput: (username, data) => post('/api/switchuser/pty-input', { username, data }),
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

    // Run a shell command on the machine hosting the API — the small things that do not
    // deserve a whole agent turn, from a phone. Off unless the backend enables it (and it
    // refuses to enable on an unauthenticated service), so check execStatus() before
    // offering the input. longRunning: a build can outlast the proxy's patience.
    execStatus: () => get('/api/exec/status'),
    exec: (command, options = {}) => post('/api/exec', {
      command,
      cwd: options.cwd || '',
      timeout: options.timeout,
    }, { longRunning: true }),

    // Backend-side facts. These matter more now that the API is its own origin: the
    // version stamped into this page describes whoever served the HTML, which is no
    // longer necessarily the machine answering the calls, so asking the API is the only
    // way to report the build that actually ran a turn.
    apiBase: API_BASE,
    getVersion: () => get('/api/version'),
    getDatasources: () => get('/api/datasources'),
    getD1SyncStatus: () => get('/api/d1/sync'),
    syncD1Now: () => post('/api/d1/sync', {}, { longRunning: true }),

    onEvent: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
}());
