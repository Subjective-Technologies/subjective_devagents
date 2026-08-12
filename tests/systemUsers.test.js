const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  listSystemUsers,
  parsePasswdLine,
  filterHumanUsers,
  isValidUsername
} = require('../src/systemUsers');

const SAMPLE_PASSWD = [
  'root:x:0:0:root:/root:/bin/bash',
  'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
  'nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin',
  'alice:x:1000:1000:Alice:/home/alice:/bin/bash',
  'bob:x:1001:1001:Bob:/home/bob:/bin/zsh',
  'svc-app:x:998:998:service account:/var/lib/svc-app:/usr/sbin/nologin'
].join('\n');

function fakeSpawn(stdout, { code = 0, spawnError = null } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      if (spawnError) {
        child.emit('error', spawnError);
        return;
      }
      child.stdout.end(stdout);
      child.emit('close', code);
    });
    return child;
  };
}

test('parsePasswdLine extracts username/uid/shell/home, rejects malformed lines', () => {
  assert.deepEqual(parsePasswdLine('alice:x:1000:1000:Alice:/home/alice:/bin/bash'), {
    username: 'alice', uid: 1000, gecos: 'Alice', home: '/home/alice', shell: '/bin/bash'
  });
  assert.equal(parsePasswdLine('not-enough-fields'), null);
  assert.equal(parsePasswdLine(''), null);
});

test('filterHumanUsers keeps only real human accounts, excludes the current user, sorts alphabetically', () => {
  const entries = SAMPLE_PASSWD.split('\n').map(parsePasswdLine);
  const users = filterHumanUsers(entries, { excludeUsername: 'bob' });
  assert.deepEqual(users.map((u) => u.username), ['alice']);
});

test('listSystemUsers parses `getent passwd` output end-to-end and excludes the current user', async () => {
  const result = await listSystemUsers({
    excludeUsername: 'alice',
    spawnFn: fakeSpawn(SAMPLE_PASSWD)
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.users.map((u) => u.username), ['bob']);
  assert.equal(result.users[0].home, '/home/bob');
});

test('listSystemUsers falls back to /etc/passwd when `getent` is missing', async () => {
  const result = await listSystemUsers({
    excludeUsername: 'zzz-nobody-here',
    spawnFn: fakeSpawn('', { spawnError: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }),
    readFile: () => SAMPLE_PASSWD
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.users.map((u) => u.username).sort(), ['alice', 'bob']);
});

test('listSystemUsers reports a clear error when both getent and /etc/passwd are unavailable', async () => {
  const result = await listSystemUsers({
    spawnFn: fakeSpawn('', { spawnError: new Error('ENOENT') }),
    readFile: () => { throw new Error('permission denied'); }
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /permission denied/);
});

test('isValidUsername enforces the standard Linux username charset', () => {
  assert.equal(isValidUsername('bob'), true);
  assert.equal(isValidUsername('_svc-1'), true);
  assert.equal(isValidUsername('Bob'), false);
  assert.equal(isValidUsername('bob; rm -rf /'), false);
  assert.equal(isValidUsername(''), false);
  assert.equal(isValidUsername(null), false);
});
