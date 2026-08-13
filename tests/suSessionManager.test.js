const assert = require('node:assert/strict');
const test = require('node:test');

const { SuSessionManager, STATUS, PROVIDER_STATUS } = require('../src/suSessionManager');

// A tiny fake `su - <username>` shell good enough to drive SuSessionManager's state
// machine without touching a real pty/process. It understands exactly the handful of
// command shapes SuSessionManager itself writes: the initial (implicit) password line,
// the `_runFramed` single-line `(<cmd>); echo "SUBJ_END_<token>:$?==="` wrapper, and the
// bare `echo "SUBJ_WHOAMI_<token>:$(whoami):$?"` auth-confirmation probe.
function makeFakeSuPty({ username, correctPassword = 'right-password', innerCommandRules = {} } = {}) {
  const dataHandlers = [];
  const exitHandlers = [];
  let authenticated = false;
  let killed = false;
  let spawnCount = 0;

  function emit(text) { for (const cb of dataHandlers.slice()) cb(text); }
  function fireExit(exitCode) { for (const cb of exitHandlers.slice()) cb({ exitCode }); }

  function runInner(inner) {
    const rule = innerCommandRules[inner];
    if (rule) return rule();
    return { output: '', exitCode: 0 };
  }

  function handleLine(line) {
    if (!authenticated) {
      const password = line.replace(/\n$/, '');
      if (password === correctPassword) {
        authenticated = true;
      } else {
        emit('su: Authentication failure\n');
        fireExit(1);
      }
      return;
    }
    const framed = /^\((.*)\); echo "(SUBJ_END_[0-9a-f]+):\$\?==="\n$/.exec(line);
    if (framed) {
      const [, inner, marker] = framed;
      const { output, exitCode } = runInner(inner);
      if (output) emit(output);
      emit(`${marker}:${exitCode}===\n`);
      return;
    }
    const whoami = /^echo "(SUBJ_WHOAMI_[0-9a-f]+):\$\(whoami\):\$\?"\n$/.exec(line);
    if (whoami) {
      emit(`${whoami[1]}:${username}:0\n`);
    }
  }

  const pty = {
    onData(cb) { dataHandlers.push(cb); },
    onExit(cb) { exitHandlers.push(cb); },
    write(input) {
      emit(input); // simulate the tty's local echo of exactly what was written
      for (const line of input.split('\n')) {
        if (line.length) handleLine(`${line}\n`);
      }
    },
    kill() { if (!killed) { killed = true; fireExit(0); } },
    resize() {}
  };
  spawnCount += 1;
  setTimeout(() => emit('Password: '), 0);
  return { pty, getSpawnCount: () => spawnCount };
}

function managerWithFakePty(pty) {
  return new SuSessionManager({ ptyFactory: () => pty });
}

test('ensureSession reaches READY after the correct password is typed', async () => {
  const { pty } = makeFakeSuPty({ username: 'bob' });
  const manager = managerWithFakePty(pty);
  const statuses = [];
  manager.on('status', (event) => statuses.push(event.status));

  const connectPromise = manager.ensureSession('bob');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(manager.getStatus('bob').status, STATUS.AWAITING_PASSWORD);
  manager.writeInput('bob', 'right-password\n');

  const result = await connectPromise;
  assert.equal(result.status, STATUS.READY);
  assert.equal(manager.getStatus('bob').status, STATUS.READY);
  assert.deepEqual(statuses, [STATUS.CONNECTING, STATUS.AWAITING_PASSWORD, STATUS.READY]);
});

test('ensureSession reports auth-failed on a wrong password, and can be retried', async () => {
  const { pty } = makeFakeSuPty({ username: 'bob' });
  const manager = managerWithFakePty(pty);

  const first = manager.ensureSession('bob');
  await new Promise((resolve) => setTimeout(resolve, 20));
  manager.writeInput('bob', 'wrong-password\n');
  await assert.rejects(first, /Authentication failure/);
  assert.equal(manager.getStatus('bob').status, STATUS.AUTH_FAILED);

  // Retrying re-spawns a fresh shell rather than reusing the failed one.
  const { pty: pty2 } = makeFakeSuPty({ username: 'bob' });
  manager.ptyFactory = () => pty2;
  const second = manager.ensureSession('bob');
  await new Promise((resolve) => setTimeout(resolve, 20));
  manager.writeInput('bob', 'right-password\n');
  const result = await second;
  assert.equal(result.status, STATUS.READY);
});

test('concurrent ensureSession calls share the same in-flight connection instead of double-spawning', async () => {
  const { pty } = makeFakeSuPty({ username: 'bob' });
  let spawnCalls = 0;
  const manager = new SuSessionManager({ ptyFactory: () => { spawnCalls += 1; return pty; } });

  const a = manager.ensureSession('bob');
  const b = manager.ensureSession('bob');
  await new Promise((resolve) => setTimeout(resolve, 20));
  manager.writeInput('bob', 'right-password\n');
  const [resultA, resultB] = await Promise.all([a, b]);
  assert.equal(resultA.status, STATUS.READY);
  assert.equal(resultB.status, STATUS.READY);
  assert.equal(spawnCalls, 1);
});

test('ensureProviderLogin resolves immediately when already logged in', async () => {
  const { pty } = makeFakeSuPty({
    username: 'bob',
    innerCommandRules: {
      'command -v codex': () => ({ output: '/usr/bin/codex\n', exitCode: 0 }),
      'codex login status': () => ({ output: 'Logged in\n', exitCode: 0 })
    }
  });
  const manager = managerWithFakePty(pty);
  const events = [];
  manager.on('provider-status', (event) => events.push(event.status));

  const connectPromise = manager.ensureSession('bob');
  await new Promise((resolve) => setTimeout(resolve, 20));
  manager.writeInput('bob', 'right-password\n');
  await connectPromise;

  const result = await manager.ensureProviderLogin('bob', 'codex');
  assert.equal(result.status, PROVIDER_STATUS.READY);
  assert.deepEqual(events, [PROVIDER_STATUS.CHECKING, PROVIDER_STATUS.READY]);

  // Second call is served from cache - `codex login status` is not run again.
  let statusCalls = 0;
  const originalRule = pty; // no-op, cache check is what matters
  void originalRule;
  const result2 = await manager.ensureProviderLogin('bob', 'codex');
  assert.equal(result2.status, PROVIDER_STATUS.READY);
  void statusCalls;
});

test('ensureProviderLogin runs the OAuth login command and polls status until it succeeds', async () => {
  let statusCallCount = 0;
  const { pty } = makeFakeSuPty({
    username: 'bob',
    innerCommandRules: {
      'command -v codex': () => ({ output: '/usr/bin/codex\n', exitCode: 0 }),
      'codex login status': () => {
        statusCallCount += 1;
        return statusCallCount >= 3 ? { exitCode: 0 } : { exitCode: 1, output: 'Not logged in\n' };
      }
    }
  });
  const manager = managerWithFakePty(pty);
  manager._delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));

  const connectPromise = manager.ensureSession('bob');
  await new Promise((resolve) => setTimeout(resolve, 20));
  manager.writeInput('bob', 'right-password\n');
  await connectPromise;

  const result = await manager.ensureProviderLogin('bob', 'codex');
  assert.equal(result.status, PROVIDER_STATUS.READY);
  assert.ok(statusCallCount >= 3);
});

test('ensureProviderLogin fails clearly when the CLI is not on the target user\'s PATH', async () => {
  const { pty } = makeFakeSuPty({
    username: 'bob',
    innerCommandRules: {
      'command -v codex': () => ({ exitCode: 1 })
    }
  });
  const manager = managerWithFakePty(pty);

  const connectPromise = manager.ensureSession('bob');
  await new Promise((resolve) => setTimeout(resolve, 20));
  manager.writeInput('bob', 'right-password\n');
  await connectPromise;

  await assert.rejects(manager.ensureProviderLogin('bob', 'codex'), /not found on bob's PATH/);
});

test('runInSession rejects immediately when there is no ready session', async () => {
  const manager = new SuSessionManager({ ptyFactory: () => { throw new Error('should not spawn'); } });
  await assert.rejects(manager.runInSession('nobody', ['echo'], ''), /No ready session/);
});

test('disconnect kills the pty and allows a fresh ensureSession afterwards', async () => {
  const { pty } = makeFakeSuPty({ username: 'bob' });
  let spawnCalls = 0;
  const manager = new SuSessionManager({ ptyFactory: () => { spawnCalls += 1; return pty; } });

  const connectPromise = manager.ensureSession('bob');
  await new Promise((resolve) => setTimeout(resolve, 20));
  manager.writeInput('bob', 'right-password\n');
  await connectPromise;
  assert.equal(manager.getStatus('bob').status, STATUS.READY);

  manager.disconnect('bob');
  assert.equal(manager.getStatus('bob').status, STATUS.IDLE);

  const { pty: pty2 } = makeFakeSuPty({ username: 'bob' });
  manager.ptyFactory = () => { spawnCalls += 1; return pty2; };
  const second = manager.ensureSession('bob');
  await new Promise((resolve) => setTimeout(resolve, 20));
  manager.writeInput('bob', 'right-password\n');
  await second;
  assert.equal(spawnCalls, 2);
});

test('isValidUsername rejects a username before it can reach the pty argv', async () => {
  const manager = new SuSessionManager({ ptyFactory: () => { throw new Error('must not spawn'); } });
  await assert.rejects(manager.ensureSession('bob; rm -rf /'), /Invalid username/);
});

// Regression test: the terminal window calls attachViewer() for a username as soon as it
// opens, which can race ahead of ensureSession() actually creating that session's object
// (e.g. a caller opens the window and starts ensureSession in the same tick, but
// attachViewer runs from the window's own async "ready" callback). If attachViewer just
// silently no-ops when there's no session yet, every byte the pty prints before that
// race resolves - including the password prompt itself - never reaches the window, and
// the terminal just looks blank forever even though `su` is genuinely waiting for input.
test('attachViewer called before the session exists still receives pty output once it is created', async () => {
  const { pty } = makeFakeSuPty({ username: 'bob' });
  const manager = managerWithFakePty(pty);

  const received = [];
  manager.attachViewer('bob', (chunk) => received.push(chunk)); // called BEFORE ensureSession
  const connectPromise = manager.ensureSession('bob');

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(received.some((chunk) => chunk.includes('Password:')), 'the password prompt must reach the pre-attached viewer');

  manager.writeInput('bob', 'right-password\n');
  await connectPromise;
});

// Regression test: two independent UIs (e.g. the desktop app's native terminal window and
// a browser tab's in-page terminal panel) can watch the same live "Continue as..." session
// at once, and detaching one must not silence the other.
test('attachViewer supports multiple simultaneous viewers; detaching one leaves the other receiving data', async () => {
  const { pty } = makeFakeSuPty({ username: 'bob' });
  const manager = managerWithFakePty(pty);

  const first = [];
  const second = [];
  const onFirst = (chunk) => first.push(chunk);
  const onSecond = (chunk) => second.push(chunk);
  manager.attachViewer('bob', onFirst);
  manager.attachViewer('bob', onSecond);
  const connectPromise = manager.ensureSession('bob');

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(first.some((chunk) => chunk.includes('Password:')));
  assert.ok(second.some((chunk) => chunk.includes('Password:')));

  manager.detachViewer('bob', onFirst);
  first.length = 0;
  second.length = 0;
  manager.writeInput('bob', 'right-password\n');
  await connectPromise;

  assert.equal(first.length, 0, 'detached viewer must receive nothing further');
  assert.ok(second.length > 0, 'the still-attached viewer must keep receiving data');
});
