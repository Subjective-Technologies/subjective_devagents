// Exercises SuSessionManager against a REAL pty and a REAL instance of
// pipeline_bridge_server.py - no `su`/sudo required. It substitutes a plain `bash`
// process for `su - <user>` (via a custom ptyFactory) and targets the CURRENT OS user,
// so the manager's own `whoami` auth-confirmation probe passes for real, without a
// second account or a real password. This is the thing the pure fake-pty unit tests in
// suSessionManager.test.js cannot cover: real tty line-discipline behavior, real ANSI/
// echo bytes, and the real Unix-socket bridge protocol end to end.
//
// Skipped automatically if node-pty could not be loaded (e.g. dependencies not yet
// rebuilt for the current Electron/Node ABI) rather than failing the whole test run.
const assert = require('node:assert/strict');
const os = require('node:os');
const test = require('node:test');

let pty = null;
try {
  // eslint-disable-next-line global-require
  pty = require('node-pty');
} catch (_error) {
  pty = null;
}

const { SuSessionManager, STATUS } = require('../src/suSessionManager');

const currentUsername = os.userInfo().username;

test('real pty + real bridge: connects as the current user and bridges a real command', { skip: !pty && 'node-pty is not built for this Node ABI' }, async (t) => {
  const manager = new SuSessionManager({
    // Stand in for `su - <user>`: a plain bash targeting the CURRENT user, so the
    // manager's own whoami probe (which expects to see `session.username`) passes
    // without needing a real second account or password.
    ptyFactory: () => pty.spawn('bash', ['--norc', '--noprofile'], {
      name: 'xterm-256color', cols: 100, rows: 30, cwd: os.homedir(), env: process.env
    })
  });
  t.after(() => manager.disconnectAll());

  const result = await manager.ensureSession(currentUsername);
  assert.equal(result.status, STATUS.READY);
  assert.equal(manager.getStatus(currentUsername).status, STATUS.READY);

  const bridgeResult = await manager.runInSession(
    currentUsername,
    ['python3', '-c', 'import sys; print(sys.stdin.read().strip().upper())'],
    'hello from the bridge'
  );
  assert.equal(bridgeResult.exitCode, 0);
  assert.equal(bridgeResult.stdout.trim(), 'HELLO FROM THE BRIDGE');

  // A second call reuses the same bridge connection rather than starting a new server.
  const bridgeResult2 = await manager.runInSession(currentUsername, ['echo', 'again'], '');
  assert.equal(bridgeResult2.exitCode, 0);
  assert.equal(bridgeResult2.stdout.trim(), 'again');

  // Concurrent calls are serialized, not interleaved.
  const [a, b] = await Promise.all([
    manager.runInSession(currentUsername, ['python3', '-c', 'import time; time.sleep(0.2); print("A")'], ''),
    manager.runInSession(currentUsername, ['echo', 'B'], '')
  ]);
  assert.equal(a.stdout.trim(), 'A');
  assert.equal(b.stdout.trim(), 'B');

  manager.disconnect(currentUsername);
  assert.equal(manager.getStatus(currentUsername).status, STATUS.IDLE);
});
