const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ChatCore } = require('../src/chatCore');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subjective-chat-core-'));
  return { root, appHome: root };
}

// ChatCore's constructor only sets up in-memory state and an LlmService pointed at
// appHome (which just reads/writes local files) - it never touches the network or spawns
// anything on its own, so it's safe to construct directly in tests.
function core(overrides = {}) {
  const paths = fixture();
  const instance = new ChatCore({ appHome: paths.appHome, ...overrides });
  return { instance, cleanup: () => fs.rmSync(paths.root, { recursive: true, force: true }) };
}

function collectEvents(instance) {
  const events = [];
  instance.on('event', (event) => events.push(event));
  return events;
}

test('parseServerConnection reads host/port/channel/nick/tls in any supplied order', (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);

  const full = instance.parseServerConnection('irc.example.com 6697 #general Tomasso tls Real Name');
  assert.deepEqual(full, {
    // `name` is inherited from the currently-active connection's own name rather than
    // recomputed from the new host/port (this matches main.js's parseServerConnection,
    // which builds the same {...activeConnection(), host, port, ...} shape).
    name: `${instance.defaultConnection.host}:${instance.defaultConnection.port}`,
    host: 'irc.example.com',
    port: 6697,
    tls: true,
    channel: '#general',
    nick: 'Tomasso',
    realname: 'Real Name'
  });

  const minimal = instance.parseServerConnection('irc.example.com');
  assert.equal(minimal.host, 'irc.example.com');
  assert.equal(minimal.tls, false);

  assert.equal(instance.parseServerConnection(''), null);
});

test('applyConnectionAndReconnect normalizes, persists, and broadcasts config + a system notice', (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);
  const events = collectEvents(instance);
  instance.connectIrc = () => { instance.connectIrc.called = true; };

  instance.applyConnectionAndReconnect({ host: 'irc.example.com', port: 6667, channel: 'general', nick: 'Bob' });

  assert.equal(instance.config.host, 'irc.example.com');
  assert.equal(instance.config.channel, '#general');
  assert.ok(fs.existsSync(instance.settingsPath()));
  assert.ok(events.some((event) => event.type === 'config'));
  assert.ok(events.some((event) => event.type === 'system' && event.text.includes('Connection set to')));
  assert.equal(instance.connectIrc.called, true);
});

test('executeSlashCommand rejects everything that needs the wire while disconnected', (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);
  // No socket attached - every command that writes to IRC must report failure rather than
  // throw, matching main.js's writeIrc() guard.
  assert.deepEqual(instance.executeSlashCommand('/nick NewNick'), { ok: false });
  assert.deepEqual(instance.executeSlashCommand('/msg #general hello'), { ok: false });
  assert.deepEqual(instance.executeSlashCommand(''), { ok: false });
});

test('executeSlashCommand /join updates config, clears the user list, and writes JOIN+NAMES', (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);
  const written = [];
  instance.writeIrc = (command) => { written.push(command); return true; };
  instance.channelUsers.set('someone', { nick: 'someone' });

  const result = instance.executeSlashCommand('/join newchannel');

  assert.equal(result.ok, true);
  assert.equal(result.focusTarget, '#newchannel');
  assert.equal(instance.config.channel, '#newchannel');
  assert.equal(instance.channelUsers.size, 0);
  assert.deepEqual(written, ['JOIN #newchannel', 'NAMES #newchannel']);
});

test('an unrecognized slash command is sent to the server as a raw IRC line', (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);
  const written = [];
  instance.writeIrc = (command) => { written.push(command); return true; };

  const result = instance.executeSlashCommand('/mode #general +m');

  assert.equal(result.ok, true);
  assert.deepEqual(written, ['mode #general +m']);
});

test('IRC line handling: 001 joins the configured channel, 353/366 populate the user list, PRIVMSG becomes a message event', (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);
  const written = [];
  instance.writeIrc = (command) => { written.push(command); return true; };
  instance.currentNick = 'Tomasso';
  const events = collectEvents(instance);

  instance._handleIrcLine(':server 001 Tomasso :Welcome');
  assert.deepEqual(written, ['JOIN #subjective', 'NAMES #subjective']);

  instance._handleIrcLine(':server 353 Tomasso = #subjective :Tomasso @botClaude');
  instance._handleIrcLine(':server 366 Tomasso #subjective :End of NAMES');
  const usersEvent = events.find((event) => event.type === 'users');
  assert.deepEqual(usersEvent.users.map((user) => user.nick).sort(), ['Tomasso', 'botClaude']);

  instance._handleIrcLine(':botClaude!bot@host PRIVMSG #subjective :hello there');
  const messageEvent = events.find((event) => event.type === 'message');
  assert.equal(messageEvent.from, 'botClaude');
  assert.equal(messageEvent.text, 'hello there');
  assert.equal(messageEvent.mine, false);
});

test('a PRIVMSG addressed to an active LLM IRC channel is routed to answerLlmMessage instead of becoming a plain message event', async (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);
  instance.currentNick = 'Tomasso';
  instance.activeLlmIrcChannels.set('#claude-demo', 'llm:claude:demo');
  let answered = null;
  instance.answerLlmMessage = async (target, text, from) => {
    answered = { target, text, from };
    return { ok: true };
  };
  const events = collectEvents(instance);

  instance._handleIrcLine(':Someone!u@h PRIVMSG #claude-demo :please continue');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(answered, { target: 'llm:claude:demo', text: 'please continue', from: 'Someone' });
  assert.ok(!events.some((event) => event.type === 'message'));
});

test('llmErrorText only adds the "no memory" note for a timeout status', (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);
  const timeoutText = instance.llmErrorText('Claude', { status: 'timeout', error: 'Claude execution timed out after 1800 seconds.' });
  assert.match(timeoutText, /no memory of this attempt/);

  const otherText = instance.llmErrorText('Claude', { status: 'busy', error: 'Claude is already responding.' });
  assert.doesNotMatch(otherText, /no memory of this attempt/);
});

test('answerLlmMessage broadcasts llm-busy around the send and the user+assistant messages on success', async (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);
  const created = instance.llmService.createConversation({ name: 'Web test', provider: 'codex', workspace: instance.root });
  instance.llmService.sendMessage = async () => ({
    ok: true,
    userMessage: { role: 'user', text: 'hi', time: 1 },
    assistantMessage: { role: 'assistant', text: 'hello back', time: 2 },
    conversation: { target: created.target }
  });
  const events = collectEvents(instance);

  const response = await instance.answerLlmMessage(created.target, 'hi');

  assert.equal(response.ok, true);
  const types = events.map((event) => event.type);
  assert.deepEqual(types, ['llm-busy', 'llm-message', 'llm-message', 'llm-conversation', 'llm-busy']);
  assert.equal(events[0].busy, true);
  assert.equal(events.at(-1).busy, false);
});

test('answerLlmMessage on failure broadcasts a system error instead of llm-message/llm-conversation', async (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);
  const created = instance.llmService.createConversation({ name: 'Web test', provider: 'codex', workspace: instance.root });
  instance.llmService.sendMessage = async () => ({ ok: false, status: 'timeout', error: 'Claude execution timed out after 1800 seconds.' });
  const events = collectEvents(instance);

  const response = await instance.answerLlmMessage(created.target, 'hi');

  assert.equal(response.ok, false);
  assert.ok(!events.some((event) => event.type === 'llm-message'));
  const systemEvent = events.find((event) => event.type === 'system');
  assert.match(systemEvent.text, /no memory of this attempt/);
});

test('IRC writes stay silent while disconnected so LLM sends do not look like failures', async (t) => {
  const logs = [];
  const { instance, cleanup } = core({ log: (level, message) => logs.push({ level, message }) });
  t.after(cleanup);
  const created = instance.llmService.createConversation({ name: 'IRC quiet', provider: 'codex', workspace: instance.root });
  created.ircChannel = '#cursor-quiet';
  instance.llmService.sendMessage = async () => ({
    ok: true,
    userMessage: { role: 'user', text: 'hi', time: 1 },
    assistantMessage: { role: 'assistant', text: 'hello', time: 2 },
    conversation: { target: created.target }
  });

  assert.equal(instance.writeIrc('PRIVMSG #x :y'), false);
  assert.equal(instance.sendIrcText('#x', 'y'), false);
  const response = await instance.sendLlmMessage(created.target, 'hi');
  assert.equal(response.ok, true);
  assert.ok(!logs.some((entry) => entry.level === 'error' && /IRC/i.test(entry.message)));
});

test('buildContextMenuModel short-circuits for a missing conversation and for a read-only one, without touching the system user list', async (t) => {
  const { instance, cleanup } = core();
  t.after(cleanup);

  assert.deepEqual(await instance.buildContextMenuModel('llm:codex:missing'), { renamable: false, continueAs: null });

  const created = instance.llmService.createConversation({ name: 'Read only test', provider: 'codex', workspace: instance.root });
  const conversation = instance.llmService.findConversation(created.target);
  conversation.writable = false;
  instance.llmService.findConversation = (target) => (target === created.target ? conversation : null);

  assert.deepEqual(await instance.buildContextMenuModel(created.target), { renamable: true, continueAs: null });
});
