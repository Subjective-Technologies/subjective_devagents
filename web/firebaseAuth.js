// Shared by the chat and terminal pages. Firebase owns credential persistence and
// refresh; this module never copies ID/refresh tokens into URLs or localStorage.
(function () {
  'use strict';
  const apiBase = String(document.querySelector('meta[name="devagents-api"]')?.content || '').replace(/\/+$/, '');
  const shell = document.querySelector('.app-shell, .terminal-shell');
  const panel = document.getElementById('ownerAuthPanel');
  const status = document.getElementById('ownerAuthStatus');
  const googleButton = document.getElementById('ownerGoogleSignIn');
  const form = document.getElementById('ownerEmailSignIn');
  const signOutButton = document.getElementById('ownerSignOut');
  const OWNER_EMAIL = 'subjectivetechnologies@gmail.com';
  const OWNER_UID = 'WO55hP1UlbRziVhokDMJyQoqVyl2';
  const DASHBOARD = 'https://dashboard.subjectivetechnologies.com/dashboard/st-backend/my-agents';
  const parentOrigins = new Set(['https://dashboard.subjectivetechnologies.com', 'https://dashboard.worktwins.com']);
  let parentOrigin = '';
  try {
    const origin = new URL(document.referrer).origin;
    if (window.parent !== window && parentOrigins.has(origin)) parentOrigin = origin;
  } catch (_error) { /* Standalone page. */ }
  let parentToken = '';
  let parentExpiry = 0;
  let parentPending = null;
  let sdk;
  let firebaseAuth;
  let mode = 'owner';
  let started = false;
  let allowed = false;
  const connections = new Set();
  let generation = 0;
  let settleReady;
  const ready = new Promise((resolve) => { settleReady = resolve; });
  const tokenListeners = new Set();
  const url = (path) => apiBase ? `${apiBase}${path}` : path;

  function lock(message) {
    allowed = false;
    for (const connection of connections) connection.close();
    if (shell) { shell.hidden = true; shell.inert = true; }
    if (panel) panel.hidden = false;
    if (status) status.textContent = message;
  }

  function unlock() {
    allowed = true;
    if (panel) panel.hidden = true;
    if (shell) { shell.hidden = false; shell.inert = false; }
    if (signOutButton) {
      signOutButton.hidden = mode === 'development';
      const toolbar = document.getElementById('topActions');
      if (toolbar) { toolbar.appendChild(signOutButton); signOutButton.classList.remove('owner-auth-signout'); }
    }
    started = true;
    settleReady();
  }

  function errorText(error) {
    const messages = {
      'auth/unauthorized-domain': 'Google sign-in is not enabled for this hostname. Use the main chat address or contact the operator.',
      'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow popups, then try again.',
      'auth/popup-closed-by-user': 'Sign-in window closed. Try again when ready.',
      'auth/invalid-credential': 'Sign-in failed. Check your email and password.',
      'auth/too-many-requests': 'Too many sign-in attempts. Wait, then try again.',
      'auth/network-request-failed': 'Sign-in could not reach Firebase. Check your connection and retry.',
    };
    return messages[error?.code] || 'Sign-in failed. Please try again.';
  }

  async function signOut() {
    lock('Signed out. Sign in to continue.');
    parentToken = '';
    if (parentOrigin) {
      window.parent.postMessage({ type: 'devagents:sign-out' }, parentOrigin);
    }
    if (firebaseAuth) await sdk.signOut(firebaseAuth);
    // Unload transcripts, terminal output, sockets, and outstanding UI state.
    window.location.reload();
  }

  function requestParentToken(forceRefresh = false) {
    if (!parentPending) {
      parentPending = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { tokenListeners.delete(onToken); parentPending = null; reject(new Error('Dashboard sign-in unavailable.')); }, 15000);
        const onToken = () => { clearTimeout(timer); tokenListeners.delete(onToken); parentPending = null; resolve(parentToken); };
        tokenListeners.add(onToken);
        window.parent.postMessage({ type: 'devagents:request-auth', forceRefresh }, parentOrigin);
      });
    }
    return parentPending;
  }

  window.addEventListener('message', async (event) => {
    if (!parentOrigin || event.origin !== parentOrigin || event.source !== window.parent) return;
    if (event.data?.type !== 'devagents:auth-token') return;
    const current = ++generation;
    const token = event.data.token;
    if (typeof token !== 'string' || !token || token.length > 16384) {
      parentToken = '';
      lock('Sign in to the dashboard with the owner account.');
      if (started) window.location.reload();
      else lock('Sign in to the dashboard with the owner account.');
      return;
    }
    try {
      const response = await fetch(url('/api/auth/session'), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (current !== generation) return;
      if (!response.ok) { lock('The server denied access to this dashboard account.'); return; }
      // Parsing expiry only schedules refresh. The API verifies signature and owner.
      const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const expiry = JSON.parse(atob(encoded)).exp;
      if (typeof expiry !== 'number') throw new Error('Missing expiry');
      parentToken = token;
      parentExpiry = expiry;
      unlock();
      for (const listener of tokenListeners) listener();
    } catch (_error) { lock('Unable to verify dashboard sign-in. Reload to retry.'); }
  });

  // A shared token supplied in the URL, kept for this page only. Deliberately not
  // stored: the block below retires manual-token links precisely so a credential
  // does not linger in a URL or in storage, and nothing here should undo that. A
  // reload without the parameter simply asks for it again.
  let staticToken = '';

  async function tokenWorks(token) {
    try {
      const response = await fetch(url('/api/version'), {
        cache: 'no-store', headers: { 'X-DevAgents-Token': token },
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async function getToken(forceRefresh = false) {
    if (!allowed) throw new Error('Authentication required.');
    if (mode === 'token') return staticToken;
    if (mode === 'development' && !firebaseAuth) return '';
    if (parentOrigin) {
      if (forceRefresh || !parentToken || parentExpiry < Date.now() / 1000 + 60) return requestParentToken(forceRefresh);
      return parentToken;
    }
    const user = firebaseAuth?.currentUser;
    if (!user) { lock('Sign in to continue.'); throw new Error('Authentication required.'); }
    try { return await user.getIdToken(forceRefresh); }
    catch (_error) { lock('Session could not refresh. Sign in again.'); throw new Error('Authentication required.'); }
  }

  async function request(path, options = {}) {
    await ready;
    let token = await getToken();
    const send = () => fetch(url(path), {
      ...options,
      headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    let response = await send();
    if (response.status === 401 && (firebaseAuth?.currentUser || parentOrigin)) {
      token = await getToken(true);
      response = await send();
    }
    if (response.status === 401) lock('Session expired or access denied. Sign in with the owner account.');
    return response;
  }

  async function socket(base) {
    await ready;
    const token = await getToken();
    const connection = new WebSocket(base);
    connections.add(connection);
    connection.addEventListener('close', () => connections.delete(connection));
    if (token) connection.addEventListener('open', () => connection.send(JSON.stringify({ type: 'auth', token })));
    return connection;
  }

  window.devagentsAuth = { ready, apiBase, request, socket, getToken, signOut,
    onTokenChanged(callback) { tokenListeners.add(callback); return () => tokenListeners.delete(callback); },
    get mode() { return mode; },
  };

  lock('Checking sign-in…');
  if (signOutButton) signOutButton.addEventListener('click', () => signOut().catch(() => lock('Sign-out failed. Try again.')));
  // Older manual-token links are retired in this browser flow. Remove only the
  // credential parameter, preserving ordinary navigation/query state.
  try {
    const current = new URL(location.href);
    if (current.searchParams.has('token')) {
      // Captured before it is removed. A shared-token deployment has no identity
      // provider, so this is the only credential such a page can ever be given —
      // but it still leaves the address bar immediately, and is never stored.
      staticToken = String(current.searchParams.get('token') || '').trim();
      current.searchParams.delete('token');
      history.replaceState(null, '', current.pathname + current.search + current.hash);
    }
    localStorage.removeItem('devagents.apiToken');
  } catch (_error) { /* Browser storage can be unavailable in embedded pages. */ }

  async function initialize() {
    const response = await fetch(url('/api/auth/config'), { cache: 'no-store' });
    if (!response.ok) throw new Error('Auth configuration unavailable');
    const config = await response.json();
    mode = config.mode;
    if (mode === 'development' && config.required === false) { unlock(); return; }
    if (mode === 'token') {
      // A shared-token deployment has no identity provider, so there was nothing
      // for this gate to ask and the app stayed locked forever — token mode was
      // supported by the server and unusable in a browser. Holding a token the
      // server accepts is the whole of the credential here, so it is also the
      // whole of the sign-in. Nothing is weakened by showing the UI: every call
      // behind it still carries the token and the server is still the authority.
      if (staticToken && await tokenWorks(staticToken)) { unlock(); return; }
      lock(staticToken
        ? 'That API token was rejected. Open this page once as ?token=YOUR_TOKEN.'
        : 'This backend uses a shared API token. Open this page once as ?token=YOUR_TOKEN.');
      return;
    }
    if (parentOrigin) {
      googleButton.textContent = 'Open dashboard sign-in';
      googleButton.disabled = false;
      googleButton.addEventListener('click', () => window.open(DASHBOARD, '_top'));
      form.closest('details').hidden = true;
      lock('Waiting for dashboard sign-in…');
      requestParentToken().catch(() => lock('Dashboard sign-in unavailable. Open dashboard sign-in, then return to My Agents.'));
      return;
    }
    // Version pinned to the official Firebase CDN; no analytics or other products.
    const [appSdk, authSdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
    ]);
    sdk = authSdk;
    const app = appSdk.initializeApp({
      apiKey: 'AIzaSyCZSmCqimB7GMjjdSukuX3J-IHVnvANrXs',
      authDomain: 'subjectivetechnologies-login.firebaseapp.com',
      projectId: 'subjectivetechnologies-login',
      appId: '1:363070822103:web:74de388dcf6c5819670292',
    });
    firebaseAuth = sdk.getAuth(app);
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account', login_hint: OWNER_EMAIL });
    googleButton.disabled = false;
    for (const field of form.elements) field.disabled = false;
    googleButton.addEventListener('click', async () => {
      googleButton.disabled = true;
      try { await sdk.signInWithPopup(firebaseAuth, provider); }
      catch (error) {
        if (error?.code === 'auth/unauthorized-domain') { window.location.assign(DASHBOARD); return; }
        lock(errorText(error));
      }
      finally { googleButton.disabled = false; }
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = document.getElementById('ownerPassword');
      const email = document.getElementById('ownerEmail');
      const submit = form.querySelector('button');
      submit.disabled = true;
      try { await sdk.signInWithEmailAndPassword(firebaseAuth, email.value.trim(), password.value); }
      catch (error) { lock(errorText(error)); }
      finally { password.value = ''; submit.disabled = false; }
    });
    sdk.onIdTokenChanged(firebaseAuth, async (user) => {
      const current = ++generation;
      if (!user) {
        if (started) { window.location.reload(); return; }
        lock('Sign in with the owner account to open your chats.');
        return;
      }
      if (!(user.uid === OWNER_UID || (user.email?.toLowerCase() === OWNER_EMAIL && user.emailVerified))) {
        lock('Access is restricted to the verified owner account. Choose a different account.');
        if (signOutButton) signOutButton.hidden = false;
        return;
      }
      try {
        const token = await user.getIdToken();
        const result = await fetch(url('/api/auth/session'), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (current !== generation) return;
        if (!result.ok) { lock('The server denied access. Sign in with the owner account.'); return; }
        unlock();
        for (const listener of tokenListeners) listener();
      } catch (_error) { lock('Unable to verify your session. Check your connection and reload.'); }
    });
  }
  initialize().catch(() => lock('Sign-in could not start. Check your connection and reload.'));
}());
