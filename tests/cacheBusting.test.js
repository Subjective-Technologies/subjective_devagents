// Every ?v= tag in the web bundle was a hand-maintained constant. They had not been
// bumped since 2026-09-11, so each renderer change after that reached the origin and was
// still served from Cloudflare's edge and from browsers' own caches: deployed, invisible.
// The tags are now stamped with the live deploy version, and nothing may reintroduce a
// literal one.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

const versioned = (text) => [...text.matchAll(/\?v=([A-Za-z0-9_.+-]+)/g)].map((m) => m[1]);

test('no file in the web bundle pins a literal ?v= tag', () => {
  for (const name of fs.readdirSync(WEB)) {
    if (!/\.(html|js)$/.test(name)) continue;
    const tags = versioned(fs.readFileSync(path.join(WEB, name), 'utf8'));
    const literal = tags.filter((tag) => tag !== 'DEVAGENTS_DEPLOY_VERSION');
    assert.deepStrictEqual(literal, [], `${name} pins ${literal.join(', ')} — it will be served stale`);
  }
});

test('bootstrap.js versions every script it loads', () => {
  const boot = fs.readFileSync(path.join(WEB, 'bootstrap.js'), 'utf8');
  const sources = [...boot.matchAll(/'(\/[A-Za-z0-9_.-]+\.js)([^']*)'/g)];
  assert.ok(sources.length >= 3, `expected several scripts, saw ${sources.length}`);
  for (const [, file, query] of sources) {
    assert.strictEqual(query, '?v=DEVAGENTS_DEPLOY_VERSION', `${file} is loaded without a stamped version`);
  }
});

test('the server replaces the placeholder when serving js', () => {
  const server = fs.readFileSync(path.join(ROOT, 'src', 'webServer.js'), 'utf8');
  assert.match(server, /ext === '\.js'[\s\S]{0,400}DEVAGENTS_DEPLOY_VERSION/,
    'webServer.js must stamp .js, or bootstrap.js ships the literal placeholder');
});
