// The Electron-independent backend: IRC client, LLM agent conversations, DCC file
// transfer, and "Continue as..." su-session glue. This is what "share the same backend"
// between the desktop app and the web app means in practice - both point ChatCore at the
// same appHome (so conversation history/state is the same file on disk) and both drive
// the same LlmService/SuSessionManager modules to spawn the same local codex/claude CLI
// subprocesses and su/pty sessions, on this machine, the same way.
//
// main.js (Electron) keeps its own IRC client implementation untouched - it already works
// and is exercised by real usage, so it isn't worth the regression risk of re-plumbing it
// through here. This is a careful, behavior-matching port of that same protocol logic for
// webServer.js to drive instead. What IS shared, verbatim, unmodified, is the expensive
// part: LlmService (spawns the actual CLI subprocesses) and SuSessionManager (owns the
// su/pty sessions) - see requires below.
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');
const { LlmService, providerLabel } = require('./llmService');
const { listSystemUsers, isValidUsername } = require('./systemUsers');
const { SuSessionManager } = require('./suSessionManager');

const DEFAULT_CONNECTION = {
  name: 'Subjective LAN',
  host: '192.168.0.250',
  port: 6667,
  tls: false,
  channel: '#subjective',
  nick: 'Tomasso',
  realname: 'Tomasso'
};

function isTlsToken(value) {
  return /^(1|true|yes|on|tls|ssl)$/i.test(String(value || '').trim());
}

class ChatCore extends EventEmitter {
  constructor(options = {}) {
    super();
    this.root = options.root || path.resolve(__dirname, '..');
    this.applicationHome = options.appHome || process.env.SUBJECTIVE_CHAT_HOME || path.join(os.homedir(), '.subjective_chat');
    this.logFn = options.log || (() => {});

    this.defaultConnection = { ...DEFAULT_CONNECTION, ...(options.defaultConnection || {}) };
    this.config = {
      host: process.env.IRC_HOST || this.defaultConnection.host,
      port: Number(process.env.IRC_PORT || this.defaultConnection.port),
      tls: String(process.env.IRC_TLS || 'false').toLowerCase() === 'true',
      channel: process.env.IRC_CHANNEL || this.defaultConnection.channel,
      nick: process.env.IRC_NICK || this.defaultConnection.nick,
      realname: process.env.IRC_REALNAME || process.env.IRC_NICK || this.defaultConnection.realname,
      dccPublicHost: process.env.DCC_PUBLIC_HOST || '',
      downloadDir: process.env.DCC_DOWNLOAD_DIR ? path.resolve(this.root, process.env.DCC_DOWNLOAD_DIR) : path.join(os.homedir(), 'Downloads'),
      sentDir: path.join(this.applicationHome, 'sent')
    };

    this.bookmarks = [];
    this.manualDisconnect = false;
    this.socket = null;
    this.connected = false;
    this.registered = false;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.lineBuffer = '';
    this.currentNick = this.config.nick;
    this.channelUsers = new Map();
    this.namesBuffer = [];
    this.namesRefreshTimer = null;
    this.nickRetryTimer = null;
    this.activeLlmIrcChannels = new Map();
    this.shuttingDown = false;

    this.suSessionManager = new SuSessionManager();
    this.suSessionManager.on('status', (event) => this._broadcast('switchuser-status', event));
    this.suSessionManager.on('provider-status', (event) => this._broadcast('switchuser-provider-status', event));

    this.llmService = new LlmService({
      root: this.root,
      appHome: this.applicationHome,
      suSessionManager: this.suSessionManager
    });
    for (const conversation of this.llmService.listConversations().filter((item) => item.activeOnIrc)) {
      this.activeLlmIrcChannels.set(conversation.ircChannel.toLowerCase(), conversation.target);
    }
  }

  log(level, message, details = {}) {
    this.logFn(level, message, details);
  }

  _broadcast(type, payload = {}) {
    this.emit('event', { type, ...payload });
  }

  // --- settings -------------------------------------------------------------------

  settingsPath() {
    return path.join(this.applicationHome, 'settings.json');
  }

  publicConfig() {
    return {
      host: this.config.host,
      port: this.config.port,
      tls: this.config.tls,
      channel: this.config.channel,
      nick: this.config.nick,
      realname: this.config.realname,
      downloadDir: this.config.downloadDir,
      bookmarks: this.bookmarks
    };
  }

  normalizeConnection(input = {}, fallback = this.activeConnection()) {
    const host = String(input.host || fallback.host || this.defaultConnection.host).trim();
    const port = Number(input.port || fallback.port || this.defaultConnection.port);
    const channel = String(input.channel || fallback.channel || this.defaultConnection.channel).trim();
    const nick = String(input.nick || fallback.nick || this.defaultConnection.nick).trim();
    const realname = String(input.realname || fallback.realname || nick || this.defaultConnection.realname).trim();
    return {
      name: String(input.name || `${host}:${Number.isFinite(port) ? port : this.defaultConnection.port}`).trim(),
      host,
      port: Number.isFinite(port) && port > 0 ? port : this.defaultConnection.port,
      tls: Boolean(input.tls),
      channel: channel.startsWith('#') ? channel : `#${channel || this.defaultConnection.channel.replace(/^#/, '')}`,
      nick,
      realname
    };
  }

  activeConnection() {
    return this.normalizeConnection(this.config, this.defaultConnection);
  }

  applyConnection(connection) {
    const next = this.normalizeConnection(connection, this.activeConnection());
    this.config.host = next.host;
    this.config.port = next.port;
    this.config.tls = next.tls;
    this.config.channel = next.channel;
    this.config.nick = next.nick;
    this.config.realname = next.realname;
    this.currentNick = next.nick;
  }

  ensureBookmark(connection) {
    const next = this.normalizeConnection(connection);
    const key = (item) => `${item.host}:${item.port}:${item.channel}:${item.nick}`.toLowerCase();
    this.bookmarks = [next, ...this.bookmarks.filter((item) => key(item) !== key(next))].slice(0, 24);
  }

  loadSettings() {
    const fallbackBookmark = this.normalizeConnection({ ...this.defaultConnection, ...this.activeConnection() });
    this.bookmarks = [fallbackBookmark];
    try {
      const raw = fs.readFileSync(this.settingsPath(), 'utf8');
      const saved = JSON.parse(raw);
      if (saved.active) this.applyConnection(saved.active);
      if (Array.isArray(saved.bookmarks) && saved.bookmarks.length) this.bookmarks = saved.bookmarks.map((item) => this.normalizeConnection(item));
      this.ensureBookmark(this.activeConnection());
    } catch (_error) {
      this.ensureBookmark(this.activeConnection());
    }
  }

  saveSettings() {
    const payload = { active: this.activeConnection(), bookmarks: this.bookmarks };
    fs.mkdirSync(path.dirname(this.settingsPath()), { recursive: true });
    fs.writeFileSync(this.settingsPath(), `${JSON.stringify(payload, null, 2)}\n`);
  }

  emitConfig() {
    this._broadcast('config', this.publicConfig());
  }

  applyConnectionAndReconnect(connection, shouldSaveBookmark = true) {
    this.applyConnection(connection);
    if (shouldSaveBookmark) this.ensureBookmark(this.activeConnection());
    this.saveSettings();
    this.emitConfig();
    this._broadcast('system', { target: this.config.channel, text: `Connection set to ${this.config.host}:${this.config.port} ${this.config.channel}` });
    this.manualDisconnect = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      this._broadcast('status', { state: 'reconnecting', text: 'Applying connection settings...' });
      this.socket.once('close', () => setTimeout(() => this.connectIrc(), 400));
      this.disconnectIrc(false);
    } else {
      this.connectIrc();
    }
  }

  parseServerConnection(argsText) {
    const tokens = String(argsText || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;

    let useTls = this.config.tls;
    const tlsIndex = tokens.findIndex(isTlsToken);
    if (tlsIndex !== -1) {
      useTls = isTlsToken(tokens[tlsIndex]);
      tokens.splice(tlsIndex, 1);
    }

    const host = tokens.shift();
    if (!host) return null;

    let port = this.config.port;
    if (tokens[0] && /^\d+$/.test(tokens[0])) port = Number(tokens.shift());

    let channel = this.config.channel;
    if (tokens[0] && tokens[0].startsWith('#')) channel = tokens.shift();

    let nick = this.config.nick;
    if (tokens[0] && !/^\d+$/.test(tokens[0]) && !tokens[0].startsWith('#')) nick = tokens.shift();

    const realname = tokens.length ? tokens.join(' ') : nick;
    return this.normalizeConnection({ ...this.activeConnection(), host, port, channel, nick, realname, tls: useTls });
  }

  // --- IRC wire protocol ------------------------------------------------------------

  writeIrc(command) {
    if (!this.socket || !this.connected) {
      this.log('error', 'Attempted IRC write while disconnected', { command });
      return false;
    }
    this.socket.write(`${command}\r\n`);
    return true;
  }

  sendIrcText(target, text) {
    const clean = String(text || '').replace(/[\r\n]+/g, ' ').trim();
    if (!clean) return false;
    const chunks = clean.match(/.{1,380}(?:\s+|$)|.{1,380}/g) || [clean];
    let sent = false;
    for (const chunk of chunks) sent = this.writeIrc(`PRIVMSG ${target} :${chunk.trim()}`) || sent;
    return sent;
  }

  sendAction(target, text) {
    return this.writeIrc(`PRIVMSG ${target} :\x01ACTION ${text}\x01`);
  }

  connectIrc() {
    if (this.connected || this.socket) return;

    this.manualDisconnect = false;
    this.registered = false;
    clearTimeout(this.nickRetryTimer);
    this.nickRetryTimer = null;
    fs.mkdirSync(this.config.downloadDir, { recursive: true });
    fs.mkdirSync(this.config.sentDir, { recursive: true });
    this.lineBuffer = '';
    this.namesBuffer = [];
    this.channelUsers = new Map();
    this.currentNick = this.config.nick;

    const options = { host: this.config.host, port: this.config.port, rejectUnauthorized: false };
    this.log('info', 'Connecting to IRC', { host: this.config.host, port: this.config.port, tls: this.config.tls, channel: this.config.channel, nick: this.config.nick });
    this.socket = this.config.tls ? tls.connect(options) : net.connect(options);
    this.socket.setEncoding('utf8');

    this.socket.on('connect', () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      this.log('info', 'IRC connected');
      this._broadcast('status', { state: 'connected', text: `Connected to ${this.config.host}:${this.config.port}` });
      this.writeIrc(`NICK ${this.config.nick}`);
      this.writeIrc(`USER ${this.config.nick} 0 * :${this.config.realname}`);
    });

    this.socket.on('data', (chunk) => {
      this.lineBuffer += chunk;
      const lines = this.lineBuffer.split(/\r?\n/);
      this.lineBuffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) this._handleIrcLine(line);
    });

    this.socket.on('error', (error) => {
      this.log('error', 'IRC socket error', { message: error.message, stack: error.stack });
      this._broadcast('status', { state: 'error', text: error.message });
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.registered = false;
      this.socket = null;
      clearTimeout(this.nickRetryTimer);
      this.nickRetryTimer = null;
      this.log('info', 'IRC disconnected', { manualDisconnect: this.manualDisconnect });
      this._broadcast('status', { state: 'disconnected', text: 'Disconnected' });
      this._updateUsers();
      this._scheduleReconnect();
    });
  }

  disconnectIrc(userRequested = false) {
    if (userRequested) this.manualDisconnect = true;
    if (!this.socket) return;
    if (this.connected) this.writeIrc('QUIT :Subjective Chat closed');
    this.socket.end();
  }

  reconnectNow() {
    this.manualDisconnect = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      this._broadcast('status', { state: 'reconnecting', text: 'Reconnecting...' });
      this.socket.once('close', () => setTimeout(() => this.connectIrc(), 1500));
      this.disconnectIrc(false);
      return;
    }
    this.connectIrc();
  }

  _scheduleReconnect() {
    if (this.shuttingDown || this.manualDisconnect || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this._broadcast('status', { state: 'reconnecting', text: `Reconnecting in ${Math.round(delay / 1000)}s` });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectIrc();
    }, delay);
  }

  shutdown() {
    this.shuttingDown = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.nickRetryTimer);
    this.suSessionManager?.disconnectAll();
    if (this.socket) this.disconnectIrc(true);
  }

  _parseIrcLine(line) {
    let rest = line;
    let prefix = '';
    if (rest.startsWith(':')) {
      const space = rest.indexOf(' ');
      prefix = rest.slice(1, space);
      rest = rest.slice(space + 1);
    }
    const trailingIndex = rest.indexOf(' :');
    let trailing = null;
    if (trailingIndex !== -1) {
      trailing = rest.slice(trailingIndex + 2);
      rest = rest.slice(0, trailingIndex);
    }
    const parts = rest.trim() ? rest.trim().split(/\s+/) : [];
    const command = parts.shift() || '';
    if (trailing !== null) parts.push(trailing);
    return { prefix, command, params: parts, raw: line };
  }

  _nickFromPrefix(prefix) {
    return prefix.split('!')[0] || prefix;
  }

  _normalizeNick(rawNick) {
    return rawNick.replace(/^[~&@%+]+/, '');
  }

  _userRecord(rawNick) {
    const modes = rawNick.match(/^[~&@%+]+/)?.[0] || '';
    const nick = this._normalizeNick(rawNick);
    return { nick, modes, self: nick.toLowerCase() === this.currentNick.toLowerCase() };
  }

  _setChannelUser(rawNick) {
    const record = this._userRecord(rawNick);
    if (record.nick) this.channelUsers.set(record.nick.toLowerCase(), record);
  }

  _removeChannelUser(nick) {
    this.channelUsers.delete(nick.toLowerCase());
  }

  _renameChannelUser(oldNick, newNick) {
    const existing = this.channelUsers.get(oldNick.toLowerCase());
    if (existing) {
      this.channelUsers.delete(oldNick.toLowerCase());
      this.channelUsers.set(newNick.toLowerCase(), { ...existing, nick: newNick, self: existing.self || newNick === this.currentNick });
    }
  }

  _updateUsers() {
    const users = [...this.channelUsers.values()].sort((a, b) => a.nick.localeCompare(b.nick));
    this._broadcast('users', { channel: this.config.channel, users });
  }

  _cleanChannelName(channel) {
    return String(channel || '').replace(/^:/, '');
  }

  _isConfiguredChannel(channel) {
    return this._cleanChannelName(channel).toLowerCase() === this.config.channel.toLowerCase();
  }

  _requestNamesSoon() {
    if (!this.registered || this.namesRefreshTimer) return;
    this.namesRefreshTimer = setTimeout(() => {
      this.namesRefreshTimer = null;
      if (this.registered && this.connected) {
        this.namesBuffer = [];
        this.writeIrc(`NAMES ${this.config.channel}`);
      }
    }, 750);
  }

  _retryConfiguredNickSoon() {
    if (this.nickRetryTimer || this.shuttingDown) return;
    this.nickRetryTimer = setTimeout(() => {
      this.nickRetryTimer = null;
      if (!this.connected || this.registered) return;
      this._broadcast('status', { state: 'reconnecting', text: `Waiting for ${this.config.nick} to disconnect...` });
      this.writeIrc(`NICK ${this.config.nick}`);
    }, 5000);
  }

  _conversationTarget(target, from) {
    if (target.toLowerCase() === this.currentNick.toLowerCase()) return from;
    if (target.toLowerCase() === this.config.channel.toLowerCase()) return this.config.channel;
    return target;
  }

  _channelRecipients() {
    return [...this.channelUsers.values()]
      .map((user) => user.nick)
      .filter((nick) => nick.toLowerCase() !== this.currentNick.toLowerCase());
  }

  _handleIrcLine(line) {
    const message = this._parseIrcLine(line);

    if (message.command === 'PING') {
      this.writeIrc(`PONG :${message.params[0] || ''}`);
      return;
    }

    if (message.command === '001') {
      this.registered = true;
      clearTimeout(this.nickRetryTimer);
      this.nickRetryTimer = null;
      this.writeIrc(`JOIN ${this.config.channel}`);
      this.writeIrc(`NAMES ${this.config.channel}`);
      for (const channel of this.activeLlmIrcChannels.keys()) this.writeIrc(`JOIN ${channel}`);
      this._broadcast('system', { target: this.config.channel, text: `Joined ${this.config.channel}` });
      return;
    }

    if (message.command === '353') {
      if (this._isConfiguredChannel(message.params[2])) {
        this.namesBuffer.push(...String(message.params[3] || '').split(/\s+/).filter(Boolean));
      }
      return;
    }

    if (message.command === '366') {
      if (!this._isConfiguredChannel(message.params[1])) return;
      this.channelUsers = new Map();
      for (const nick of this.namesBuffer) this._setChannelUser(nick);
      this.namesBuffer = [];
      this._updateUsers();
      return;
    }

    if (message.command === '433') {
      this._broadcast('status', { state: 'reconnecting', text: `${this.config.nick} is still disconnecting. Retrying...` });
      this._retryConfiguredNickSoon();
      return;
    }

    if (message.command === 'JOIN') {
      const nick = this._nickFromPrefix(message.prefix);
      if (!this._isConfiguredChannel(message.params[0])) return;
      this._setChannelUser(nick);
      this._updateUsers();
      this._requestNamesSoon();
      this._broadcast('join', { target: this.config.channel, nick, channel: this._cleanChannelName(message.params[0]) });
      return;
    }

    if (message.command === 'PART') {
      const nick = this._nickFromPrefix(message.prefix);
      if (!this._isConfiguredChannel(message.params[0])) return;
      this._removeChannelUser(nick);
      this._updateUsers();
      this._requestNamesSoon();
      this._broadcast('part', { target: this.config.channel, nick, text: message.params.at(-1) || '' });
      return;
    }

    if (message.command === 'QUIT') {
      const nick = this._nickFromPrefix(message.prefix);
      this._removeChannelUser(nick);
      this._updateUsers();
      this._requestNamesSoon();
      this._broadcast('part', { target: this.config.channel, nick, text: message.params.at(-1) || '' });
      return;
    }

    if (message.command === 'NICK') {
      const oldNick = this._nickFromPrefix(message.prefix);
      const newNick = message.params[0];
      if (oldNick.toLowerCase() === this.currentNick.toLowerCase()) this.currentNick = newNick;
      this._renameChannelUser(oldNick, newNick);
      this._updateUsers();
      this._requestNamesSoon();
      this._broadcast('system', { target: this.config.channel, text: `${oldNick} is now ${newNick}` });
      return;
    }

    if (message.command === 'PRIVMSG') {
      const from = this._nickFromPrefix(message.prefix);
      const target = message.params[0];
      const text = message.params[1] || '';

      if (text.startsWith('\x01') && text.endsWith('\x01')) {
        this._handleCtcp(from, target, text.slice(1, -1));
        return;
      }

      const llmTarget = this.activeLlmIrcChannels.get(String(target).toLowerCase());
      if (llmTarget) {
        if (from.toLowerCase() !== this.currentNick.toLowerCase()) {
          this.answerLlmMessage(llmTarget, text, from, true).catch((error) => {
            this.log('error', 'Failed to answer IRC LLM channel message', { target: llmTarget, from, message: error.message });
          });
        }
        return;
      }

      const conversation = this._conversationTarget(target, from);
      this._broadcast('message', { target: conversation, from, text, mine: from.toLowerCase() === this.currentNick.toLowerCase(), time: Date.now(), private: conversation === from });
      return;
    }

    if (/^\d+$/.test(message.command)) return;
    this._broadcast('raw', { text: line });
  }

  _handleCtcp(from, target, body) {
    if (body === 'VERSION') {
      this.writeIrc(`NOTICE ${from} :\x01VERSION Subjective Chat web client\x01`);
      return;
    }
    if (!body.startsWith('DCC ')) return;
    const parts = this._splitDcc(body);
    if (parts[1] !== 'SEND' || parts.length < 5) return;

    const fileName = path.basename(parts[2]);
    const host = this._decodeDccAddress(parts[3]);
    const port = Number(parts[4]);
    const size = Number(parts[5] || 0);
    if (!fileName || !host || !port) return;

    const hintedTarget = this._dccContextTarget(parts);
    const conversation = hintedTarget || this._conversationTarget(target, from);
    this._receiveDccFile({ from, target: conversation, fileName, host, port, size });
  }

  _splitDcc(body) {
    const matches = body.match(/"[^"]+"|\S+/g) || [];
    return matches.map((part) => (part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part));
  }

  _decodeDccAddress(value) {
    if (/^\d+$/.test(value)) {
      const n = Number(value);
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    }
    return value;
  }

  _encodeDccAddress(host) {
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return host;
    return String(((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]);
  }

  _dccContextTarget(parts) {
    const index = parts.indexOf('SUBJECTIVE_TARGET');
    if (index === -1 || !parts[index + 1]) return '';
    try {
      return decodeURIComponent(parts[index + 1]);
    } catch (_error) {
      return parts[index + 1];
    }
  }

  _isImageFile(fileName) {
    if (/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(fileName)) return true;
    if (!fs.existsSync(fileName)) return false;
    try {
      const fd = fs.openSync(fileName, 'r');
      const header = Buffer.alloc(16);
      const bytes = fs.readSync(fd, header, 0, header.length, 0);
      fs.closeSync(fd);
      if (bytes < 4) return false;
      if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return true;
      if (header.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
      if (header.slice(0, 6).toString('ascii') === 'GIF87a' || header.slice(0, 6).toString('ascii') === 'GIF89a') return true;
      if (header.slice(0, 2).toString('ascii') === 'BM') return true;
      if (header.slice(0, 4).toString('ascii') === 'RIFF' && header.slice(8, 12).toString('ascii') === 'WEBP') return true;
      if (header.slice(4, 12).toString('ascii') === 'ftypavif') return true;
    } catch (error) {
      this.log('error', 'Image type detection failed', { fileName, message: error.message });
    }
    return false;
  }

  _safeFileName(fileName) {
    return path.basename(fileName).replace(/[^\w .()[\]-]/g, '_');
  }

  _uniquePath(filePath) {
    if (!fs.existsSync(filePath)) return filePath;
    const parsed = path.parse(filePath);
    let index = 1;
    let nextPath;
    do {
      nextPath = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    } while (fs.existsSync(nextPath));
    return nextPath;
  }

  _localDccHost() {
    if (this.config.dccPublicHost) return this.config.dccPublicHost;
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (entry.family === 'IPv4' && !entry.internal) return entry.address;
      }
    }
    return this.config.host;
  }

  _receiveDccFile(transfer) {
    const outputPath = this._uniquePath(path.join(this.config.downloadDir, this._safeFileName(transfer.fileName)));
    fs.mkdirSync(this.config.downloadDir, { recursive: true });
    this._broadcast('dcc-start', { target: transfer.target, direction: 'incoming', from: transfer.from, fileName: path.basename(outputPath), size: transfer.size, image: this._isImageFile(outputPath) });

    const incoming = net.connect({ host: transfer.host, port: transfer.port });
    const file = fs.createWriteStream(outputPath);
    let received = 0;
    let completed = false;
    let failed = false;

    const finishReceive = () => {
      if (completed) return;
      completed = true;
      file.end();
    };

    const emitComplete = () => {
      if (failed) return;
      const image = this._isImageFile(outputPath);
      this._broadcast('dcc-complete', {
        target: transfer.target,
        direction: 'incoming',
        from: transfer.from,
        fileName: path.basename(outputPath),
        filePath: outputPath,
        url: pathToFileURL(outputPath).toString(),
        size: received,
        image
      });
    };

    incoming.on('data', (chunk) => {
      received += chunk.length;
      file.write(chunk);
      const ack = Buffer.alloc(4);
      ack.writeUInt32BE(received >>> 0);
      incoming.write(ack);
      this._broadcast('dcc-progress', { target: transfer.target, direction: 'incoming', fileName: path.basename(outputPath), received, size: transfer.size });
    });

    incoming.on('end', finishReceive);
    incoming.on('close', finishReceive);
    incoming.on('error', (error) => {
      failed = true;
      this._broadcast('dcc-error', { target: transfer.target, direction: 'incoming', fileName: transfer.fileName, text: error.message });
      finishReceive();
    });
    file.on('finish', emitComplete);
    file.on('error', (error) => {
      failed = true;
      this._broadcast('dcc-error', { target: transfer.target, direction: 'incoming', fileName: transfer.fileName, text: error.message });
    });
  }

  async sendDccBuffer({ target, buffer, fileName, mimeType }) {
    if (!this.registered) {
      this._broadcast('system', { target: target || this.config.channel, text: 'Connect before sending an image.' });
      return { ok: false };
    }

    const conversation = target || this.config.channel;
    const recipients = conversation.startsWith('#') ? this._channelRecipients() : [conversation];
    if (!recipients.length) {
      this._broadcast('system', { target: conversation, text: 'No DCC recipients are available.' });
    }

    fs.mkdirSync(this.config.sentDir, { recursive: true });
    const cleanName = this._safeFileName(fileName || `pasted-${Date.now()}.png`);
    const savedPath = this._uniquePath(path.join(this.config.sentDir, cleanName));
    fs.writeFileSync(savedPath, buffer);

    for (const recipient of recipients) {
      await this._announceDccSend({ recipient, buffer, fileName: path.basename(savedPath), sourceTarget: conversation.startsWith('#') ? conversation : '' });
    }

    this._broadcast('dcc-complete', {
      target: conversation,
      direction: 'outgoing',
      from: this.currentNick,
      fileName: path.basename(savedPath),
      filePath: savedPath,
      url: pathToFileURL(savedPath).toString(),
      size: buffer.length,
      image: this._isImageFile(savedPath) || String(mimeType || '').startsWith('image/')
    });

    return { ok: true, recipients: recipients.length };
  }

  _announceDccSend({ recipient, buffer, fileName, sourceTarget = '' }) {
    return new Promise((resolve, reject) => {
      const server = net.createServer((peer) => {
        peer.on('error', (error) => this.log('error', 'DCC peer socket error', { recipient, fileName, message: error.message }));
        peer.on('close', () => server.close());
        peer.on('data', () => {});
        peer.write(buffer, () => {
          this._broadcast('dcc-progress', { target: recipient, direction: 'outgoing', fileName, received: buffer.length, size: buffer.length });
          peer.end();
        });
      });

      server.once('error', reject);
      server.listen(0, () => {
        const timeout = setTimeout(() => server.close(), 120000);
        server.on('close', () => clearTimeout(timeout));
        const host = this._localDccHost();
        const port = server.address().port;
        const quotedName = fileName.includes(' ') ? `"${fileName}"` : fileName;
        const context = sourceTarget ? ` SUBJECTIVE_TARGET ${encodeURIComponent(sourceTarget)}` : '';
        this.writeIrc(`PRIVMSG ${recipient} :\x01DCC SEND ${quotedName} ${this._encodeDccAddress(host)} ${port} ${buffer.length}${context}\x01`);
        resolve();
      });
    });
  }

  // --- slash commands -----------------------------------------------------------

  executeSlashCommand(commandLine, defaultTarget = this.config.channel) {
    const raw = String(commandLine || '').trim();
    if (!raw) return { ok: false };

    const command = raw.startsWith('/') ? raw.slice(1) : raw;
    const spaceIndex = command.indexOf(' ');
    const name = (spaceIndex === -1 ? command : command.slice(0, spaceIndex)).toLowerCase();
    const argsText = spaceIndex === -1 ? '' : command.slice(spaceIndex + 1).trim();
    const fallbackTarget = defaultTarget || this.config.channel;

    switch (name) {
      case 'server': {
        const next = this.parseServerConnection(argsText);
        if (!next) return { ok: false };
        this.applyConnectionAndReconnect(next, true);
        return { ok: true, focusTarget: next.channel };
      }
      case 'nick': {
        const nextNick = argsText.split(/\s+/)[0]?.trim();
        if (!nextNick) return { ok: false };
        if (!this.writeIrc(`NICK ${nextNick}`)) return { ok: false };
        this.config.nick = nextNick;
        this.currentNick = nextNick;
        this.saveSettings();
        this.emitConfig();
        this._broadcast('system', { target: this.config.channel, text: `Nickname changed to ${nextNick}` });
        return { ok: true };
      }
      case 'join': {
        const nextChannel = argsText.split(/\s+/)[0]?.trim();
        if (!nextChannel) return { ok: false };
        const channelName = nextChannel.startsWith('#') ? nextChannel : `#${nextChannel}`;
        this.config.channel = channelName;
        this.saveSettings();
        this.emitConfig();
        this.channelUsers = new Map();
        this._updateUsers();
        if (this.writeIrc(`JOIN ${channelName}`)) {
          this.writeIrc(`NAMES ${channelName}`);
          this._broadcast('system', { target: channelName, text: `Joining ${channelName}` });
          return { ok: true, focusTarget: channelName };
        }
        return { ok: false };
      }
      case 'part': {
        const nextToken = argsText.split(/\s+/)[0]?.trim() || '';
        const target = nextToken.startsWith('#') ? nextToken : fallbackTarget;
        const reason = nextToken.startsWith('#') ? argsText.slice(nextToken.length).trim() : argsText.trim();
        if (!target) return { ok: false };
        this.channelUsers = new Map();
        this._updateUsers();
        if (!this.writeIrc(reason ? `PART ${target} :${reason}` : `PART ${target}`)) return { ok: false };
        this._broadcast('system', { target, text: `Parted ${target}` });
        return { ok: true };
      }
      case 'msg': {
        const target = argsText.split(/\s+/)[0]?.trim();
        const text = argsText.slice(target ? target.length : 0).trim();
        if (!target || !text) return { ok: false };
        if (!this.writeIrc(`PRIVMSG ${target} :${text}`)) return { ok: false };
        this._broadcast('message', { target, from: this.currentNick, text, mine: true, time: Date.now(), private: !target.startsWith('#') });
        return { ok: true, focusTarget: target };
      }
      case 'query': {
        const target = argsText.split(/\s+/)[0]?.trim();
        const text = argsText.slice(target ? target.length : 0).trim();
        if (!target) return { ok: false };
        if (text && !this.writeIrc(`PRIVMSG ${target} :${text}`)) return { ok: false };
        if (text) this._broadcast('message', { target, from: this.currentNick, text, mine: true, time: Date.now(), private: true });
        return { ok: true, focusTarget: target };
      }
      case 'me': {
        if (!argsText) return { ok: false };
        if (!this.sendAction(fallbackTarget, argsText)) return { ok: false };
        this._broadcast('message', { target: fallbackTarget, from: this.currentNick, text: `* ${this.currentNick} ${argsText}`, mine: true, time: Date.now(), private: !fallbackTarget.startsWith('#') });
        return { ok: true };
      }
      case 'notice': {
        const target = argsText.split(/\s+/)[0]?.trim();
        const text = argsText.slice(target ? target.length : 0).trim();
        if (!target || !text) return { ok: false };
        if (!this.writeIrc(`NOTICE ${target} :${text}`)) return { ok: false };
        this._broadcast('system', { target, text: `Notice to ${target}: ${text}` });
        return { ok: true, focusTarget: target };
      }
      case 'topic': {
        const target = fallbackTarget;
        if (!argsText) return { ok: false };
        if (!this.writeIrc(`TOPIC ${target} :${argsText}`)) return { ok: false };
        this._broadcast('system', { target, text: `Topic updated for ${target}` });
        return { ok: true };
      }
      case 'names': {
        const nextTarget = argsText.split(/\s+/)[0]?.trim() || '';
        const target = nextTarget.startsWith('#') ? nextTarget : fallbackTarget;
        if (!this.writeIrc(`NAMES ${target}`)) return { ok: false };
        return { ok: true, focusTarget: target };
      }
      case 'whois': {
        const target = argsText.split(/\s+/)[0]?.trim();
        if (!target) return { ok: false };
        if (!this.writeIrc(`WHOIS ${target}`)) return { ok: false };
        return { ok: true, focusTarget: target };
      }
      case 'away': {
        if (!this.writeIrc(argsText ? `AWAY :${argsText}` : 'AWAY')) return { ok: false };
        this._broadcast('system', { target: fallbackTarget, text: argsText ? `Set away: ${argsText}` : 'Away cleared' });
        return { ok: true };
      }
      case 'connect':
        this.reconnectNow();
        return { ok: true };
      case 'disconnect':
      case 'quit':
        this.disconnectIrc(true);
        return { ok: true };
      case 'raw':
        return this.writeIrc(argsText || command) ? { ok: true } : { ok: false };
      default:
        return this.writeIrc(command) ? { ok: true } : { ok: false };
    }
  }

  // --- LLM agent conversations ----------------------------------------------------

  activateLlmIrcChannel(conversation) {
    if (!conversation?.ircChannel) return { ok: false, error: 'Conversation has no IRC channel.' };
    this.activeLlmIrcChannels.set(conversation.ircChannel.toLowerCase(), conversation.target);
    if (this.connected) {
      this.writeIrc(`JOIN ${conversation.ircChannel}`);
      this.writeIrc(`NAMES ${conversation.ircChannel}`);
    }
    return { ok: true, channel: conversation.ircChannel, connected: this.connected };
  }

  llmErrorText(label, response) {
    const base = `${label} error (${response.status || 'error'}): ${response.error || 'Unknown error'}`;
    if (response.status !== 'timeout') return base;
    return `${base} ${label} has no memory of this attempt - your next message starts a brand-new session from scratch.`;
  }

  async answerLlmMessage(target, text, from = this.currentNick, mirrorToIrc = true) {
    const conversation = this.llmService.findConversation(target);
    if (!conversation) return { ok: false, status: 'not_found', error: 'Conversation was not found.' };
    const provider = conversation.provider || 'codex';
    const label = providerLabel(provider);
    this._broadcast('llm-busy', { target, busy: true });
    try {
      const response = await this.llmService.sendMessage(target, text, []);
      if (response.userMessage) this._broadcast('llm-message', { target, message: response.userMessage, provider, from });
      if (response.ok) {
        this._broadcast('llm-message', { target, message: response.assistantMessage, provider });
        this._broadcast('llm-conversation', { conversation: response.conversation });
        if (mirrorToIrc && conversation.ircChannel) this.sendIrcText(conversation.ircChannel, `${label}: ${response.assistantMessage.text}`);
      } else {
        const errorText = this.llmErrorText(label, response);
        this._broadcast('system', { target, text: errorText });
        if (mirrorToIrc && conversation.ircChannel) this.sendIrcText(conversation.ircChannel, errorText);
      }
      return response;
    } finally {
      this._broadcast('llm-busy', { target, busy: false });
    }
  }

  async sendLlmMessage(target, text, files = []) {
    const conversation = this.llmService.findConversation(target);
    if (conversation?.ircChannel) this.sendIrcText(conversation.ircChannel, text);
    if (files?.length) {
      const provider = conversation?.provider || 'codex';
      const label = providerLabel(provider);
      this._broadcast('llm-busy', { target, busy: true });
      try {
        const response = await this.llmService.sendMessage(target, text, files);
        if (response.userMessage) this._broadcast('llm-message', { target, message: response.userMessage, provider, from: this.currentNick });
        if (response.ok) {
          this._broadcast('llm-message', { target, message: response.assistantMessage, provider });
          this._broadcast('llm-conversation', { conversation: response.conversation });
          if (conversation?.ircChannel) this.sendIrcText(conversation.ircChannel, `${label}: ${response.assistantMessage.text}`);
        } else {
          this._broadcast('system', { target, text: this.llmErrorText(label, response) });
        }
        return response;
      } finally {
        this._broadcast('llm-busy', { target, busy: false });
      }
    }
    try {
      return await this.answerLlmMessage(target, text, this.currentNick, true);
    } catch (error) {
      this.log('error', 'LLM message crashed', { target, message: error.message, stack: error.stack });
      return { ok: false, status: 'error', error: error.message };
    }
  }

  // --- "Continue as..." su sessions -------------------------------------------------

  switchConversationOwner(target, username) {
    try {
      const sibling = this.llmService.createSiblingForUser(target, username);
      this.activateLlmIrcChannel(sibling);
      this._broadcast('llm-conversation', { conversation: sibling });
      this._broadcast('llm-switch-user', { sourceTarget: target, target: sibling.target, osUser: username });
      return { conversation: sibling };
    } catch (error) {
      this.log('error', 'Failed to create sibling conversation for OS user', { username, message: error.message });
      this._broadcast('system', { target, text: `Could not continue as ${username}: ${error.message}` });
      return { error: error.message };
    }
  }

  continueConversationAsUser(target, username) {
    if (!this.llmService.findConversation(target)) return { ok: false, error: 'Conversation was not found.' };
    if (!isValidUsername(username)) return { ok: false, error: 'Invalid username.' };

    const existing = this.suSessionManager.getStatus(username);
    if (existing.status === 'ready') {
      return { ok: true, ...this.switchConversationOwner(target, username) };
    }

    // No native terminal window here (this is what main.js's terminalWindow.js is for) -
    // tell every connected frontend a login is needed so a browser tab can show its own
    // in-page terminal panel, wired to the same live pty via switchuser-pty-data events
    // (see webServer.js attaching a viewer below).
    this._broadcast('switchuser-terminal-needed', { username });
    this.suSessionManager.ensureSession(username)
      .then(() => this.switchConversationOwner(target, username))
      .catch((error) => {
        this.log('error', 'Failed to connect as OS user', { username, message: error.message });
      });
    return { ok: true, status: existing.status || 'connecting' };
  }

  // Wires a "Continue as..." pty session's output into the same broadcast channel as
  // every other event, tagged by username, so any connected frontend (a browser tab, in
  // this case - the desktop app uses its own native terminal window instead, see
  // terminalWindow.js) can render it without a dedicated per-window IPC channel. Safe to
  // call more than once for the same username: attachViewer/detachViewer key off this
  // exact function reference, and repeated calls are cheap deduped no-ops via the Set.
  attachSuViewerBroadcast(username) {
    if (!this._suViewerBroadcasts) this._suViewerBroadcasts = new Map();
    if (this._suViewerBroadcasts.has(username)) return;
    const viewer = (chunk) => this._broadcast('switchuser-pty-data', { username, chunk });
    this._suViewerBroadcasts.set(username, viewer);
    this.suSessionManager.attachViewer(username, viewer);
  }

  detachSuViewerBroadcast(username) {
    const viewer = this._suViewerBroadcasts?.get(username);
    if (!viewer) return;
    this.suSessionManager.detachViewer(username, viewer);
    this._suViewerBroadcasts.delete(username);
  }

  // Plain-data equivalent of main.js's native Menu.buildFromTemplate() context menu - a
  // browser has no native menu API, so this returns a description of the same items for
  // the web frontend to render as an HTML dropdown.
  async buildContextMenuModel(target) {
    const conversation = this.llmService.findConversation(target);
    if (!conversation || conversation.kind !== 'llm') {
      return { renamable: false, continueAs: null };
    }
    if (!conversation.writable) {
      return { renamable: true, continueAs: null };
    }

    const usersResult = await listSystemUsers();
    const users = usersResult.ok ? usersResult.users : [];
    const statuses = new Map(this.suSessionManager.listStatuses().map((entry) => [entry.username, entry]));

    const candidates = users.map((user) => ({
      username: user.username,
      status: statuses.get(user.username)?.status || 'idle'
    }));
    const activeSessions = [...statuses.values()]
      .filter((entry) => entry.status !== 'idle' && entry.status !== 'disconnected')
      .map((entry) => ({ username: entry.username, status: entry.status }));

    return { renamable: true, continueAs: { candidates, activeSessions } };
  }
}

module.exports = { ChatCore };
