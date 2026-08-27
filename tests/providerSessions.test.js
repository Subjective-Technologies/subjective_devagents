const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { probeHome } = require('../src/providerSessions');

test('probeHome treats an unreadable-but-present credential file as ready', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'subj-probe-'));
  const hidden = path.join(home, '.claude');
  fs.mkdirSync(hidden);
  const creds = path.join(hidden, '.credentials.json');
  fs.writeFileSync(creds, '{}');
  fs.chmodSync(creds, 0o000);
  const providers = probeHome(home);
  fs.chmodSync(creds, 0o600);
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(providers.claude.ready, true);
});
