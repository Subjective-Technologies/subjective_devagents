// Shared by the chat and terminal pages. Sign-in is the same three values CLIProxy
// takes: user id, Firebase token, and company name. This module keeps them in
// memory for the page lifetime. It never copies them into URLs or localStorage.
(function () {
  'use strict';
  const apiBase = String(document.querySelector('meta[name="devagents-api"]')?.content || '').replace(/\/+$/, '');
  const shell = document.querySelector('.app-shell, .terminal-shell');
  const panel = document.getElementById('ownerAuthPanel');
  const status = document.getElementById('ownerAuthStatus');
  const form = document.getElementById('ownerIdentitySignIn');
  const userField = document.getElementById('ownerUserId');
  const tokenField = document.getElementById('ownerFirebaseToken');
  const companyField = document.getElementById('ownerCompanyName');
  const signOutButton = document.getElementById('ownerSignOut');
  let parentOrigin = '';
  let parentOrigins = new Set();
  let configuredCompany = '';
  let userId = '';
  let firebaseToken = '';
  let companyName = '';
  let parentPending = null;
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

  function identityHeaders(token) {
    if (!token) return {};
    return {
      Authorization: `Bearer ${token}`,
      'X-User-Id': userId,
      'X-Company-Name': companyName,
    };
  }

  async function signOut() {
    lock('Signed out. Sign in to continue.');
    userId = '';
    firebaseToken = '';
    companyName = '';
    if (parentOrigin) window.parent.postMessage({ type: 'devagents:sign-out' }, parentOrigin);
    window.location.reload();
  }

  function requestParentAuth(forceRefresh = false) {
    if (!parentPending) {
      parentPending = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          tokenListeners.delete(onToken);
          parentPending = null;
          reject(new Error('Dashboard sign-in unavailable.'));
        }, 15000);
        const onToken = () => {
          clearTimeout(timer);
          tokenListeners.delete(onToken);
          parentPending = null;
          resolve(firebaseToken);
        };
        tokenListeners.add(onToken);
        window.parent.postMessage({ type: 'devagents:request-auth', forceRefresh }, parentOrigin);
      });
    }
    return parentPending;
  }

  async function signIn(nextUserId, nextToken, nextCompany) {
    const current = ++generation;
    nextUserId = String(nextUserId || '').trim();
    nextToken = String(nextToken || '').trim();
    nextCompany = String(nextCompany || '').trim() || configuredCompany;
    if (!nextUserId || !nextToken || !nextCompany || nextToken.length > 16384) {
      lock('User id, Firebase token, and company name are required.');
      return false;
    }
    try {
      const response = await fetch(url('/api/auth/session'), {
        headers: {
          Authorization: `Bearer ${nextToken}`,
          'X-User-Id': nextUserId,
          'X-Company-Name': nextCompany,
        },
        cache: 'no-store',
      });
      if (current !== generation) return false;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        lock(body.error || 'The server denied this sign-in.');
        return false;
      }
      userId = nextUserId;
      firebaseToken = nextToken;
      companyName = nextCompany;
      if (tokenField) tokenField.value = '';
      unlock();
      for (const listener of tokenListeners) listener();
      return true;
    } catch (_error) {
      if (current === generation) lock('Unable to verify your session. Check your connection and reload.');
      return false;
    }
  }

  window.addEventListener('message', (event) => {
    if (!parentOrigin || event.origin !== parentOrigin || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'devagents:auth') return;
    const token = data.firebaseToken;
    if (typeof token !== 'string' || !token) {
      userId = '';
      firebaseToken = '';
      companyName = '';
      lock('Sign in to the dashboard to continue.');
      if (started) window.location.reload();
      return;
    }
    return signIn(data.userId, token, data.companyName);
  });

  async function getToken(forceRefresh = false) {
    if (!allowed) throw new Error('Authentication required.');
    if (mode === 'development' && !firebaseToken) return '';
    if (parentOrigin && (forceRefresh || !firebaseToken)) await requestParentAuth(forceRefresh);
    if (!firebaseToken) {
      lock('Sign in to continue.');
      throw new Error('Authentication required.');
    }
    return firebaseToken;
  }

  async function request(path, options = {}) {
    await ready;
    let token = await getToken();
    const send = () => fetch(url(path), {
      ...options,
      headers: { ...(options.headers || {}), ...identityHeaders(token) },
    });
    let response = await send();
    if (response.status === 401 && parentOrigin) {
      token = await getToken(true);
      response = await send();
    }
    if (response.status === 401) lock('Session expired or access denied. Sign in again.');
    return response;
  }

  async function socket(base) {
    await ready;
    const token = await getToken();
    const connection = new WebSocket(base);
    connections.add(connection);
    connection.addEventListener('close', () => connections.delete(connection));
    if (token) {
      connection.addEventListener('open', () => connection.send(JSON.stringify({
        type: 'auth', token, user_id: userId, company_name: companyName,
      })));
    }
    return connection;
  }

  window.devagentsAuth = {
    ready, apiBase, request, socket, getToken, signOut,
    onTokenChanged(callback) { tokenListeners.add(callback); return () => tokenListeners.delete(callback); },
    get mode() { return mode; },
  };

  lock('Checking sign-in…');
  if (signOutButton) signOutButton.addEventListener('click', () => signOut().catch(() => lock('Sign-out failed. Try again.')));
  // Credential query parameters are retired as soon as the page reads them.
  // The API never sees them; the values move into the sign-in request headers.
  let pendingSignIn = null;
  try {
    const current = new URL(location.href);
    const queryUser = current.searchParams.get('user_id') || '';
    const queryToken = current.searchParams.get('firebase_token') || '';
    const queryCompany = current.searchParams.get('company_name') || '';
    let stripped = false;
    for (const name of ['token', 'user_id', 'firebase_token', 'company_name']) {
      if (current.searchParams.has(name)) { current.searchParams.delete(name); stripped = true; }
    }
    if (stripped) history.replaceState(null, '', current.pathname + current.search + current.hash);
    localStorage.removeItem('devagents.apiToken');
    if (queryUser && queryToken && queryCompany) pendingSignIn = [queryUser, queryToken, queryCompany];
  } catch (_error) { /* Browser storage can be unavailable in embedded pages. */ }

  function enableForm() {
    if (!form) return;
    for (const field of [userField, tokenField, companyField]) if (field) field.disabled = false;
    const submit = form.querySelector ? form.querySelector('button') : null;
    if (submit) submit.disabled = false;
    if (companyField && !companyField.value && configuredCompany) companyField.value = configuredCompany;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const submitButton = form.querySelector ? form.querySelector('button') : null;
      if (submitButton) submitButton.disabled = true;
      return signIn(userField && userField.value, tokenField && tokenField.value, companyField && companyField.value)
        .finally(() => { if (submitButton) submitButton.disabled = false; });
    });
  }

  async function initialize() {
    const response = await fetch(url('/api/auth/config'), { cache: 'no-store' });
    if (!response.ok) throw new Error('Auth configuration unavailable');
    const config = await response.json();
    mode = config.mode;
    configuredCompany = String(config.companyName || '').trim();
    parentOrigins = new Set(Array.isArray(config.parentOrigins) ? config.parentOrigins : []);
    try {
      const origin = new URL(document.referrer).origin;
      if (window.parent !== window && parentOrigins.has(origin)) parentOrigin = origin;
    } catch (_error) { /* Standalone page. */ }
    if (mode === 'development' && config.required === false) { unlock(); return; }
    enableForm();
    if (pendingSignIn) {
      await signIn(...pendingSignIn);
      if (allowed) return;
    }
    if (parentOrigin) {
      lock('Waiting for dashboard sign-in…');
      requestParentAuth().catch(() => lock('Dashboard sign-in unavailable. Enter the user id, Firebase token, and company name.'));
      return;
    }
    if (!allowed) lock('Enter the user id, Firebase token, and company name.');
  }
  initialize().catch(() => lock('Sign-in could not start. Check your connection and reload.'));
}());
