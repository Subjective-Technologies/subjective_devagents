const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const os = require('os');
const dotenv = require('dotenv');
const { pathToFileURL } = require('url');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const defaultConnection = {
  name: 'Subjective LAN',
  host: '192.168.0.250',
  port: 6667,
  tls: false,
  channel: '#subjective',
  nick: 'Tomasso',
  realname: 'Tomasso'
};

const config = {
  host: process.env.IRC_HOST || defaultConnection.host,
  port: Number(process.env.IRC_PORT || 6667),
  tls: String(process.env.IRC_TLS || 'false').toLowerCase() === 'true',
  channel: process.env.IRC_CHANNEL || '#subjective',
  nick: process.env.IRC_NICK || 'Tomasso',
  realname: process.env.IRC_REALNAME || process.env.IRC_NICK || 'Tomasso',
  dccPublicHost: process.env.DCC_PUBLIC_HOST || '',
  downloadDir: process.env.DCC_DOWNLOAD_DIR ? path.resolve(__dirname, '..', process.env.DCC_DOWNLOAD_DIR) : path.join(os.homedir(), 'Downloads'),
  sentDir: path.resolve(__dirname, '..', 'sent')
};

let bookmarks = [];

const logDir = path.join(__dirname, '..', 'logs');
const mainLogPath = path.join(logDir, 'main.log');

let mainWindow;
let tray;
let isQuitting = false;
let manualDisconnect = false;
let socket;
let connected = false;
let registered = false;
let reconnectTimer;
let reconnectAttempt = 0;
let lineBuffer = '';
let currentNick = config.nick;
let channelUsers = new Map();
let namesBuffer = [];
let quitTimer;
let namesRefreshTimer;
let nickRetryTimer;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

app.setName('Subjective Chat');
if (process.platform === 'linux') app.setDesktopName('subjective-chat.desktop');
app.on('second-instance', showMainWindow);

function log(level, message, details = {}) {
  const entry = { time: new Date().toISOString(), level, message, details };
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(mainLogPath, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error('Failed to write app log', error);
  }
  if (level === 'error') console.error(message, details);
  else console.log(message, details);
}

process.on('uncaughtException', (error) => log('error', 'Uncaught exception', { stack: error.stack, message: error.message }));
process.on('unhandledRejection', (reason) => log('error', 'Unhandled rejection', { reason: String(reason), stack: reason && reason.stack }));

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function publicConfig() {
  return {
    host: config.host,
    port: config.port,
    tls: config.tls,
    channel: config.channel,
    nick: config.nick,
    realname: config.realname,
    downloadDir: config.downloadDir,
    bookmarks
  };
}

function normalizeConnection(input = {}, fallback = defaultConnection) {
  const host = String(input.host || fallback.host || defaultConnection.host).trim();
  const port = Number(input.port || fallback.port || defaultConnection.port);
  const channel = String(input.channel || fallback.channel || defaultConnection.channel).trim();
  const nick = String(input.nick || fallback.nick || defaultConnection.nick).trim();
  const realname = String(input.realname || fallback.realname || nick || defaultConnection.realname).trim();
  return {
    name: String(input.name || `${host}:${Number.isFinite(port) ? port : defaultConnection.port}`).trim(),
    host,
    port: Number.isFinite(port) && port > 0 ? port : defaultConnection.port,
    tls: Boolean(input.tls),
    channel: channel.startsWith('#') ? channel : `#${channel || defaultConnection.channel.replace(/^#/, '')}`,
    nick,
    realname
  };
}

function activeConnection() {
  return normalizeConnection(config);
}

function applyConnection(connection) {
  const next = normalizeConnection(connection, activeConnection());
  config.host = next.host;
  config.port = next.port;
  config.tls = next.tls;
  config.channel = next.channel;
  config.nick = next.nick;
  config.realname = next.realname;
  currentNick = next.nick;
}

function ensureBookmark(connection) {
  const next = normalizeConnection(connection);
  const key = (item) => `${item.host}:${item.port}:${item.channel}:${item.nick}`.toLowerCase();
  bookmarks = [next, ...bookmarks.filter((item) => key(item) !== key(next))].slice(0, 24);
}

function loadSettings() {
  const fallbackBookmark = normalizeConnection({ ...defaultConnection, ...activeConnection() });
  bookmarks = [fallbackBookmark];
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const saved = JSON.parse(raw);
    if (saved.active) applyConnection(saved.active);
    if (Array.isArray(saved.bookmarks) && saved.bookmarks.length) bookmarks = saved.bookmarks.map((item) => normalizeConnection(item));
    ensureBookmark(activeConnection());
  } catch (error) {
    ensureBookmark(activeConnection());
  }
}

function saveSettings() {
  const payload = { active: activeConnection(), bookmarks };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), `${JSON.stringify(payload, null, 2)}\n`);
}

function emitConfig() {
  emit('config', publicConfig());
}

function applyConnectionAndReconnect(connection, shouldSaveBookmark = true) {
  applyConnection(connection);
  if (shouldSaveBookmark) ensureBookmark(activeConnection());
  saveSettings();
  emitConfig();
  emit('system', { target: config.channel, text: `Connection set to ${config.host}:${config.port} ${config.channel}` });
  manualDisconnect = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (socket) {
    emit('status', { state: 'reconnecting', text: 'Applying connection settings...' });
    socket.once('close', () => setTimeout(connectIrc, 400));
    disconnectIrc(false);
  } else {
    connectIrc();
  }
}

function isTlsToken(value) {
  return /^(1|true|yes|on|tls|ssl)$/i.test(String(value || '').trim());
}

function parseServerConnection(argsText) {
  const tokens = String(argsText || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  let useTls = config.tls;
  const tlsIndex = tokens.findIndex(isTlsToken);
  if (tlsIndex !== -1) {
    useTls = isTlsToken(tokens[tlsIndex]);
    tokens.splice(tlsIndex, 1);
  }

  const host = tokens.shift();
  if (!host) return null;

  let port = config.port;
  if (tokens[0] && /^\d+$/.test(tokens[0])) {
    port = Number(tokens.shift());
  }

  let channel = config.channel;
  if (tokens[0] && tokens[0].startsWith('#')) {
    channel = tokens.shift();
  }

  let nick = config.nick;
  if (tokens[0] && !/^\d+$/.test(tokens[0]) && !tokens[0].startsWith('#')) {
    nick = tokens.shift();
  }

  const realname = tokens.length ? tokens.join(' ') : nick;
  return normalizeConnection({
    ...activeConnection(),
    host,
    port,
    channel,
    nick,
    realname,
    tls: useTls
  });
}

function sendAction(target, text) {
  return writeIrc(`PRIVMSG ${target} :\x01ACTION ${text}\x01`);
}

function executeSlashCommand(commandLine, defaultTarget = config.channel) {
  const raw = String(commandLine || '').trim();
  if (!raw) return { ok: false };

  const command = raw.startsWith('/') ? raw.slice(1) : raw;
  const spaceIndex = command.indexOf(' ');
  const name = (spaceIndex === -1 ? command : command.slice(0, spaceIndex)).toLowerCase();
  const argsText = spaceIndex === -1 ? '' : command.slice(spaceIndex + 1).trim();
  const fallbackTarget = defaultTarget || config.channel;

  switch (name) {
    case 'server': {
      const next = parseServerConnection(argsText);
      if (!next) return { ok: false };
      applyConnectionAndReconnect(next, true);
      return { ok: true, focusTarget: next.channel };
    }
    case 'nick': {
      const nextNick = argsText.split(/\s+/)[0]?.trim();
      if (!nextNick) return { ok: false };
      if (!writeIrc(`NICK ${nextNick}`)) return { ok: false };
      config.nick = nextNick;
      currentNick = nextNick;
      saveSettings();
      emitConfig();
      emit('system', { target: config.channel, text: `Nickname changed to ${nextNick}` });
      return { ok: true };
    }
    case 'join': {
      const nextChannel = argsText.split(/\s+/)[0]?.trim();
      if (!nextChannel) return { ok: false };
      const channelName = nextChannel.startsWith('#') ? nextChannel : `#${nextChannel}`;
      config.channel = channelName;
      saveSettings();
      emitConfig();
      channelUsers = new Map();
      updateUsers();
      if (writeIrc(`JOIN ${channelName}`)) {
        writeIrc(`NAMES ${channelName}`);
        emit('system', { target: channelName, text: `Joining ${channelName}` });
        return { ok: true, focusTarget: channelName };
      }
      return { ok: false };
    }
    case 'part': {
      const nextToken = argsText.split(/\s+/)[0]?.trim() || '';
      const target = nextToken.startsWith('#') ? nextToken : fallbackTarget;
      const reason = nextToken.startsWith('#') ? argsText.slice(nextToken.length).trim() : argsText.trim();
      if (!target) return { ok: false };
      channelUsers = new Map();
      updateUsers();
      if (!writeIrc(reason ? `PART ${target} :${reason}` : `PART ${target}`)) return { ok: false };
      emit('system', { target, text: `Parted ${target}` });
      return { ok: true };
    }
    case 'msg': {
      const target = argsText.split(/\s+/)[0]?.trim();
      const text = argsText.slice(target ? target.length : 0).trim();
      if (!target || !text) return { ok: false };
      if (!writeIrc(`PRIVMSG ${target} :${text}`)) return { ok: false };
      emit('message', { target, from: currentNick, text, mine: true, time: Date.now(), private: !target.startsWith('#') });
      return { ok: true, focusTarget: target };
    }
    case 'query': {
      const target = argsText.split(/\s+/)[0]?.trim();
      const text = argsText.slice(target ? target.length : 0).trim();
      if (!target) return { ok: false };
      if (text && !writeIrc(`PRIVMSG ${target} :${text}`)) return { ok: false };
      if (text) emit('message', { target, from: currentNick, text, mine: true, time: Date.now(), private: true });
      return { ok: true, focusTarget: target };
    }
    case 'me': {
      if (!argsText) return { ok: false };
      if (!sendAction(fallbackTarget, argsText)) return { ok: false };
      emit('message', { target: fallbackTarget, from: currentNick, text: `* ${currentNick} ${argsText}`, mine: true, time: Date.now(), private: !fallbackTarget.startsWith('#') });
      return { ok: true };
    }
    case 'notice': {
      const target = argsText.split(/\s+/)[0]?.trim();
      const text = argsText.slice(target ? target.length : 0).trim();
      if (!target || !text) return { ok: false };
      if (!writeIrc(`NOTICE ${target} :${text}`)) return { ok: false };
      emit('system', { target, text: `Notice to ${target}: ${text}` });
      return { ok: true, focusTarget: target };
    }
    case 'topic': {
      const target = fallbackTarget;
      if (!argsText) return { ok: false };
      if (!writeIrc(`TOPIC ${target} :${argsText}`)) return { ok: false };
      emit('system', { target, text: `Topic updated for ${target}` });
      return { ok: true };
    }
    case 'names': {
      const nextTarget = argsText.split(/\s+/)[0]?.trim() || '';
      const target = nextTarget.startsWith('#') ? nextTarget : fallbackTarget;
      if (!writeIrc(`NAMES ${target}`)) return { ok: false };
      return { ok: true, focusTarget: target };
    }
    case 'whois': {
      const target = argsText.split(/\s+/)[0]?.trim();
      if (!target) return { ok: false };
      if (!writeIrc(`WHOIS ${target}`)) return { ok: false };
      return { ok: true, focusTarget: target };
    }
    case 'away': {
      if (!writeIrc(argsText ? `AWAY :${argsText}` : 'AWAY')) return { ok: false };
      emit('system', { target: fallbackTarget, text: argsText ? `Set away: ${argsText}` : 'Away cleared' });
      return { ok: true };
    }
    case 'connect':
      reconnectNow();
      return { ok: true };
    case 'disconnect':
      disconnectIrc(true);
      return { ok: true };
    case 'quit':
      disconnectIrc(true);
      return { ok: true };
    case 'raw':
      return writeIrc(argsText || command) ? { ok: true } : { ok: false };
    default: {
      const line = command;
      return writeIrc(line) ? { ok: true } : { ok: false };
    }
  }
}

function createWindow() {
  const icon = trayIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0b0d12',
    title: 'Subjective Chat',
    icon: icon?.path,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('show', refreshTray);
  mainWindow.on('hide', refreshTray);
  mainWindow.on('closed', () => {
    mainWindow = null;
    refreshTray();
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => log('error', 'Renderer process gone', details));
  mainWindow.webContents.on('unresponsive', () => log('error', 'Renderer became unresponsive'));
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const details = typeof level === 'object' ? level : { level, message, line, sourceId };
    log(details.level >= 2 ? 'error' : 'info', 'Renderer console message', details);
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  log('info', 'Window created');
}

function createTray() {
  if (isQuitting) return;
  if (tray && !tray.isDestroyed()) return;
  const icon = trayIcon();
  if (!icon) {
    log('error', 'Tray icon was not created because no icon asset could be loaded');
    return;
  }

  tray = new Tray(icon.image);
  tray.setToolTip(`Subjective Chat - ${config.channel}`);
  tray.setContextMenu(trayMenu());
  tray.on('click', toggleMainWindow);
  tray.on('double-click', showMainWindow);
  log('info', 'Tray created', { iconPath: icon.path, size: icon.image.getSize() });
}

function trayIcon() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const candidates = [
    'subjective-tray-32.png',
    'subjective-tray-64.png',
    'subjective-tray.svg',
    'sirc-tray.svg',
    'subjective-logo.svg'
  ];

  for (const fileName of candidates) {
    const iconPath = path.join(assetsDir, fileName);
    if (!fs.existsSync(iconPath)) continue;
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      log('error', 'Tray icon asset loaded as an empty image', { iconPath });
      continue;
    }
    return { path: iconPath, image };
  }

  return null;
}

function trayMenu() {
  const windowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  return Menu.buildFromTemplate([
    { label: windowVisible ? 'Hide Subjective Chat' : 'Show Subjective Chat', click: windowVisible ? hideMainWindow : showMainWindow },
    { label: connected ? 'Connected' : 'Disconnected', enabled: false },
    { type: 'separator' },
    { label: 'Reconnect', click: reconnectNow },
    { label: 'Disconnect', click: () => disconnectIrc(true) },
    { type: 'separator' },
    { label: 'Close Application', click: quitApp }
  ]);
}

function refreshTray() {
  if (isQuitting) return;
  if (!tray || tray.isDestroyed()) {
    tray = null;
    createTray();
    return;
  }
  try {
    tray.setToolTip(`Subjective Chat - ${connected ? 'connected' : 'disconnected'} - ${config.channel}`);
    tray.setContextMenu(trayMenu());
  } catch (error) {
    log('error', 'Failed to refresh tray', { message: error.message });
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
}

function toggleMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    hideMainWindow();
    return;
  }
  showMainWindow();
}

function quitApp() {
  if (isQuitting) return;
  isQuitting = true;
  log('info', 'Quit requested');
  shutdownIrcThenQuit();
}

function emit(type, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:event', { type, ...payload });
}

function writeIrc(command) {
  if (!socket || !connected) {
    log('error', 'Attempted IRC write while disconnected', { command });
    return false;
  }
  socket.write(`${command}\r\n`);
  return true;
}

function reconnectNow() {
  manualDisconnect = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (socket) {
    emit('status', { state: 'reconnecting', text: 'Reconnecting...' });
    socket.once('close', () => setTimeout(connectIrc, 1500));
    disconnectIrc(false);
    return;
  }
  connectIrc();
}

function scheduleReconnect() {
  if (isQuitting || manualDisconnect || reconnectTimer) return;
  reconnectAttempt += 1;
  const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
  log('info', 'Scheduling IRC reconnect', { delay, reconnectAttempt });
  emit('status', { state: 'reconnecting', text: `Reconnecting in ${Math.round(delay / 1000)}s` });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectIrc();
  }, delay);
}

function connectIrc() {
  if (connected || socket) {
    log('info', 'Connect ignored because socket already exists', { connected });
    return;
  }

  manualDisconnect = false;
  registered = false;
  clearTimeout(nickRetryTimer);
  nickRetryTimer = null;
  fs.mkdirSync(config.downloadDir, { recursive: true });
  fs.mkdirSync(config.sentDir, { recursive: true });
  lineBuffer = '';
  namesBuffer = [];
  channelUsers = new Map();
  currentNick = config.nick;

  const options = { host: config.host, port: config.port, rejectUnauthorized: false };
  log('info', 'Connecting to IRC', { host: config.host, port: config.port, tls: config.tls, channel: config.channel, nick: config.nick });
  socket = config.tls ? tls.connect(options) : net.connect(options);
  socket.setEncoding('utf8');

  socket.on('connect', () => {
    connected = true;
    reconnectAttempt = 0;
    log('info', 'IRC connected');
    emit('status', { state: 'connected', text: `Connected to ${config.host}:${config.port}` });
    refreshTray();
    writeIrc(`NICK ${config.nick}`);
    writeIrc(`USER ${config.nick} 0 * :${config.realname}`);
  });

  socket.on('data', (chunk) => {
    lineBuffer += chunk;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) handleIrcLine(line);
    }
  });

  socket.on('error', (error) => {
    log('error', 'IRC socket error', { message: error.message, stack: error.stack });
    emit('status', { state: 'error', text: error.message });
  });

  socket.on('close', () => {
    connected = false;
    registered = false;
    socket = null;
    clearTimeout(nickRetryTimer);
    nickRetryTimer = null;
    log('info', 'IRC disconnected', { manualDisconnect });
    emit('status', { state: 'disconnected', text: 'Disconnected' });
    refreshTray();
    updateUsers();
    scheduleReconnect();
  });
}

function disconnectIrc(userRequested = false) {
  if (userRequested) manualDisconnect = true;
  if (!socket) {
    log('info', 'Disconnect ignored because no socket exists');
    return;
  }
  log('info', 'Disconnecting IRC', { userRequested });
  if (connected) writeIrc('QUIT :Subjective Chat closed');
  socket.end();
}

function shutdownIrcThenQuit() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearTimeout(nickRetryTimer);
  nickRetryTimer = null;
  manualDisconnect = true;

  if (!socket) {
    app.quit();
    return;
  }

  socket.once('close', () => {
    clearTimeout(quitTimer);
    log('info', 'IRC socket closed before application quit');
    app.quit();
  });
  disconnectIrc(true);
  quitTimer = setTimeout(() => {
    log('error', 'Timed out waiting for IRC socket close before quit');
    if (socket) socket.destroy();
    app.quit();
  }, 3000);
}

function parseIrcLine(line) {
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

function nickFromPrefix(prefix) {
  return prefix.split('!')[0] || prefix;
}

function normalizeNick(rawNick) {
  return rawNick.replace(/^[~&@%+]+/, '');
}

function userRecord(rawNick) {
  const modes = rawNick.match(/^[~&@%+]+/)?.[0] || '';
  const nick = normalizeNick(rawNick);
  return { nick, modes, self: nick.toLowerCase() === currentNick.toLowerCase() };
}

function setChannelUser(rawNick) {
  const record = userRecord(rawNick);
  if (record.nick) channelUsers.set(record.nick.toLowerCase(), record);
}

function removeChannelUser(nick) {
  channelUsers.delete(nick.toLowerCase());
}

function renameChannelUser(oldNick, newNick) {
  const existing = channelUsers.get(oldNick.toLowerCase());
  if (existing) {
    channelUsers.delete(oldNick.toLowerCase());
    channelUsers.set(newNick.toLowerCase(), { ...existing, nick: newNick, self: existing.self || newNick === currentNick });
  }
}

function updateUsers() {
  const users = [...channelUsers.values()].sort((a, b) => a.nick.localeCompare(b.nick));
  log('info', 'User list updated', { count: users.length, users: users.map((user) => user.nick) });
  emit('users', { channel: config.channel, users });
}

function cleanChannelName(channel) {
  return String(channel || '').replace(/^:/, '');
}

function isConfiguredChannel(channel) {
  return cleanChannelName(channel).toLowerCase() === config.channel.toLowerCase();
}

function requestNamesSoon() {
  if (!registered || namesRefreshTimer) return;
  namesRefreshTimer = setTimeout(() => {
    namesRefreshTimer = null;
    if (registered && connected) {
      namesBuffer = [];
      writeIrc(`NAMES ${config.channel}`);
    }
  }, 750);
}

function retryConfiguredNickSoon() {
  if (nickRetryTimer || isQuitting) return;
  nickRetryTimer = setTimeout(() => {
    nickRetryTimer = null;
    if (!connected || registered) return;
    log('info', 'Retrying configured nickname', { nick: config.nick });
    emit('status', { state: 'reconnecting', text: `Waiting for ${config.nick} to disconnect...` });
    writeIrc(`NICK ${config.nick}`);
  }, 5000);
}

function conversationTarget(target, from) {
  if (target.toLowerCase() === currentNick.toLowerCase()) return from;
  if (target.toLowerCase() === config.channel.toLowerCase()) return config.channel;
  return target;
}

function channelRecipients() {
  return [...channelUsers.values()]
    .map((user) => user.nick)
    .filter((nick) => nick.toLowerCase() !== currentNick.toLowerCase());
}

function handleIrcLine(line) {
  const message = parseIrcLine(line);

  if (message.command === 'PING') {
    writeIrc(`PONG :${message.params[0] || ''}`);
    return;
  }

  if (message.command === '001') {
    registered = true;
    clearTimeout(nickRetryTimer);
    nickRetryTimer = null;
    log('info', 'IRC registration complete, joining channel', { channel: config.channel });
    writeIrc(`JOIN ${config.channel}`);
    writeIrc(`NAMES ${config.channel}`);
    emit('system', { target: config.channel, text: `Joined ${config.channel}` });
    return;
  }

  if (message.command === '353') {
    if (isConfiguredChannel(message.params[2])) {
      namesBuffer.push(...String(message.params[3] || '').split(/\s+/).filter(Boolean));
    }
    return;
  }

  if (message.command === '366') {
    if (!isConfiguredChannel(message.params[1])) return;
    channelUsers = new Map();
    for (const nick of namesBuffer) setChannelUser(nick);
    namesBuffer = [];
    updateUsers();
    return;
  }

  if (message.command === '433') {
    log('error', 'Configured nickname is already in use', { nick: config.nick });
    emit('status', { state: 'reconnecting', text: `${config.nick} is still disconnecting. Retrying...` });
    retryConfiguredNickSoon();
    return;
  }

  if (message.command === 'JOIN') {
    const nick = nickFromPrefix(message.prefix);
    if (!isConfiguredChannel(message.params[0])) return;
    log('info', 'IRC user joined channel', { nick, channel: cleanChannelName(message.params[0]) });
    setChannelUser(nick);
    updateUsers();
    requestNamesSoon();
    emit('join', { target: config.channel, nick, channel: cleanChannelName(message.params[0]) });
    return;
  }

  if (message.command === 'PART') {
    const nick = nickFromPrefix(message.prefix);
    if (!isConfiguredChannel(message.params[0])) return;
    log('info', 'IRC user left channel', { nick, channel: cleanChannelName(message.params[0]) });
    removeChannelUser(nick);
    updateUsers();
    requestNamesSoon();
    emit('part', { target: config.channel, nick, text: message.params.at(-1) || '' });
    return;
  }

  if (message.command === 'QUIT') {
    const nick = nickFromPrefix(message.prefix);
    log('info', 'IRC user quit', { nick });
    removeChannelUser(nick);
    updateUsers();
    requestNamesSoon();
    emit('part', { target: config.channel, nick, text: message.params.at(-1) || '' });
    return;
  }

  if (message.command === 'NICK') {
    const oldNick = nickFromPrefix(message.prefix);
    const newNick = message.params[0];
    if (oldNick.toLowerCase() === currentNick.toLowerCase()) currentNick = newNick;
    log('info', 'IRC user changed nick', { oldNick, newNick });
    renameChannelUser(oldNick, newNick);
    updateUsers();
    requestNamesSoon();
    emit('system', { target: config.channel, text: `${oldNick} is now ${newNick}` });
    return;
  }

  if (message.command === 'PRIVMSG') {
    const from = nickFromPrefix(message.prefix);
    const target = message.params[0];
    const text = message.params[1] || '';

    if (text.startsWith('\x01') && text.endsWith('\x01')) {
      handleCtcp(from, target, text.slice(1, -1));
      return;
    }

    const conversation = conversationTarget(target, from);
    emit('message', { target: conversation, from, text, mine: from.toLowerCase() === currentNick.toLowerCase(), time: Date.now(), private: conversation === from });
    return;
  }

  if (/^\d+$/.test(message.command)) return;
  emit('raw', { text: line });
}

function handleCtcp(from, target, body) {
  if (body === 'VERSION') {
    writeIrc(`NOTICE ${from} :\x01VERSION Subjective Chat Electron IRC client\x01`);
    return;
  }
  if (!body.startsWith('DCC ')) return;
  const parts = splitDcc(body);
  if (parts[1] !== 'SEND' || parts.length < 5) return;

  const fileName = path.basename(parts[2]);
  const host = decodeDccAddress(parts[3]);
  const port = Number(parts[4]);
  const size = Number(parts[5] || 0);
  if (!fileName || !host || !port) return;

  const hintedTarget = dccContextTarget(parts);
  const conversation = hintedTarget || conversationTarget(target, from);
  log('info', 'Auto-accepting DCC file', { from, target: conversation, fileName, host, port, size });
  receiveDccFile({ from, target: conversation, fileName, host, port, size });
}

function splitDcc(body) {
  const matches = body.match(/"[^"]+"|\S+/g) || [];
  return matches.map((part) => part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part);
}

function decodeDccAddress(value) {
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  return value;
}

function encodeDccAddress(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return host;
  return String(((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]);
}

function dccContextTarget(parts) {
  const index = parts.indexOf('SUBJECTIVE_TARGET');
  if (index === -1 || !parts[index + 1]) return '';
  try {
    return decodeURIComponent(parts[index + 1]);
  } catch (_error) {
    return parts[index + 1];
  }
}

function isImageFile(fileName) {
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
    log('error', 'Image type detection failed', { fileName, message: error.message });
  }
  return false;
}

function safeFileName(fileName) {
  return path.basename(fileName).replace(/[^\w .()[\]-]/g, '_');
}

function uniquePath(filePath) {
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

function localDccHost() {
  if (config.dccPublicHost) return config.dccPublicHost;
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return config.host;
}

function receiveDccFile(transfer) {
  const outputPath = uniquePath(path.join(config.downloadDir, safeFileName(transfer.fileName)));
  fs.mkdirSync(config.downloadDir, { recursive: true });
  emit('dcc-start', { target: transfer.target, direction: 'incoming', from: transfer.from, fileName: path.basename(outputPath), size: transfer.size, image: isImageFile(outputPath) });

  const incoming = net.connect({ host: transfer.host, port: transfer.port });
  const file = fs.createWriteStream(outputPath);
  let received = 0;
  let completed = false;
  let failed = false;

  function finishReceive() {
    if (completed) return;
    completed = true;
    file.end();
  }

  function emitComplete() {
    if (failed) return;
    const image = isImageFile(outputPath);
    log('info', 'DCC file received', { from: transfer.from, target: transfer.target, fileName: path.basename(outputPath), outputPath, size: received, image });
    emit('dcc-complete', {
      target: transfer.target,
      direction: 'incoming',
      from: transfer.from,
      fileName: path.basename(outputPath),
      filePath: outputPath,
      url: pathToFileURL(outputPath).toString(),
      size: received,
      image
    });
  }

  incoming.on('data', (chunk) => {
    received += chunk.length;
    file.write(chunk);
    const ack = Buffer.alloc(4);
    ack.writeUInt32BE(received >>> 0);
    incoming.write(ack);
    emit('dcc-progress', { target: transfer.target, direction: 'incoming', fileName: path.basename(outputPath), received, size: transfer.size });
  });

  incoming.on('end', finishReceive);
  incoming.on('close', finishReceive);
  incoming.on('error', (error) => {
    failed = true;
    log('error', 'DCC receive failed', { from: transfer.from, fileName: transfer.fileName, host: transfer.host, port: transfer.port, message: error.message });
    emit('dcc-error', { target: transfer.target, direction: 'incoming', fileName: transfer.fileName, text: error.message });
    finishReceive();
  });
  file.on('finish', emitComplete);
  file.on('error', (error) => {
    failed = true;
    log('error', 'DCC file write failed', { fileName: transfer.fileName, outputPath, message: error.message });
    emit('dcc-error', { target: transfer.target, direction: 'incoming', fileName: transfer.fileName, text: error.message });
  });
}

async function sendDccBuffer({ target, buffer, fileName, mimeType }) {
  if (!registered) {
    emit('system', { target: target || config.channel, text: 'Connect before sending an image.' });
    return { ok: false };
  }

  const conversation = target || config.channel;
  const recipients = conversation.startsWith('#') ? channelRecipients() : [conversation];
  if (!recipients.length) {
    emit('system', { target: conversation, text: 'No DCC recipients are available.' });
  }

  fs.mkdirSync(config.sentDir, { recursive: true });
  const cleanName = safeFileName(fileName || `pasted-${Date.now()}.png`);
  const savedPath = uniquePath(path.join(config.sentDir, cleanName));
  fs.writeFileSync(savedPath, buffer);

  for (const recipient of recipients) {
    await announceDccSend({ recipient, buffer, fileName: path.basename(savedPath), sourceTarget: conversation.startsWith('#') ? conversation : '' });
  }

  emit('dcc-complete', {
    target: conversation,
    direction: 'outgoing',
    from: currentNick,
    fileName: path.basename(savedPath),
    filePath: savedPath,
    url: pathToFileURL(savedPath).toString(),
    size: buffer.length,
    image: isImageFile(savedPath) || String(mimeType || '').startsWith('image/')
  });

  log('info', 'DCC image prepared', { target: conversation, recipients, fileName: path.basename(savedPath), size: buffer.length });
  return { ok: true, recipients: recipients.length };
}

function announceDccSend({ recipient, buffer, fileName, sourceTarget = '' }) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((peer) => {
      let sent = 0;
      peer.on('error', (error) => log('error', 'DCC peer socket error', { recipient, fileName, message: error.message }));
      peer.on('close', () => server.close());
      peer.on('data', () => {});
      peer.write(buffer, () => {
        sent = buffer.length;
        emit('dcc-progress', { target: recipient, direction: 'outgoing', fileName, received: sent, size: buffer.length });
        peer.end();
      });
    });

    server.once('error', reject);
    server.listen(0, () => {
      const timeout = setTimeout(() => {
        log('info', 'DCC send timed out waiting for recipient', { recipient, fileName });
        server.close();
      }, 120000);
      server.on('close', () => clearTimeout(timeout));
      const host = localDccHost();
      const port = server.address().port;
      const quotedName = fileName.includes(' ') ? `"${fileName}"` : fileName;
      const context = sourceTarget ? ` SUBJECTIVE_TARGET ${encodeURIComponent(sourceTarget)}` : '';
      writeIrc(`PRIVMSG ${recipient} :\x01DCC SEND ${quotedName} ${encodeDccAddress(host)} ${port} ${buffer.length}${context}\x01`);
      log('info', 'DCC send announced', { recipient, fileName, size: buffer.length, host, port });
      resolve();
    });
  });
}

async function chooseAndSendImage(target) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Send image with DCC',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  const filePath = result.filePaths[0];
  return sendDccBuffer({
    target,
    buffer: fs.readFileSync(filePath),
    fileName: path.basename(filePath),
    mimeType: ''
  });
}

app.whenReady().then(() => {
  log('info', 'App ready', { electron: process.versions.electron, node: process.versions.node });
  loadSettings();
  createWindow();
  createTray();

  ipcMain.handle('app:config', () => publicConfig());

  ipcMain.handle('app:save-config', (_event, payload) => {
    applyConnectionAndReconnect(payload?.active || payload || {}, payload?.saveBookmark !== false);
    return { ok: true, config: publicConfig() };
  });

  ipcMain.handle('irc:connect', () => {
    reconnectNow();
    return { ok: true };
  });

  ipcMain.handle('irc:disconnect', () => {
    disconnectIrc(true);
    return { ok: true };
  });

  ipcMain.handle('irc:send-message', (_event, payload) => {
    const target = payload?.target || config.channel;
    const clean = String(payload?.text || '').replace(/[\r\n]+/g, ' ').trim();
    if (!clean) return { ok: false };
    log('info', 'Sending IRC message', { target, length: clean.length });
    if (writeIrc(`PRIVMSG ${target} :${clean}`)) {
      emit('message', { target, from: currentNick, text: clean, mine: true, time: Date.now(), private: !target.startsWith('#') });
      return { ok: true };
    }
    return { ok: false };
  });

  ipcMain.handle('irc:execute-command', (_event, payload) => {
    const target = payload?.target || config.channel;
    const result = executeSlashCommand(payload?.command || '', target);
    return { ok: Boolean(result?.ok), focusTarget: result?.focusTarget || '' };
  });

  ipcMain.handle('dcc:send-image', (_event, payload) => chooseAndSendImage(payload?.target || config.channel));

  ipcMain.handle('dcc:send-image-data', (_event, payload) => {
    const buffer = Buffer.from(payload.bytes);
    return sendDccBuffer({
      target: payload.target || config.channel,
      buffer,
      fileName: payload.fileName || `pasted-${Date.now()}.png`,
      mimeType: payload.mimeType
    });
  });

  ipcMain.handle('file:open', (_event, filePath) => {
    if (filePath) shell.openPath(filePath);
    return { ok: true };
  });

  ipcMain.handle('app:log', (_event, payload) => {
    log(payload.level || 'info', payload.message || 'Renderer log', payload.details || {});
    return { ok: true };
  });

  mainWindow.webContents.once('did-finish-load', () => {
    emit('status', { state: 'idle', text: 'Ready' });
    connectIrc();
  });
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    if (process.platform !== 'darwin') app.quit();
  }
});

app.on('before-quit', (event) => {
  if (!isQuitting && socket) {
    event.preventDefault();
    isQuitting = true;
    shutdownIrcThenQuit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
