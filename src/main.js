const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const os = require('os');
const dotenv = require('dotenv');
const { fileURLToPath, pathToFileURL } = require('url');
const { LlmService, providerLabel } = require('./llmService');
const { listSystemUsers, isValidUsername } = require('./systemUsers');
const { SuSessionManager } = require('./suSessionManager');
const terminalWindow = require('./terminalWindow');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const applicationHome = process.env.SUBJECTIVE_CHAT_HOME || path.join(os.homedir(), '.subjective_chat');
app.setPath('userData', applicationHome);
const remoteDebuggingPort = Number(process.env.SUBJECTIVE_CHAT_REMOTE_DEBUGGING_PORT || 0);
if (Number.isInteger(remoteDebuggingPort) && remoteDebuggingPort > 0 && remoteDebuggingPort <= 65535) {
  app.commandLine.appendSwitch('remote-debugging-port', String(remoteDebuggingPort));
}

function logTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join('_');
}

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
  sentDir: path.join(applicationHome, 'sent')
};

let bookmarks = [];

const logDir = path.join(applicationHome, 'logs');
const mainLogPath = path.join(logDir, `${logTimestamp()}-subjective_chat-log.log`);

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
let llmService;
let suSessionManager;
const activeLlmIrcChannels = new Map();

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
    // 760, not 720: at exactly 720 the phone breakpoint kicks in and hides the
    // sidebar's chats panel, and this shell has no mobile drawer to reach it from.
    minWidth: 760,
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

function sendIrcText(target, text) {
  const clean = String(text || '').replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return false;
  const chunks = clean.match(/.{1,380}(?:\s+|$)|.{1,380}/g) || [clean];
  let sent = false;
  for (const chunk of chunks) sent = writeIrc(`PRIVMSG ${target} :${chunk.trim()}`) || sent;
  return sent;
}

function activateLlmIrcChannel(conversation) {
  if (!conversation?.ircChannel) return { ok: false, error: 'Conversation has no IRC channel.' };
  activeLlmIrcChannels.set(conversation.ircChannel.toLowerCase(), conversation.target);
  if (connected) {
    writeIrc(`JOIN ${conversation.ircChannel}`);
    writeIrc(`NAMES ${conversation.ircChannel}`);
  }
  return { ok: true, channel: conversation.ircChannel, connected };
}

// "Continue as <username>" entry point, called from the conversation context menu (see
// buildConversationContextMenu). If that user's background session is already ready,
// switches over immediately with no prompt. Otherwise opens the visible su/login
// terminal and lets ensureSession()'s state machine (see suSessionManager.js) drive it -
// this function returns as soon as that decision is made, it does not block on the whole
// (possibly minutes-long, human-interactive) connect flow.
function continueConversationAsUser(target, username) {
  const conversation = llmService.findConversation(target);
  if (!conversation) return { ok: false, error: 'Conversation was not found.' };
  if (!isValidUsername(username)) return { ok: false, error: 'Invalid username.' };
  const provider = conversation.provider;
  const loginProviders = new Set(['codex', 'claude', 'cursor']);

  const finish = () => switchConversationOwner(target, username);
  const connect = () => suSessionManager.ensureSession(username)
    .then(() => (loginProviders.has(provider)
      ? suSessionManager.ensureProviderLogin(username, provider)
      : null))
    .then(finish)
    .catch((error) => {
      log('error', 'Failed to connect as OS user', { username, provider, message: error.message });
    });

  if (suSessionManager.isProviderReady(username, provider)) {
    return { ok: true, ...finish() };
  }

  terminalWindow.openTerminalWindow(username, { parent: mainWindow, suSessionManager });
  connect();
  const existing = suSessionManager.getStatus(username);
  return { ok: true, status: existing.status || 'connecting' };
}

function switchConversationOwner(target, username) {
  try {
    const sibling = llmService.createSiblingForUser(target, username);
    activateLlmIrcChannel(sibling);
    emit('llm-conversation', { conversation: sibling });
    emit('llm-switch-user', { sourceTarget: target, target: sibling.target, osUser: username });
    return { conversation: sibling };
  } catch (error) {
    log('error', 'Failed to create sibling conversation for OS user', { username, message: error.message });
    emit('system', { target, text: `Could not continue as ${username}: ${error.message}` });
    return { error: error.message };
  }
}

async function buildConversationContextMenu(target) {
  const conversation = llmService.findConversation(target);
  if (!conversation || conversation.kind !== 'llm') {
    return Menu.buildFromTemplate([{ label: 'Rename…', enabled: false }]);
  }

  // Rename is available for every chat, including read-only history conversations.
  const items = [
    { label: 'Rename…', click: () => emit('conversation-rename-request', { target }) },
    { type: 'separator' }
  ];

  if (!conversation.writable) {
    items.push({ label: 'Continue as…', enabled: false });
    items.push({ type: 'separator' });
    items.push({ label: 'Delete chat…', click: () => emit('conversation-delete-request', { target }) });
    return Menu.buildFromTemplate(items);
  }

  const usersResult = await listSystemUsers();
  const users = usersResult.ok ? usersResult.users : [];
  const statuses = new Map(suSessionManager.listStatuses().map((entry) => [entry.username, entry]));

  const submenu = users.map((user) => {
    const status = statuses.get(user.username);
    const dot = status?.status === 'ready' ? '●' : status ? '◐' : '○';
    return { label: `${dot} ${user.username}`, click: () => continueConversationAsUser(target, user.username) };
  });
  if (!submenu.length) submenu.push({ label: 'No other Linux users found on this computer', enabled: false });

  const activeSessions = [...statuses.values()].filter((entry) => entry.status !== 'idle' && entry.status !== 'disconnected');
  if (activeSessions.length) {
    submenu.push({ type: 'separator' });
    for (const entry of activeSessions) {
      submenu.push({
        label: `Disconnect ${entry.username}`,
        click: () => {
          suSessionManager.disconnect(entry.username);
          terminalWindow.closeTerminalWindow(entry.username);
        }
      });
    }
  }

  items.push({ label: 'Continue as…', submenu });
  items.push({ type: 'separator' });
  items.push({ label: 'Delete chat…', click: () => emit('conversation-delete-request', { target }) });
  return Menu.buildFromTemplate(items);
}

// A timed-out turn leaves nothing behind to resume: the CLI only prints its session id
// once the whole turn finishes, so a kill mid-turn means the next message starts a
// brand-new session with zero memory of the attempt that timed out. Say that plainly at
// the moment it happens, so "did it finish?" later doesn't read as the agent forgetting
// work it actually completed - it never got the chance to.
function llmErrorText(label, response) {
  const base = `${label} error (${response.status || 'error'}): ${response.error || 'Unknown error'}`;
  if (response.status !== 'timeout') return base;
  return `${base} ${label} has no memory of this attempt - your next message starts a brand-new session from scratch.`;
}

async function answerLlmMessage(target, text, from = currentNick, mirrorToIrc = true) {
  const conversation = llmService.findConversation(target);
  if (!conversation) return { ok: false, status: 'not_found', error: 'Conversation was not found.' };
  const provider = conversation.provider || 'codex';
  const label = providerLabel(provider);
  emit('llm-busy', { target, busy: true });
  try {
    const response = await llmService.sendMessage(target, text, []);
    if (response.userMessage) {
      emit('llm-message', { target, message: response.userMessage, provider, from });
    }
    if (response.ok) {
      emit('llm-message', { target, message: response.assistantMessage, provider });
      emit('llm-conversation', { conversation: response.conversation });
      if (mirrorToIrc && conversation.ircChannel) sendIrcText(conversation.ircChannel, `${label}: ${response.assistantMessage.text}`);
    } else {
      const errorText = llmErrorText(label, response);
      emit('system', { target, text: errorText });
      if (llmService._isAuthFailure(response)) {
        emit('llm-choose-session', {
          target,
          provider,
          text,
          currentUser: response.sessions?.currentUser,
          sessions: response.sessions?.users || []
        });
      }
      if (mirrorToIrc && conversation.ircChannel) sendIrcText(conversation.ircChannel, errorText);
    }
    return response;
  } finally {
    emit('llm-busy', { target, busy: false });
  }
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
    for (const channel of activeLlmIrcChannels.keys()) writeIrc(`JOIN ${channel}`);
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

    const llmTarget = activeLlmIrcChannels.get(String(target).toLowerCase());
    if (llmTarget) {
      if (from.toLowerCase() !== currentNick.toLowerCase()) {
        answerLlmMessage(llmTarget, text, from, true).catch((error) => {
          log('error', 'Failed to answer IRC LLM channel message', { target: llmTarget, from, message: error.message });
        });
      }
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
  suSessionManager = new SuSessionManager();
  suSessionManager.on('status', (event) => {
    log('info', 'Switch-user session status changed', event);
    const payload = { type: 'status', ...event };
    const termWin = terminalWindow.getTerminalWindow(event.username);
    if (termWin) termWin.webContents.send('switchuser:event', payload);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('switchuser:event', payload);
  });
  suSessionManager.on('provider-status', (event) => {
    const payload = { type: 'status', ...event };
    const termWin = terminalWindow.getTerminalWindow(event.username);
    if (termWin) termWin.webContents.send('switchuser:event', payload);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('switchuser:event', { type: 'provider-status', ...event });
  });
  llmService = new LlmService({
    root: path.resolve(__dirname, '..'),
    appHome: applicationHome,
    suSessionManager,
    log
  });
  for (const conversation of llmService.listConversations().filter((item) => item.activeOnIrc)) {
    activeLlmIrcChannels.set(conversation.ircChannel.toLowerCase(), conversation.target);
  }
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

  ipcMain.handle('llm:list-conversations', (_event, payload = {}) => {
    try {
      const conversations = llmService.listConversations({
        query: String(payload?.q || payload?.query || '').trim(),
        limit: payload?.limit == null ? 200 : payload.limit
      });
      return { ok: true, conversations, total: conversations.total ?? conversations.length };
    } catch (error) {
      log('error', 'Failed to list LLM conversations', { message: error.message, stack: error.stack });
      return { ok: false, error: error.message, conversations: [] };
    }
  });

  ipcMain.handle('llm:get-conversation', async (_event, payload) => {
    try {
      const target = String(payload?.target || '');
      const live = await llmService.reloadConversation(target);
      const conversation = live || llmService.findConversation(target, { includeMessages: true });
      return conversation ? { ok: true, conversation } : { ok: false, error: 'Conversation was not found.' };
    } catch (error) {
      log('error', 'Failed to load LLM conversation', { message: error.message, stack: error.stack });
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('llm:create-conversation', (_event, payload) => {
    try {
      const conversation = llmService.createConversation(payload || {});
      activateLlmIrcChannel(conversation);
      log('info', 'Created Codex conversation', { target: conversation.target, workspace: conversation.workspace });
      emit('llm-conversation', { conversation });
      return { ok: true, conversation };
    } catch (error) {
      log('error', 'Failed to create Codex conversation', { message: error.message, stack: error.stack });
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('llm:rename-conversation', (_event, payload) => {
    try {
      const result = llmService.renameConversation(String(payload?.target || ''), String(payload?.name || ''));
      if (result.ok && result.conversation) {
        log('info', 'Renamed conversation', { target: result.conversation.target, label: result.conversation.label });
        // Label-only event: a full llm-conversation would make the renderer rebuild the
        // open transcript from this sparse payload, wiping the hydrated message view.
        emit('llm-conversation-renamed', { target: result.conversation.target, label: result.conversation.label });
      }
      return result;
    } catch (error) {
      log('error', 'Failed to rename LLM conversation', { message: error.message, stack: error.stack });
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('llm:delete-conversation', (_event, payload) => {
    try {
      const target = String(payload?.target || '');
      const result = llmService.deleteConversation(target);
      if (result.ok) {
        log('info', 'Deleted LLM conversation', { target });
        emit('llm-conversation-deleted', { target });
      }
      return result;
    } catch (error) {
      log('error', 'Failed to delete LLM conversation', { message: error.message, stack: error.stack });
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('llm:activate-conversation', (_event, payload) => {
    const conversation = llmService.findConversation(String(payload?.target || ''));
    if (!conversation) return { ok: false, error: 'Conversation was not found.' };
    llmService.markActive(conversation.target);
    return activateLlmIrcChannel(conversation);
  });

  ipcMain.handle('llm:reload-conversation', async (_event, payload) => {
    try {
      const conversation = await llmService.reloadConversation(String(payload?.target || ''));
      if (conversation) emit('llm-conversation', { conversation });
      return conversation ? { ok: true, conversation } : { ok: false, error: 'Conversation was not found.' };
    } catch (error) {
      log('error', 'Failed to live-reload LLM conversation', { message: error.message, stack: error.stack });
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('llm:refresh-history', async () => {
    try {
      const result = await llmService.refreshHistory();
      if (result.status === 'deferred') return { ok: true, deferred: true, status: 'deferred' };
      if (!result.success) {
        log('error', 'Manual history refresh failed', { status: result.status, error: result.error });
        return { ok: false, status: result.status, error: result.error || 'History refresh failed.' };
      }
      const count = llmService.countConversations();
      log('info', 'Manual history refresh completed', { count });
      emit('llm-history-refreshed', { count });
      return { ok: true, count };
    } catch (error) {
      log('error', 'Manual history refresh crashed', { message: error.message, stack: error.stack });
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('llm:status', async (_event, payload) => {
    const result = await llmService.status(payload?.provider);
    return { ok: Boolean(result.success), ...result };
  });

  ipcMain.handle('llm:sessions', async (_event, payload) => {
    return llmService.listProviderSessions(payload?.provider);
  });

  ipcMain.handle('llm:get-identities', async () => {
    // Return available language model identities
    // For now, return a default structure based on configured CLIs
    // This can be enhanced later to query actual CLI capabilities
    const identities = [];
    const providers = ['codex', 'claude', 'cursor', 'grok'];
    const models = {
      codex: ['codex-default'],
      claude: ['claude-sonnet-4-5', 'claude-opus', 'claude-haiku'],
      cursor: ['cursor-default'],
      grok: ['grok-beta']
    };
    
    for (const provider of providers) {
      for (const model of models[provider] || []) {
        identities.push({
          id: `${provider}-${model}`,
          provider,
          model,
          strategy: 'cli',
          remote: false,
          capabilities: {
            text: true,
            attachments: provider === 'claude',
            interactive_approvals: false,
            native_resume: true
          }
        });
      }
    }
    
    return { identities };
  });

  ipcMain.handle('llm:send-message', async (_event, payload) => {
    const target = String(payload?.target || '');
    const text = String(payload?.text || '').trim();
    log('info', 'Sending LLM message', { target, length: text.length });
    const conversation = llmService.findConversation(target);
    if (conversation?.ircChannel) sendIrcText(conversation.ircChannel, text);
    if (payload?.files?.length) {
      const provider = conversation?.provider || 'codex';
      const label = providerLabel(provider);
      emit('llm-busy', { target, busy: true });
      try {
        const response = await llmService.sendMessage(target, text, payload.files);
        if (response.userMessage) emit('llm-message', { target, message: response.userMessage, provider, from: currentNick });
        if (response.ok) {
          emit('llm-message', { target, message: response.assistantMessage, provider });
          emit('llm-conversation', { conversation: response.conversation });
          if (conversation?.ircChannel) sendIrcText(conversation.ircChannel, `${label}: ${response.assistantMessage.text}`);
        } else {
          emit('system', { target, text: llmErrorText(label, response) });
          if (llmService._isAuthFailure(response)) {
            emit('llm-choose-session', {
              target,
              provider,
              text,
              currentUser: response.sessions?.currentUser,
              sessions: response.sessions?.users || []
            });
          }
        }
        return response;
      } finally {
        emit('llm-busy', { target, busy: false });
      }
    }
    try {
      const response = await answerLlmMessage(target, text, currentNick, true);
      if (response.ok) {
        log('info', 'LLM message completed', { target, sessionId: response.conversation.sessionId });
      }
      if (!response.ok) {
        log('error', 'LLM message failed', { target, status: response.status, error: response.error });
      }
      return response;
    } catch (error) {
      log('error', 'LLM message crashed', { target, message: error.message, stack: error.stack });
      return { ok: false, status: 'error', error: error.message };
    }
  });

  ipcMain.handle('system:list-users', async () => {
    try {
      return await listSystemUsers();
    } catch (error) {
      log('error', 'Failed to list system users', { message: error.message });
      return { ok: false, users: [], error: error.message };
    }
  });

  ipcMain.handle('switchuser:status', (_event, payload) => {
    const username = payload?.username ? String(payload.username) : '';
    if (username) return { ok: true, status: suSessionManager.getStatus(username) };
    return { ok: true, statuses: suSessionManager.listStatuses() };
  });

  ipcMain.handle('switchuser:continue-as', (_event, payload) => {
    return continueConversationAsUser(String(payload?.target || ''), String(payload?.username || ''));
  });

  ipcMain.handle('switchuser:disconnect', (_event, payload) => {
    const username = String(payload?.username || '');
    suSessionManager.disconnect(username);
    terminalWindow.closeTerminalWindow(username);
    return { ok: true };
  });

  ipcMain.handle('switchuser:pty-input', (_event, payload) => {
    suSessionManager.writeInput(String(payload?.username || ''), String(payload?.data || ''));
    return { ok: true };
  });

  ipcMain.handle('switchuser:pty-resize', (_event, payload) => {
    suSessionManager.resize(String(payload?.username || ''), Number(payload?.cols) || 0, Number(payload?.rows) || 0);
    return { ok: true };
  });

  ipcMain.handle('conversation:context-menu', async (_event, payload) => {
    const target = String(payload?.target || '');
    const menu = await buildConversationContextMenu(target);
    menu.popup({ window: mainWindow, x: Number.isFinite(payload?.x) ? payload.x : undefined, y: Number.isFinite(payload?.y) ? payload.y : undefined });
    return { ok: true };
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

  ipcMain.handle('file:reveal', async (_event, payload) => {
    const reference = String(payload?.filePath || '').trim();
    try {
      let filePath = reference.startsWith('file:///') ? fileURLToPath(reference) : decodeURIComponent(reference);
      if (!path.isAbsolute(filePath) && !path.win32.isAbsolute(filePath)) {
        return { ok: false, error: 'Only absolute local paths can be opened.' };
      }
      if (!fs.existsSync(filePath)) filePath = filePath.replace(/:\d+(?::\d+)?$/, '');
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          const error = await shell.openPath(filePath);
          return error ? { ok: false, error } : { ok: true, path: filePath, directory: true };
        }
        shell.showItemInFolder(filePath);
        return { ok: true, path: filePath, directory: false };
      }
      const parent = path.dirname(filePath);
      if (parent !== filePath && fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
        const error = await shell.openPath(parent);
        return error ? { ok: false, error } : { ok: true, path: parent, directory: true, targetMissing: true };
      }
      return { ok: false, error: `Path does not exist: ${filePath}` };
    } catch (error) {
      log('error', 'Show in folder failed', { reference, message: error.message });
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('shell:open-external', async (_event, payload) => {
    try {
      const target = new URL(String(payload?.url || ''));
      if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) {
        return { ok: false, error: 'Unsupported link protocol.' };
      }
      await shell.openExternal(target.toString());
      return { ok: true };
    } catch (error) {
      log('error', 'External link failed', { url: payload?.url, message: error.message });
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('app:log', (_event, payload) => {
    log(payload.level || 'info', payload.message || 'Renderer log', payload.details || {});
    return { ok: true };
  });

  mainWindow.webContents.once('did-finish-load', () => {
    emit('status', { state: 'idle', text: 'Ready' });
    connectIrc();
    llmService.refreshHistory().then((result) => {
      if (!result.success) {
        log('error', 'Local chat history pipeline failed', { status: result.status, error: result.error });
        emit('system', { target: config.channel, text: `History refresh failed: ${result.error || result.status || 'unknown error'}` });
        return;
      }
      const count = llmService.countConversations();
      log('info', 'Local chat history pipeline completed', { count });
      emit('llm-history-refreshed', { count });
    }).catch((error) => {
      log('error', 'Local chat history pipeline crashed', { message: error.message, stack: error.stack });
    });
  });
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    if (process.platform !== 'darwin') app.quit();
  }
});

app.on('before-quit', (event) => {
  // Unconditional, and safe to run every time before-quit fires (including a re-entrant
  // call from the IRC shutdown path below): disconnect() and closeAllTerminalWindows()
  // are both no-ops once there is nothing left to clean up.
  suSessionManager?.disconnectAll();
  terminalWindow.closeAllTerminalWindows();
  if (!isQuitting && socket) {
    event.preventDefault();
    isQuitting = true;
    shutdownIrcThenQuit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
