// Enumerates real Linux user accounts on this machine so the "Continue as…" conversation
// menu can offer them. Linux-only (relies on `getent passwd` / /etc/passwd); on any other
// platform listSystemUsers() reports itself unsupported rather than guessing.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

const NOLOGIN_SHELLS = new Set(['/usr/sbin/nologin', '/sbin/nologin', '/bin/false', '/usr/bin/false', '']);
const MIN_UID = 1000;
const MAX_UID = 60000; // excludes `nobody` (65534) and other high system/service UIDs
const USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;

function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_PATTERN.test(username);
}

function parsePasswdLine(line) {
  const fields = String(line || '').split(':');
  if (fields.length < 7) return null;
  const [username, , uidRaw, , gecos, home, shell] = fields;
  const uid = Number(uidRaw);
  if (!username || !Number.isFinite(uid)) return null;
  return { username, uid, gecos: gecos || '', home: home || '', shell: (shell || '').trim() };
}

function parsePasswdText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parsePasswdLine)
    .filter(Boolean);
}

function filterHumanUsers(entries, { excludeUsername = '', includeExcluded = false } = {}) {
  return entries
    .filter((entry) => entry.uid >= MIN_UID && entry.uid <= MAX_UID)
    .filter((entry) => !NOLOGIN_SHELLS.has(entry.shell))
    .filter((entry) => includeExcluded || entry.username !== excludeUsername)
    .sort((a, b) => a.username.localeCompare(b.username));
}

// Reads the full account list via `getent passwd` (resolves NSS-backed accounts too, not
// just local /etc/passwd), falling back to a direct /etc/passwd read if `getent` is missing.
function readPasswdEntries({ spawnFn = spawn, readFile = fs.readFileSync } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fallbackToEtcPasswd = () => {
      try {
        settle({ ok: true, text: readFile('/etc/passwd', 'utf8') });
      } catch (error) {
        settle({ ok: false, error: `Could not list system users: ${error.message}` });
      }
    };
    let child;
    try {
      child = spawnFn('getent', ['passwd']);
    } catch (error) {
      fallbackToEtcPasswd();
      return;
    }
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', fallbackToEtcPasswd);
    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        settle({ ok: true, text: stdout });
      } else {
        fallbackToEtcPasswd();
      }
    });
  });
}

async function listSystemUsers(options = {}) {
  if (process.platform !== 'linux') {
    return { ok: false, users: [], error: 'Switching OS users is only supported on Linux.' };
  }
  const excludeUsername = options.includeCurrent ? '' : (options.excludeUsername || os.userInfo().username);
  const read = await readPasswdEntries(options);
  if (!read.ok) return { ok: false, users: [], error: read.error };
  const entries = parsePasswdText(read.text);
  const users = filterHumanUsers(entries, {
    excludeUsername,
    includeExcluded: Boolean(options.includeCurrent)
  }).map(({ username, uid, home, gecos }) => ({
    username,
    uid,
    home,
    gecos,
    current: username === os.userInfo().username
  }));
  return { ok: true, users };
}

module.exports = {
  listSystemUsers,
  parsePasswdLine,
  parsePasswdText,
  filterHumanUsers,
  isValidUsername,
  USERNAME_PATTERN,
  MIN_UID,
  MAX_UID,
  NOLOGIN_SHELLS
};
