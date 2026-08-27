// Discovers which OS users on this machine look logged in to each agent CLI
// (Claude / Codex / Cursor). Only checks that known credential files exist and
// are readable — never reads token contents. Used to offer a "run as this user"
// picker when the current process's login is missing or expired.
const fs = require('fs');
const os = require('os');
const path = require('path');

const { listSystemUsers } = require('./systemUsers');

const CREDENTIAL_MARKERS = Object.freeze({
  claude: [
    '.claude/.credentials.json',
    '.claude/credentials.json',
    '.config/claude/.credentials.json',
    '.config/claude/credentials.json',
    '.config/claude-code/.credentials.json',
    '.local/share/claude/.credentials.json',
    '.claude.json'
  ],
  codex: [
    '.codex/auth.json',
    '.codex/.auth.json'
  ],
  cursor: [
    '.config/cursor/auth.json'
  ]
});

function probeMarker(filePath) {
  try {
    // Existence only — never read token contents. 0600 files owned by another
    // user fail R_OK even when the login file is present.
    fs.accessSync(filePath, fs.constants.F_OK);
    return 'present';
  } catch (error) {
    if (error && error.code === 'EACCES') return 'unknown';
    return 'missing';
  }
}

function probeHome(home) {
  const providers = {};
  for (const [provider, relatives] of Object.entries(CREDENTIAL_MARKERS)) {
    const states = relatives.map((relative) => probeMarker(path.join(home, relative)));
    providers[provider] = {
      ready: states.includes('present'),
      unknown: !states.includes('present') && states.includes('unknown')
    };
  }
  return providers;
}

async function listProviderSessions(options = {}) {
  const currentUser = os.userInfo().username;
  const listed = await listSystemUsers({ includeCurrent: true, ...options });
  if (!listed.ok) return { ok: false, currentUser, users: [], error: listed.error };
  const users = listed.users.map((user) => {
    const providers = probeHome(user.home || path.join('/home', user.username));
    return {
      username: user.username,
      home: user.home,
      current: user.username === currentUser,
      providers
    };
  });
  return { ok: true, currentUser, users };
}

function sessionsForProvider(listed, provider) {
  const key = String(provider || '').toLowerCase();
  const users = (listed.users || []).map((user) => ({
    username: user.username,
    current: Boolean(user.current),
    ready: Boolean(user.providers?.[key]?.ready),
    unknown: Boolean(user.providers?.[key]?.unknown)
  }));
  users.sort((left, right) => (
    Number(right.ready) - Number(left.ready)
    || Number(right.unknown) - Number(left.unknown)
    || left.username.localeCompare(right.username)
  ));
  return {
    ok: listed.ok !== false,
    provider: key,
    currentUser: listed.currentUser,
    users
  };
}

module.exports = {
  CREDENTIAL_MARKERS,
  probeHome,
  listProviderSessions,
  sessionsForProvider
};
