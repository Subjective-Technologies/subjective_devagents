const transcript = document.getElementById('transcript');
const composer = document.getElementById('composer');
const input = document.getElementById('messageInput');
const pendingImagesEl = document.getElementById('pendingImages');
const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');
const connectButton = document.getElementById('connectButton');
const sendImageButton = document.getElementById('sendImageButton');
const settingsButton = document.getElementById('settingsButton');
const bookmarksButton = document.getElementById('bookmarksButton');
const serverLabel = document.getElementById('serverLabel');
const topChannel = document.getElementById('topChannel');
const identityLabel = document.getElementById('identityLabel');
const conversationList = document.getElementById('conversationList');
const userList = document.getElementById('userList');
const userCount = document.getElementById('userCount');
const accentGrid = document.getElementById('accentGrid');
const settingsDialog = document.getElementById('settingsDialog');
const settingsForm = document.getElementById('settingsForm');
const settingsCloseButton = document.getElementById('settingsCloseButton');
const bookmarkSelect = document.getElementById('bookmarkSelect');
const saveBookmarkButton = document.getElementById('saveBookmarkButton');
const connectionNameInput = document.getElementById('connectionNameInput');
const hostInput = document.getElementById('hostInput');
const portInput = document.getElementById('portInput');
const tlsInput = document.getElementById('tlsInput');
const channelInput = document.getElementById('channelInput');
const nickInput = document.getElementById('nickInput');
const realnameInput = document.getElementById('realnameInput');
const commandPalette = document.getElementById('commandPalette');
const mobileMenuButton = document.getElementById('mobileMenuButton');
const mobileDrawer = document.getElementById('mobileDrawer');
const mobileDrawerClose = document.getElementById('mobileDrawerClose');
const mobileDrawerLabel = document.getElementById('mobileDrawerLabel');
const mobileTabsSlot = document.getElementById('mobileTabsSlot');
const mobileUsersSlot = document.getElementById('mobileUsersSlot');
const mobileAppearanceSlot = document.getElementById('mobileAppearanceSlot');
const mobileTopbarMetaSlot = document.getElementById('mobileTopbarMetaSlot');
const mobileTopActionsSlot = document.getElementById('mobileTopActionsSlot');
const mobileDrawerTabs = [...document.querySelectorAll('[data-mobile-drawer-tab]')];
const mobileDrawerPanels = [...document.querySelectorAll('[data-mobile-drawer-panel]')];
const conversationsPanel = document.getElementById('conversationsPanel');
const accentPanel = document.getElementById('accentPanel');
const usersPane = document.getElementById('usersPane');
const topActions = document.getElementById('topActions');
const topbarMeta = document.getElementById('topbarMeta');

let config = {};
let activeTarget = '';
const conversations = new Map();
let users = [];
let pendingImages = [];
let pendingImageId = 0;
let recentPasteSignature = '';
let recentPasteTime = 0;
let commandMatches = [];
let commandMatchIndex = 0;
let mobileMounted = false;

const commandSpecs = [
  { name: 'server', usage: '/server host [port] [channel] [nick] [realname] [tls]', description: 'Change server, port, channel, and identity.' },
  { name: 'nick', usage: '/nick newnick', description: 'Change your nickname.' },
  { name: 'join', usage: '/join #channel', description: 'Join a channel and focus it.' },
  { name: 'part', usage: '/part [#channel] [reason]', description: 'Leave a channel.' },
  { name: 'msg', usage: '/msg target text', description: 'Send a message to a channel or nick.' },
  { name: 'query', usage: '/query nick [text]', description: 'Open a private conversation.' },
  { name: 'me', usage: '/me action', description: 'Send an action message.' },
  { name: 'notice', usage: '/notice target text', description: 'Send a notice.' },
  { name: 'topic', usage: '/topic text', description: 'Set the current channel topic.' },
  { name: 'names', usage: '/names [#channel]', description: 'Refresh the user list.' },
  { name: 'whois', usage: '/whois nick', description: 'Query server identity information.' },
  { name: 'away', usage: '/away [message]', description: 'Set or clear an away message.' },
  { name: 'connect', usage: '/connect', description: 'Reconnect to the server.' },
  { name: 'disconnect', usage: '/disconnect', description: 'Disconnect from the server.' },
  { name: 'quit', usage: '/quit', description: 'Disconnect the IRC session.' },
  { name: 'raw', usage: '/raw IRC command', description: 'Send a raw IRC command.' }
];

function activeCommandList(value = input.value) {
  const text = String(value || '').replace(/^\s+/, '');
  if (!text.startsWith('/') || text.startsWith('//')) return [];
  const command = text.slice(1).split(/\s+/)[0].toLowerCase();
  return commandSpecs.filter((spec) => spec.name.startsWith(command));
}

function hideCommandPalette() {
  commandMatches = [];
  commandMatchIndex = 0;
  commandPalette.hidden = true;
  commandPalette.replaceChildren();
}

function renderCommandPalette(items) {
  commandMatches = items;
  commandMatchIndex = 0;
  commandPalette.replaceChildren();

  if (!items.length) {
    commandPalette.hidden = true;
    return;
  }

  for (const [index, spec] of items.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command-item';
    button.classList.toggle('active', index === commandMatchIndex);
    button.innerHTML = `
      <strong>/${escapeHtml(spec.name)}</strong>
      <small>${escapeHtml(spec.description)}</small>
    `;
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      applyCommandSuggestion(spec);
    });
    commandPalette.appendChild(button);
  }

  commandPalette.hidden = false;
}

function updateCommandPalette() {
  const items = activeCommandList();
  renderCommandPalette(items);
}

function applyCommandSuggestion(spec) {
  input.value = `/${spec.name} `;
  hideCommandPalette();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function selectedCommand() {
  return commandMatches[commandMatchIndex] || null;
}

function moveCommandSelection(delta) {
  if (!commandMatches.length) return;
  commandMatchIndex = (commandMatchIndex + delta + commandMatches.length) % commandMatches.length;
  for (const [index, item] of commandPalette.querySelectorAll('.command-item').entries()) {
    item.classList.toggle('active', index === commandMatchIndex);
  }
}

function isSlashCommand(line) {
  const text = String(line || '').trimStart();
  return text.startsWith('/') && !text.startsWith('//');
}

function normalizeLiteralSlash(line) {
  return String(line || '').startsWith('//') ? String(line).slice(1) : String(line);
}

function isMobileLayout() {
  return Boolean(mobileDrawer) && window.matchMedia('(max-width: 720px)').matches;
}

function mountNode(node, slot) {
  if (!node || !slot) return;
  if (slot.contains(node)) return;
  slot.replaceChildren(node);
}

function mountMobileLayout() {
  if (!isMobileLayout() || mobileMounted) return;
  mountNode(conversationList, mobileTabsSlot);
  mountNode(usersPane, mobileUsersSlot);
  mountNode(accentPanel, mobileAppearanceSlot);
  mountNode(topbarMeta, mobileTopbarMetaSlot);
  mountNode(topActions, mobileTopActionsSlot);
  mobileMounted = true;
}

function setMobileDrawerTab(name) {
  for (const tab of mobileDrawerTabs) {
    tab.classList.toggle('active', tab.dataset.mobileDrawerTab === name);
  }
  for (const panel of mobileDrawerPanels) {
    panel.classList.toggle('active', panel.dataset.mobileDrawerPanel === name);
  }
}

function openMobileDrawer(tabName = 'conversations') {
  if (!mobileDrawer) return;
  mountMobileLayout();
  setMobileDrawerTab(tabName || 'users');
  if (mobileDrawer.showModal) mobileDrawer.showModal();
  else mobileDrawer.setAttribute('open', '');
}

function closeMobileDrawer() {
  if (!mobileDrawer) return;
  mobileDrawer.close();
}

function normalizeConnection(value = {}) {
  const host = String(value.host || '192.168.0.250').trim();
  const port = Number(value.port || 6667);
  const channel = String(value.channel || '#subjective').trim();
  const nick = String(value.nick || 'Tomasso').trim();
  return {
    name: String(value.name || `${host}:${Number.isFinite(port) ? port : 6667}`).trim(),
    host,
    port: Number.isFinite(port) && port > 0 ? port : 6667,
    tls: Boolean(value.tls),
    channel: channel.startsWith('#') ? channel : `#${channel || 'subjective'}`,
    nick,
    realname: String(value.realname || nick || 'Tomasso').trim()
  };
}

function currentConnection() {
  return normalizeConnection(config);
}

function updateConnectionLabels() {
  serverLabel.textContent = `${config.host}:${config.port}`;
  identityLabel.textContent = config.nick;
  topChannel.textContent = activeTarget || config.channel;
  if (mobileDrawerLabel) mobileDrawerLabel.textContent = `${config.nick} @ ${config.channel}`;
}

function updateConfig(nextConfig) {
  const previousChannel = config.channel;
  config = { ...config, ...nextConfig, bookmarks: nextConfig.bookmarks || config.bookmarks || [] };
  updateConnectionLabels();
  renderBookmarks();
  if (!activeTarget || activeTarget === previousChannel) {
    ensureConversation(config.channel, config.channel, 'channel');
    setActiveTarget(config.channel);
  } else {
    ensureConversation(config.channel, config.channel, 'channel');
    renderConversations();
  }
}

function formConnection() {
  return normalizeConnection({
    name: connectionNameInput.value,
    host: hostInput.value,
    port: portInput.value,
    tls: tlsInput.checked,
    channel: channelInput.value,
    nick: nickInput.value,
    realname: realnameInput.value
  });
}

function fillSettingsForm(connection = currentConnection()) {
  const next = normalizeConnection(connection);
  connectionNameInput.value = next.name;
  hostInput.value = next.host;
  portInput.value = String(next.port);
  tlsInput.checked = next.tls;
  channelInput.value = next.channel;
  nickInput.value = next.nick;
  realnameInput.value = next.realname;
}

function bookmarkLabel(bookmark) {
  const next = normalizeConnection(bookmark);
  return `${next.name} - ${next.host}:${next.port} ${next.channel}`;
}

function renderBookmarks() {
  bookmarkSelect.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Current settings';
  bookmarkSelect.appendChild(placeholder);
  for (const [index, bookmark] of (config.bookmarks || []).entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = bookmarkLabel(bookmark);
    bookmarkSelect.appendChild(option);
  }
}

function openSettings() {
  fillSettingsForm();
  renderBookmarks();
  if (settingsDialog.showModal) settingsDialog.showModal();
  else settingsDialog.setAttribute('open', '');
}

function openBookmarks() {
  openSettings();
  bookmarkSelect.focus();
}

function closeSettings() {
  settingsDialog.close();
}

async function saveConnection(saveBookmark = true) {
  const next = formConnection();
  const result = await window.subjectiveChat.saveConfig({ active: next, saveBookmark });
  if (result?.config) updateConfig(result.config);
  closeSettings();
}

function rendererLog(level, message, details = {}) {
  try {
    window.subjectiveChat.log(level, message, details);
  } catch (error) {
    console.error(message, details, error);
  }
}

window.addEventListener('error', (event) => {
  rendererLog('error', 'Renderer window error', {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error && event.error.stack
  });
});

window.addEventListener('unhandledrejection', (event) => {
  rendererLog('error', 'Renderer unhandled rejection', {
    reason: String(event.reason),
    stack: event.reason && event.reason.stack
  });
});

function ensureConversation(target, label = target, kind = target.startsWith('#') ? 'channel' : 'dm') {
  if (!conversations.has(target)) {
    conversations.set(target, { target, label, kind, events: [], unread: 0 });
  }
  renderConversations();
  return conversations.get(target);
}

function setActiveTarget(target) {
  const conversation = ensureConversation(target);
  activeTarget = target;
  conversation.unread = 0;
  topChannel.textContent = conversation.label;
  input.placeholder = `Message ${conversation.label}`;
  renderConversations();
  renderTranscript();
}

function openDirectMessage(nick) {
  ensureConversation(nick, nick, 'dm');
  setActiveTarget(nick);
}

function addEvent(kind, data) {
  const target = data.target || activeTarget || config.channel;
  const conversation = ensureConversation(target, target, target.startsWith('#') ? 'channel' : 'dm');
  conversation.events.push({ kind, data: { ...data, target } });
  if (target !== activeTarget) conversation.unread += 1;
  if (target === activeTarget) renderTranscript();
  renderConversations();
}

function renderTranscript() {
  transcript.replaceChildren();
  const conversation = ensureConversation(activeTarget || config.channel);
  for (const event of conversation.events) {
    transcript.appendChild(renderEntry(event.kind, event.data));
  }
  transcript.scrollTop = transcript.scrollHeight;
}

function renderEntry(kind, data) {
  const item = document.createElement('article');
  item.className = `entry ${kind}`;

  if (kind === 'message') {
    item.classList.toggle('mine', Boolean(data.mine));
    item.innerHTML = `
      <div class="avatar">${initials(data.from)}</div>
      <div class="bubble">
        <div class="meta"><span>${escapeHtml(data.from)}</span><time>${timeLabel(data.time)}</time></div>
        <div class="text">${linkify(escapeHtml(data.text))}</div>
      </div>
    `;
  } else if (kind === 'image') {
    item.classList.toggle('mine', data.direction === 'outgoing');
    item.innerHTML = `
      <div class="avatar">${initials(data.from || 'DCC')}</div>
      <div class="bubble image-bubble">
        <div class="meta"><span>${escapeHtml(data.from || data.direction)}</span><time>${formatBytes(data.size || 0)}</time></div>
        <button class="image-open" type="button">
          <img src="${data.url}" alt="${escapeHtml(data.fileName)}">
        </button>
        <div class="file-caption">${escapeHtml(data.fileName)}</div>
      </div>
    `;
    item.querySelector('.image-open').addEventListener('click', () => {
      window.subjectiveChat.openFile(data.filePath);
    });
  } else {
    item.innerHTML = `<div class="system-line">${escapeHtml(data.text || '')}</div>`;
  }
  return item;
}

function renderConversations() {
  conversationList.replaceChildren();
  for (const conversation of conversations.values()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conversation-row';
    button.classList.toggle('active', conversation.target === activeTarget);
    button.innerHTML = `
      <span class="conversation-icon">${conversation.kind === 'channel' ? '#' : '@'}</span>
      <span>${escapeHtml(conversation.label.replace(/^#/, ''))}</span>
      ${conversation.unread ? `<b>${conversation.unread}</b>` : ''}
    `;
    button.addEventListener('click', () => setActiveTarget(conversation.target));
    conversationList.appendChild(button);
  }
}

function renderUsers() {
  userCount.textContent = String(users.length);
  userList.replaceChildren();
  for (const user of users) {
    const row = document.createElement('div');
    row.className = 'user-row';
    row.innerHTML = `
      <button type="button" class="user-name" title="Open direct message">
        <span class="user-dot"></span>
        <span>${escapeHtml(user.modes || '')}${escapeHtml(user.nick)}</span>
      </button>
      <button type="button" class="dm-button" title="Direct message">DM</button>
    `;
    row.querySelector('.user-name').addEventListener('click', () => openDirectMessage(user.nick));
    row.querySelector('.dm-button').addEventListener('click', () => openDirectMessage(user.nick));
    userList.appendChild(row);
  }
}

function setStatus(state, text) {
  statusPill.dataset.state = state;
  statusText.textContent = text;
}

function initials(name) {
  return String(name || '?').slice(0, 2).toUpperCase();
}

function timeLabel(time) {
  return new Date(time || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes) {
  if (!bytes) return 'image';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function linkify(value) {
  return value.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
}

async function sendPastedImage(file) {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const fileName = file.name || `pasted-${Date.now()}.${extensionFor(file.type)}`;
  rendererLog('info', 'Pasted image send requested', { target: activeTarget, fileName, size: bytes.length });
  const result = await window.subjectiveChat.sendImageData({
    target: activeTarget,
    fileName,
    mimeType: file.type,
    bytes
  });
  if (!result.ok) addEvent('system', { target: activeTarget, text: 'Image was not sent.' });
}

async function sendTextMessages(lines) {
  for (const text of lines) {
    const outgoing = normalizeLiteralSlash(text).trim();
    if (!outgoing) continue;
    rendererLog('info', 'Composer submit', { target: activeTarget, length: outgoing.length });
    try {
      if (isSlashCommand(outgoing)) {
        const result = await window.subjectiveChat.executeCommand(outgoing, activeTarget);
        if (result?.focusTarget) setActiveTarget(result.focusTarget);
        if (!result?.ok) addEvent('system', { target: activeTarget, text: 'Command was not accepted.' });
      } else {
        const result = await window.subjectiveChat.sendMessage(activeTarget, outgoing);
        if (!result.ok) addEvent('system', { target: activeTarget, text: 'Message was not sent. The IRC connection is not ready.' });
      }
    } catch (error) {
      rendererLog('error', 'Failed to send message from composer', { message: error.message, stack: error.stack });
      addEvent('system', { target: activeTarget, text: `Message send failed: ${error.message}` });
    }
  }
}

function extensionFor(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/bmp') return 'bmp';
  if (mimeType === 'image/avif') return 'avif';
  return 'png';
}

function imageFileSignature(file) {
  return [
    file.name || 'clipboard-image',
    file.type || 'application/octet-stream',
    file.size || 0
  ].join(':');
}

function uniqueImageFiles(files) {
  const seen = new Set();
  return files.filter((file) => {
    if (!file || !file.type.startsWith('image/')) return false;
    const key = imageFileSignature(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addPendingImages(files) {
  for (const file of files) {
    pendingImages.push({
      id: pendingImageId++,
      file,
      url: URL.createObjectURL(file)
    });
  }
  renderPendingImages();
}

function removePendingImage(id) {
  const image = pendingImages.find((item) => item.id === id);
  if (image) URL.revokeObjectURL(image.url);
  pendingImages = pendingImages.filter((item) => item.id !== id);
  renderPendingImages();
}

function clearPendingImages() {
  for (const image of pendingImages) URL.revokeObjectURL(image.url);
  pendingImages = [];
  renderPendingImages();
}

function renderPendingImages() {
  pendingImagesEl.replaceChildren();
  pendingImagesEl.hidden = pendingImages.length === 0;
  for (const image of pendingImages) {
    const item = document.createElement('div');
    item.className = 'pending-image';
    item.innerHTML = `
      <img src="${image.url}" alt="${escapeHtml(image.file.name || 'Pasted image')}">
      <button type="button" aria-label="Remove image" title="Remove image">&times;</button>
    `;
    item.querySelector('button').addEventListener('click', () => removePendingImage(image.id));
    pendingImagesEl.appendChild(item);
  }
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const lines = input.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const images = pendingImages.map((image) => image.file);
  if (!lines.length && !images.length) return;
  input.value = '';
  hideCommandPalette();
  clearPendingImages();
  await sendTextMessages(lines);
  for (const file of images) await sendPastedImage(file);
});

input.addEventListener('keydown', (event) => {
  if (commandPalette.hidden === false) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveCommandSelection(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveCommandSelection(-1);
      return;
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      if (commandMatches.length) {
        event.preventDefault();
        applyCommandSuggestion(selectedCommand());
        return;
      }
    }
    if (event.key === 'Escape') {
      hideCommandPalette();
      return;
    }
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

input.addEventListener('input', () => {
  updateCommandPalette();
});

input.addEventListener('blur', () => {
  window.setTimeout(() => {
    if (document.activeElement !== input) hideCommandPalette();
  }, 120);
});

input.addEventListener('paste', async (event) => {
  const directFiles = [...event.clipboardData.files];
  const itemFiles = directFiles.length ? [] : [...event.clipboardData.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean);
  const files = uniqueImageFiles([...directFiles, ...itemFiles]);
  if (!files.length) return;
  const signature = files.map(imageFileSignature).join('|');
  const now = Date.now();
  if (signature === recentPasteSignature && now - recentPasteTime < 1200) return;
  recentPasteSignature = signature;
  recentPasteTime = now;
  event.preventDefault();
  addPendingImages(files);
});

connectButton.addEventListener('click', async () => {
  await window.subjectiveChat.connect();
});

sendImageButton.addEventListener('click', () => {
  window.subjectiveChat.sendImage(activeTarget);
});

settingsButton.addEventListener('click', openSettings);

bookmarksButton.addEventListener('click', openBookmarks);

if (mobileMenuButton) {
  mobileMenuButton.addEventListener('click', () => openMobileDrawer('users'));
}

if (mobileDrawerClose) {
  mobileDrawerClose.addEventListener('click', closeMobileDrawer);
}

if (mobileDrawer) {
  mobileDrawer.addEventListener('click', (event) => {
    if (event.target === mobileDrawer) closeMobileDrawer();
  });
}

for (const tab of mobileDrawerTabs) {
  tab.addEventListener('click', () => setMobileDrawerTab(tab.dataset.mobileDrawerTab));
}

settingsCloseButton.addEventListener('click', closeSettings);

settingsDialog.addEventListener('click', (event) => {
  if (event.target === settingsDialog) closeSettings();
});

bookmarkSelect.addEventListener('change', () => {
  if (bookmarkSelect.value === '') {
    fillSettingsForm();
    return;
  }
  const bookmark = config.bookmarks?.[Number(bookmarkSelect.value)];
  if (bookmark) fillSettingsForm(bookmark);
});

saveBookmarkButton.addEventListener('click', async () => {
  await saveConnection(true);
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveConnection(true);
});

accentGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-accent]');
  if (!button) return;
  document.body.dataset.accent = button.dataset.accent;
  for (const swatch of accentGrid.querySelectorAll('.accent-swatch')) swatch.classList.remove('active');
  button.classList.add('active');
  localStorage.setItem('subjective-chat-accent', button.dataset.accent);
});

window.addEventListener('resize', () => {
  mountMobileLayout();
});

window.subjectiveChat.onEvent((event) => {
  switch (event.type) {
    case 'status':
      setStatus(event.state, event.text);
      break;
    case 'config':
      updateConfig(event);
      break;
    case 'users':
      users = event.users;
      renderUsers();
      break;
    case 'system':
      addEvent('system', event);
      break;
    case 'message':
      addEvent('message', event);
      break;
    case 'join':
      addEvent('system', { target: event.target, text: `${event.nick} joined ${event.channel}` });
      break;
    case 'part':
      addEvent('system', { target: event.target, text: `${event.nick} left` });
      break;
    case 'dcc-start':
      addEvent('system', { target: event.target, text: `Receiving ${event.fileName} from ${event.from}` });
      break;
    case 'dcc-complete':
      if (event.image) addEvent('image', event);
      else addEvent('system', { target: event.target, text: `Received ${event.fileName}` });
      break;
    case 'dcc-error':
      addEvent('system', { target: event.target, text: `DCC error for ${event.fileName}: ${event.text}` });
      break;
    default:
      break;
  }
});

window.subjectiveChat.getConfig().then((appConfig) => {
  updateConfig(appConfig);
  activeTarget = config.channel;
  ensureConversation(config.channel, config.channel, 'channel');
  setActiveTarget(config.channel);
  mountMobileLayout();
  const savedAccent = localStorage.getItem('subjective-chat-accent') || 'gold';
  document.body.dataset.accent = savedAccent;
  for (const swatch of accentGrid.querySelectorAll('.accent-swatch')) {
    swatch.classList.toggle('active', swatch.dataset.accent === savedAccent);
  }
});
