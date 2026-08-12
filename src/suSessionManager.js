// Manages one persistent, `su`'d-into pty per "switched-to" OS user, so a Codex/Claude
// conversation can be continued as that user's own identity. Nothing here ever collects
// or types an OS password - the pty is only ever driven interactively, by whoever is
// physically at the machine, through the visible terminal window (see terminalWindow.js).
//
// State machine per username:
//   idle -> connecting -> awaiting-password -> ready
//                                            -> auth-failed (retry by calling ensureSession again)
//   ready -> disconnected (explicit disconnect, or the shell died) / error
//
// "ready" means the su'd shell itself is authenticated - it does NOT mean codex/claude is
// signed in for that user. That is checked separately and lazily via ensureProviderLogin(),
// which reuses the same visible pty for `codex login`'s OAuth device flow only if needed.
//
// Once ready, one-shot pipeline calls for that user are routed through a small local Unix
// socket bridge (see pipeline_bridge_server.py) started as a background child of the
// authenticated shell, rather than typed through the pty as text - see runInSession().
const crypto = require('crypto');
const net = require('net');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { isValidUsername } = require('./systemUsers');

const STATUS = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  AWAITING_PASSWORD: 'awaiting-password',
  AUTH_FAILED: 'auth-failed',
  READY: 'ready',
  ERROR: 'error',
  DISCONNECTED: 'disconnected'
});

const PROVIDER_STATUS = Object.freeze({
  CHECKING: 'checking-login',
  AWAITING_OAUTH: 'awaiting-oauth',
  READY: 'ready',
  ERROR: 'error'
});

const BUFFER_TAIL_KEEP = 16384;
const BUFFER_TRIM_THRESHOLD = 262144;
const PASSWORD_PROMPT_RE = /[Pp]assword:\s*$/;
const AUTH_FAILURE_RE = /su:\s*Authentication failure|incorrect password/i;

const LOGIN_COMMANDS = Object.freeze({
  codex: { status: 'codex login status', login: 'codex login', which: 'codex' },
  claude: { status: 'claude auth status', login: 'claude auth login', which: 'claude' }
});

function loadPty() {
  try {
    // eslint-disable-next-line global-require
    return require('node-pty');
  } catch (error) {
    return null;
  }
}

class SuSessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sessions = new Map(); // username -> session
    // A terminal window can call attachViewer() for a username before ensureSession()
    // has created that session's object (e.g. main.js opens the window and calls
    // ensureSession in the same tick, but the window's own "ready" callback can race
    // ahead of it too) - stash the callback here and apply it in _createSession so pty
    // output (including the password prompt) is never silently dropped on the floor.
    this.pendingViewers = new Map(); // username -> onData callback
    this.ptyFactory = options.ptyFactory || null;
    this.bridgeServerPath = options.bridgeServerPath || path.join(__dirname, 'pipeline_bridge_server.py');
    this.pythonPath = options.pythonPath || 'python3';
    // Deliberately NOT os.tmpdir(): that resolves relative to *this* (the invoking)
    // process's environment, which on a modern desktop is usually a private per-user
    // XDG_RUNTIME_DIR (e.g. /run/user/1000, mode 0700) - the su'd-into user could not
    // create a socket there. /tmp is the one location every local user can reliably
    // write into (mode 1777, sticky bit); the bridge socket's own random suffix plus the
    // shared-secret handshake are what actually gate access, not the directory.
    this.tmpDir = options.tmpDir || '/tmp';
  }

  _pty() {
    if (this.ptyFactory) return this.ptyFactory;
    const pty = loadPty();
    if (!pty) throw new Error('node-pty is not available. Reinstall dependencies and rebuild native modules for Electron.');
    this.ptyFactory = (...args) => pty.spawn(...args);
    return this.ptyFactory;
  }

  getStatus(username) {
    const session = this.sessions.get(username);
    if (!session) return { username, status: STATUS.IDLE };
    return { username, status: session.status, error: session.lastError };
  }

  listStatuses() {
    return [...this.sessions.values()].map((session) => ({
      username: session.username,
      status: session.status,
      error: session.lastError
    }));
  }

  // Spawns `su - username` and drives it to an authenticated, ready shell. Safe to call
  // repeatedly: a session that's already connecting/ready is reused rather than re-spawned.
  async ensureSession(username) {
    if (!isValidUsername(username)) throw new Error(`Invalid username: ${username}`);
    const existing = this.sessions.get(username);
    if (existing) {
      if (existing.status === STATUS.READY) return { status: STATUS.READY };
      if (existing.connectPromise && ![STATUS.AUTH_FAILED, STATUS.ERROR, STATUS.DISCONNECTED].includes(existing.status)) {
        return existing.connectPromise;
      }
      this.disconnect(username);
    }
    const session = this._createSession(username);
    this.sessions.set(username, session);
    session.connectPromise = this._runConnectFlow(session).catch((error) => {
      // _runConnectFlow already sets a more specific status (e.g. AUTH_FAILED) before
      // throwing in the cases it recognizes - only fall back to the generic ERROR status
      // here for failures it didn't already classify.
      if (session.status !== STATUS.AUTH_FAILED) this._setStatus(session, STATUS.ERROR, error.message);
      throw error;
    });
    return session.connectPromise;
  }

  // Ensures `codex`/`claude` is logged in for this user, running the interactive OAuth
  // flow in the same visible pty if needed. Requires ensureSession(username) to already
  // be READY. Cached per (username, provider) for the life of the session.
  async ensureProviderLogin(username, provider) {
    const session = this.sessions.get(username);
    if (!session || session.status !== STATUS.READY) {
      throw new Error(`No ready shell session for ${username}. Call ensureSession first.`);
    }
    if (session.providerReady[provider] === true) return { status: PROVIDER_STATUS.READY };
    const commands = LOGIN_COMMANDS[provider];
    if (!commands) throw new Error(`Unknown provider: ${provider}`);
    if (session.providerLoginPromises[provider]) return session.providerLoginPromises[provider];
    const promise = this._runProviderLogin(session, provider, commands).catch((error) => {
      session.providerReady[provider] = false;
      delete session.providerLoginPromises[provider];
      this._emitProvider(session, provider, PROVIDER_STATUS.ERROR, error.message);
      throw error;
    });
    session.providerLoginPromises[provider] = promise;
    return promise;
  }

  // Routes a one-shot pipeline invocation (the same argv/stdin `LlmService._runPipeline`
  // would otherwise spawn directly) through this user's authenticated background bridge.
  // Calls for the same username are serialized so concurrent messages never interleave.
  runInSession(username, argv, stdinPayload, options = {}) {
    const session = this.sessions.get(username);
    if (!session || session.status !== STATUS.READY) {
      return Promise.reject(new Error(`No ready session for ${username}. Reconnect as ${username} first.`));
    }
    const run = () => this._runInSessionOnce(session, argv, stdinPayload, options.timeoutMs || 660000);
    const result = session.queue.then(run, run);
    session.queue = result.catch(() => {});
    return result;
  }

  // Marks a session as visible (a terminal window is showing its pty) or not. The pty
  // itself is never affected by this - only whether pty output is currently being
  // forwarded anywhere for a human to see.
  attachViewer(username, onData) {
    const session = this.sessions.get(username);
    if (session) {
      session.viewer = onData;
    } else {
      // No session yet - remember this for whenever _createSession runs.
      this.pendingViewers.set(username, onData);
    }
  }

  detachViewer(username) {
    this.pendingViewers.delete(username);
    const session = this.sessions.get(username);
    if (session) session.viewer = null;
  }

  writeInput(username, data) {
    const session = this.sessions.get(username);
    if (!session?.ptyProcess) return;
    session.ptyProcess.write(data);
    // Track whether the human has actually submitted a line while a password prompt is
    // showing, so the auth-confirmation probe (see _pollAuthResult) never races ahead of
    // them - writing our own commands into the pty before su has consumed the typed
    // password would corrupt the very password it's waiting to read.
    if (session.status === STATUS.AWAITING_PASSWORD && /[\r\n]/.test(data)) {
      session.passwordLineSubmitted = true;
      for (const waiter of [...session.flagWaiters]) waiter();
    }
  }

  resize(username, cols, rows) {
    const session = this.sessions.get(username);
    if (session?.ptyProcess && cols > 0 && rows > 0) {
      try { session.ptyProcess.resize(cols, rows); } catch (_error) { /* pty may have just exited */ }
    }
  }

  // Synchronous from the caller's point of view (never needs to be awaited to be
  // effective - the session is gone from `sessions` and reported DISCONNECTED
  // immediately), but internally sequences bridge cleanup *before* killing the pty
  // rather than racing them: /tmp's sticky bit means only the target user (i.e. a
  // command run through their own shell) can ever remove their own socket file, so
  // cleanup has to happen before that shell dies, not concurrently with it.
  disconnect(username) {
    const session = this.sessions.get(username);
    if (!session) return;
    this.sessions.delete(username);
    this._rejectAllWaiters(session, new Error('Session was disconnected.'));
    const cleanup = session.bridge ? this._shutdownBridge(session).catch(() => {}) : Promise.resolve();
    cleanup.finally(() => {
      if (session.ptyProcess) {
        try { session.ptyProcess.kill(); } catch (_error) { /* already dead */ }
      }
    });
    this._setStatus(session, STATUS.DISCONNECTED);
  }

  disconnectAll() {
    for (const username of [...this.sessions.keys()]) this.disconnect(username);
  }

  _createSession(username) {
    const pendingViewer = this.pendingViewers.get(username) || null;
    this.pendingViewers.delete(username);
    return {
      username,
      ptyProcess: null,
      status: STATUS.IDLE,
      lastError: '',
      buffer: '',
      bufferStart: 0,
      totalWritten: 0,
      waiters: new Set(),
      flagWaiters: new Set(),
      passwordLineSubmitted: false,
      viewer: pendingViewer,
      exited: false,
      exitError: '',
      queue: Promise.resolve(),
      connectPromise: null,
      providerReady: {},
      providerLoginPromises: {},
      bridge: null,
      bridgeConnectPromise: null
    };
  }

  _waitForFlag(session, flagName, { timeoutMs = 120000 } = {}) {
    if (session[flagName]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = () => {
        if (!session[flagName]) return;
        session.flagWaiters.delete(waiter);
        if (timer) clearTimeout(timer);
        resolve();
      };
      const timer = timeoutMs > 0 ? setTimeout(() => {
        session.flagWaiters.delete(waiter);
        reject(new Error('Timed out waiting for password submission.'));
      }, timeoutMs) : null;
      session.flagWaiters.add(waiter);
    });
  }

  _setStatus(session, status, error = '') {
    session.status = status;
    session.lastError = error;
    this.emit('status', { username: session.username, status, error });
  }

  _emitProvider(session, provider, status, error = '') {
    this.emit('provider-status', { username: session.username, provider, status, error });
  }

  async _runConnectFlow(session) {
    this._setStatus(session, STATUS.CONNECTING);
    const spawnPty = this._pty();
    const ptyProcess = spawnPty('su', ['-', session.username], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: os.homedir(),
      env: process.env
    });
    session.ptyProcess = ptyProcess;
    ptyProcess.onData((chunk) => this._handleData(session, chunk));
    ptyProcess.onExit(({ exitCode }) => this._handleExit(session, exitCode));

    let promptSeen = false;
    try {
      await this._waitForPattern(session, PASSWORD_PROMPT_RE, { timeoutMs: 15000 });
      promptSeen = true;
      this._setStatus(session, STATUS.AWAITING_PASSWORD);
    } catch (_timeout) {
      // No password prompt seen within 15s - unusual (e.g. passwordless trust), fall
      // through to the auth-result poll below, which will resolve either way.
    }

    if (promptSeen) {
      // Wait for the human to actually submit a line in response to the prompt before
      // probing anything ourselves - writing into the pty ahead of that would land in
      // the middle of whatever password su is still reading and corrupt it.
      try {
        await this._waitForFlag(session, 'passwordLineSubmitted', { timeoutMs: 120000 });
      } catch (timeoutError) {
        this._setStatus(session, STATUS.AUTH_FAILED, timeoutError.message);
        throw timeoutError;
      }
    }

    const result = await this._pollAuthResult(session);
    if (!result.success) {
      const message = result.error || 'su did not authenticate.';
      this._setStatus(session, STATUS.AUTH_FAILED, message);
      throw new Error(message);
    }
    this._setStatus(session, STATUS.READY);
    return { status: STATUS.READY };
  }

  async _pollAuthResult(session, { timeoutMs = 120000, pollIntervalMs = 700 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (session.exited) return { success: false, error: session.exitError || 'su exited before authenticating.' };
      const token = crypto.randomBytes(6).toString('hex');
      const marker = `SUBJ_WHOAMI_${token}`;
      const since = session.totalWritten;
      session.ptyProcess.write(`echo "${marker}:$(whoami):$?"\n`);
      try {
        const { match } = await this._waitForPattern(session, new RegExp(`${marker}:([^:\\r\\n]*):(-?\\d+)`), { timeoutMs: 3000, since });
        if (match[1] === session.username) return { success: true };
      } catch (_timeout) {
        // whoami never echoed back in time - probably still sitting at the password
        // prompt. Check for an explicit failure message before looping again.
      }
      const recentTail = session.buffer.slice(-4000);
      if (AUTH_FAILURE_RE.test(recentTail)) return { success: false, error: 'su: Authentication failure' };
      if (session.exited) return { success: false, error: session.exitError || 'su exited before authenticating.' };
      await this._delay(pollIntervalMs);
    }
    return { success: false, error: 'Timed out waiting for su to authenticate.' };
  }

  async _runProviderLogin(session, provider, commands) {
    this._emitProvider(session, provider, PROVIDER_STATUS.CHECKING);
    const which = await this._runFramed(session, `command -v ${commands.which}`, { timeoutMs: 10000 });
    if (which.exitCode !== 0) {
      throw new Error(`${commands.which} was not found on ${session.username}'s PATH.`);
    }
    const status = await this._runFramed(session, commands.status, { timeoutMs: 30000 });
    if (status.exitCode === 0) {
      session.providerReady[provider] = true;
      this._emitProvider(session, provider, PROVIDER_STATUS.READY);
      return { status: PROVIDER_STATUS.READY };
    }

    this._emitProvider(session, provider, PROVIDER_STATUS.AWAITING_OAUTH);
    const since = session.totalWritten;
    session.ptyProcess.write(`${commands.login}\n`);
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await this._delay(3000);
      if (session.exited) throw new Error(session.exitError || 'Shell exited during login.');
      const recheck = await this._runFramed(session, commands.status, { timeoutMs: 15000 });
      if (recheck.exitCode === 0) {
        session.providerReady[provider] = true;
        this._emitProvider(session, provider, PROVIDER_STATUS.READY);
        return { status: PROVIDER_STATUS.READY };
      }
    }
    void since;
    throw new Error(`${provider} login did not complete before timing out.`);
  }

  async _ensureBridge(session) {
    if (session.bridge) return session.bridge;
    if (session.bridgeConnectPromise) return session.bridgeConnectPromise;
    session.bridgeConnectPromise = this._startBridge(session)
      .then((bridge) => {
        session.bridge = bridge;
        session.bridgeConnectPromise = null;
        return bridge;
      })
      .catch((error) => {
        session.bridgeConnectPromise = null;
        throw error;
      });
    return session.bridgeConnectPromise;
  }

  async _startBridge(session) {
    const secret = crypto.randomBytes(16).toString('hex');
    const socketPath = path.join(this.tmpDir, `.subjective_chat_bridge_${session.username}_${crypto.randomBytes(4).toString('hex')}.sock`);
    const logPath = `${socketPath}.log`;
    // SUBJECTIVE_CHAT_PIPELINE_PARENT_HOME steers Subjective Chat's own pipeline
    // bookkeeping (context exports/logs), matching how LlmService._runPipeline sets it
    // for the current user - here it must resolve against the TARGET user's own $HOME
    // (expanded by their shell, since `su -` gives them a proper login environment),
    // never the invoking user's app home, which this user typically cannot even read.
    const startCommand = `SUBJECTIVE_CHAT_PIPELINE_PARENT_HOME="$HOME/.subjective_chat" ${this.pythonPath} ${JSON.stringify(this.bridgeServerPath)} --socket ${JSON.stringify(socketPath)} --secret ${secret} >${JSON.stringify(logPath)} 2>&1 &`;
    await this._runFramed(session, startCommand, { timeoutMs: 10000 });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const probe = await this._runFramed(session, `test -S ${JSON.stringify(socketPath)}`, { timeoutMs: 5000 });
      if (probe.exitCode === 0) break;
      await this._delay(250);
    }

    // Verify the socket actually accepts a connection before handing it back - `test -S`
    // only confirms the special file exists, not that the server has called listen() yet.
    await this._connectSocket(socketPath).then((socket) => socket.destroy());
    return { secret, socketPath };
  }

  _connectSocket(socketPath) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      const onError = (error) => { socket.removeAllListeners(); reject(error); };
      socket.once('error', onError);
      socket.once('connect', () => { socket.removeListener('error', onError); resolve(socket); });
    });
  }

  async _shutdownBridge(session) {
    if (!session.bridge) return;
    try {
      await this._callBridge(session.bridge, { action: 'shutdown' }, 3000);
    } finally {
      session.bridge = null;
    }
  }

  async _runInSessionOnce(session, argv, stdinPayload, timeoutMs) {
    if (session.status !== STATUS.READY) throw new Error(`No ready session for ${session.username}.`);
    const bridge = await this._ensureBridge(session);
    const response = await this._callBridge(bridge, {
      secret: bridge.secret,
      argv,
      stdin: typeof stdinPayload === 'string' ? stdinPayload : JSON.stringify(stdinPayload),
      timeout_seconds: Math.ceil(timeoutMs / 1000)
    }, timeoutMs + 5000);
    if (!response.ok) throw new Error(response.error || 'Bridge command failed.');
    return { stdout: response.stdout || '', stderr: response.stderr || '', exitCode: response.returncode };
  }

  // Opens a fresh connection for every call rather than reusing one: the server
  // (Python's socketserver.BaseRequestHandler) handles exactly one request per accepted
  // connection and closes it afterwards, so a "persistent" client socket would only ever
  // survive its first call. A Unix domain socket connect is cheap enough that this costs
  // nothing meaningful per message.
  _callBridge(bridge, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const { secret, socketPath } = bridge;
      const body = Buffer.from(JSON.stringify({ secret, ...payload }), 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length, 0);

      const socket = net.createConnection(socketPath);
      let expectedLength = null;
      let received = Buffer.alloc(0);
      let settled = false;

      const timer = setTimeout(() => {
        finish(new Error('Timed out waiting for bridge response.'));
      }, timeoutMs);

      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
        socket.removeListener('connect', onConnect);
        socket.destroy();
        if (error) reject(error); else resolve(value);
      }
      function onConnect() { socket.write(Buffer.concat([header, body])); }
      function onData(chunk) {
        received = Buffer.concat([received, chunk]);
        if (expectedLength === null && received.length >= 4) {
          expectedLength = received.readUInt32BE(0);
          received = received.slice(4);
        }
        if (expectedLength !== null && received.length >= expectedLength) {
          try {
            finish(null, JSON.parse(received.slice(0, expectedLength).toString('utf8')));
          } catch (error) {
            finish(error);
          }
        }
      }
      function onError(error) { finish(error); }
      function onClose() { finish(new Error('Bridge connection closed before responding.')); }

      socket.on('connect', onConnect);
      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('close', onClose);
    });
  }

  // Runs a single-line command through the pty and waits for a unique sentinel marker to
  // know when it finished, capturing stdout+stderr and the exit code in between. The
  // command is always wrapped in a subshell so `cd`/env changes never leak into the
  // persistent login shell, and the whole thing (command + marker echo) is written as
  // ONE line - splitting it across two writes/lines would make the assumption "the first
  // echoed line is just our own input" ambiguous to parse back out.
  async _runFramed(session, shellCommand, { timeoutMs = 660000 } = {}) {
    if (!session.ptyProcess) throw new Error(`No active shell for ${session.username}.`);
    const token = crypto.randomBytes(8).toString('hex');
    const endRe = new RegExp(`SUBJ_END_${token}:(-?\\d+)===`);
    const since = session.totalWritten;
    const waitPromise = this._waitForPattern(session, endRe, { timeoutMs, since });
    session.ptyProcess.write(`(${shellCommand}); echo "SUBJ_END_${token}:$?==="\n`);
    const { match, haystack } = await waitPromise;
    const exitCode = Number(match[1]);
    let body = haystack.slice(0, match.index);
    const firstNewline = body.indexOf('\n');
    body = firstNewline === -1 ? '' : body.slice(firstNewline + 1);
    return { stdout: body.replace(/\r\n/g, '\n'), exitCode };
  }

  _handleData(session, chunk) {
    const text = chunk.toString();
    session.buffer += text;
    session.totalWritten += text.length;
    if (session.waiters.size === 0 && session.buffer.length > BUFFER_TRIM_THRESHOLD) {
      const drop = session.buffer.length - BUFFER_TAIL_KEEP;
      session.buffer = session.buffer.slice(drop);
      session.bufferStart += drop;
    }
    if (session.viewer) {
      try { session.viewer(text); } catch (_error) { /* viewer window may be closing */ }
    }
    for (const waiter of [...session.waiters]) waiter.check();
  }

  _handleExit(session, exitCode) {
    session.exited = true;
    const tail = session.buffer.slice(-4000);
    session.exitError = AUTH_FAILURE_RE.test(tail)
      ? 'su: Authentication failure'
      : `su exited (code ${exitCode}) before completing authentication.`;
    session.ptyProcess = null;
    this._rejectAllWaiters(session, new Error(session.exitError));
    if (session.status === STATUS.READY) {
      this.sessions.delete(session.username);
      this._setStatus(session, STATUS.DISCONNECTED, 'Shell process exited unexpectedly.');
    }
  }

  _rejectAllWaiters(session, error) {
    for (const waiter of [...session.waiters]) waiter.fail(error);
  }

  _waitForPattern(session, regex, { timeoutMs = 15000, since = session.totalWritten } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const waiter = {
        check: () => {
          if (settled) return true;
          const offset = Math.max(0, since - session.bufferStart);
          const haystack = session.buffer.slice(offset);
          const match = regex.exec(haystack);
          if (!match) return false;
          settle();
          resolve({ match, haystack });
          return true;
        },
        fail: (error) => {
          if (settled) return;
          settle();
          reject(error);
        }
      };
      function settle() {
        settled = true;
        session.waiters.delete(waiter);
        if (timer) clearTimeout(timer);
      }
      session.waiters.add(waiter);
      if (timeoutMs > 0) {
        timer = setTimeout(() => waiter.fail(Object.assign(new Error('Timed out waiting for pattern.'), { code: 'TIMEOUT' })), timeoutMs);
      }
      waiter.check();
    });
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { SuSessionManager, STATUS, PROVIDER_STATUS };
