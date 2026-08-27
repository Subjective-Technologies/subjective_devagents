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
const conversationBrowser = document.getElementById('conversationBrowser');
const conversationList = document.getElementById('conversationList');
const conversationSearch = document.getElementById('conversationSearch');
const conversationSearchCount = document.getElementById('conversationSearchCount');
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
const createLlmButton = document.getElementById('createLlmButton');
const llmDialog = document.getElementById('llmDialog');
const llmForm = document.getElementById('llmForm');
const llmCloseButton = document.getElementById('llmCloseButton');
const llmNameInput = document.getElementById('llmNameInput');
const llmWorkspaceInput = document.getElementById('llmWorkspaceInput');
const llmProviderSelect = document.getElementById('llmProviderSelect');
const llmStatusText = document.getElementById('llmStatusText');
const sessionPickerDialog = document.getElementById('sessionPickerDialog');
const sessionPickerTitle = document.getElementById('sessionPickerTitle');
const sessionPickerSubtitle = document.getElementById('sessionPickerSubtitle');
const sessionPickerList = document.getElementById('sessionPickerList');
const sessionPickerCloseButton = document.getElementById('sessionPickerCloseButton');
const topProviderIcon = document.getElementById('topProviderIcon');
const richMessages = window.SubjectiveMessageRenderer || {
  detectPromptActions: () => [],
  normalizeToolMessages: (messages) => (messages || []).map((message) => ({ type: 'message', message })),
  renderCode: (value) => `<pre><code>${escapeHtml(value)}</code></pre>`,
  renderCommand: (value) => `<pre><code>${escapeHtml(value)}</code></pre>`,
  renderMessage: (value) => `<p>${escapeHtml(value).replace(/\r?\n/g, '<br>')}</p>`
};

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
  mountNode(conversationBrowser || conversationList, mobileTabsSlot);
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
  const conversation = conversations.get(activeTarget);
  identityLabel.textContent = conversation?.kind === 'llm'
    ? `${conversation.provider} · ${conversation.workspace}`
    : config.nick;
  topChannel.textContent = conversation?.label || activeTarget || config.channel;
  topChannel.title = conversation?.label || activeTarget || config.channel;
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

let deferConversationRender = 0;
let llmListTotal = 0;

function ensureConversation(target, label = target, kind = target.startsWith('#') ? 'channel' : 'dm', metadata = {}) {
  if (!conversations.has(target)) {
    conversations.set(target, { target, label, kind, events: [], unread: 0, updatedAt: 0, sortAt: 0, ...metadata });
  } else if (metadata && Object.keys(metadata).length) {
    const conversation = conversations.get(target);
    const latestTimestamp = Math.max(Number(conversation.updatedAt || 0), Number(metadata.updatedAt || 0));
    const latestSortTimestamp = Math.max(Number(conversation.sortAt || 0), Number(metadata.sortAt || 0));
    Object.assign(conversation, metadata, {
      target,
      label,
      kind,
      updatedAt: latestTimestamp,
      sortAt: latestSortTimestamp
    });
  }
  if (!deferConversationRender) renderConversations();
  return conversations.get(target);
}

function setActiveTarget(target) {
  const conversation = ensureConversation(target);
  activeTarget = target;
  conversation.unread = 0;
  topChannel.textContent = conversation.label;
  topChannel.title = conversation.label;
  input.disabled = conversation.kind === 'llm' && (!conversation.writable || conversation.busy);
  input.placeholder = conversation.kind === 'llm' && !conversation.writable
    ? `${conversation.provider} history is read-only`
    : (conversation.busy ? `${providerName(conversation.provider)} is working…` : (conversation.kind === 'llm' ? `Message ${providerName(conversation.provider)}` : `Message ${conversation.label}`));
  identityLabel.textContent = conversation.kind === 'llm'
    ? `${conversation.provider} · ${conversation.workspace}`
    : config.nick;
  if (topProviderIcon) {
    topProviderIcon.hidden = !conversation.icon;
    topProviderIcon.src = conversation.icon || '';
    topProviderIcon.alt = conversation.icon ? `${conversation.provider} icon` : '';
  }
  sendImageButton.hidden = conversation.kind === 'llm';
  renderConversations();
  renderTranscript();
  renderUsers();
  if (conversation.kind === 'llm' && !conversation.hydrated && !conversation.loading) {
    conversation.loading = true;
    renderTranscript();
    window.subjectiveChat.getLlmConversation(target).then((result) => {
      conversation.loading = false;
      if (result?.ok) upsertLlmConversation(result.conversation);
      else addEvent('system', { target, text: result?.error || 'Could not load conversation history.' });
    });
  }
  if (conversation.kind === 'llm' && window.subjectiveChat.activateLlmConversation) {
    window.subjectiveChat.activateLlmConversation(target).then((result) => {
      if (result?.channel) identityLabel.textContent = `${conversation.provider} · ${result.channel} · ${conversation.workspace}`;
    });
  }
}

function openDirectMessage(nick) {
  ensureConversation(nick, nick, 'dm');
  setActiveTarget(nick);
}

function addEvent(kind, data) {
  const target = data.target || activeTarget || config.channel;
  const existing = conversations.get(target);
  const conversation = ensureConversation(target, existing?.label || target, existing?.kind || (target.startsWith('#') ? 'channel' : 'dm'));
  conversation.events.push({ kind, data: { ...data, target } });
  if (kind === 'message' || kind === 'image') {
    const messageTimestamp = Number(data.time || Date.now());
    conversation.updatedAt = Math.max(Number(conversation.updatedAt || 0), messageTimestamp);
    conversation.sortAt = Math.max(Number(conversation.sortAt || 0), messageTimestamp);
  }
  if (target !== activeTarget) conversation.unread += 1;
  if (target === activeTarget) renderTranscript();
  renderConversations();
}

const THINKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const THINKING_VERBS = ['Thinking', 'Processing', 'Percolating', 'Pondering', 'Noodling', 'Computing', 'Deliberating', 'Ruminating'];
const THINKING_FRAME_MS = 90;
const THINKING_VERB_MS = 4000;
let thinkingTimer = null;
let thinkingFrame = 0;

function tickThinkingRow() {
  const row = transcript.querySelector('.thinking-entry');
  if (!row) {
    stopThinkingAnimation();
    return;
  }
  thinkingFrame += 1;
  const elapsed = Math.max(0, Date.now() - Number(row.dataset.since || Date.now()));
  row.querySelector('.thinking-spinner').textContent = THINKING_FRAMES[thinkingFrame % THINKING_FRAMES.length];
  row.querySelector('.thinking-verb').textContent = THINKING_VERBS[Math.floor(elapsed / THINKING_VERB_MS) % THINKING_VERBS.length];
  row.querySelector('.thinking-elapsed').textContent = `${Math.floor(elapsed / 1000)}s`;
}

function stopThinkingAnimation() {
  if (!thinkingTimer) return;
  window.clearInterval(thinkingTimer);
  thinkingTimer = null;
}

function startThinkingAnimation() {
  if (thinkingTimer) return;
  thinkingTimer = window.setInterval(tickThinkingRow, THINKING_FRAME_MS);
}

function renderThinkingRow(conversation) {
  const item = document.createElement('article');
  item.className = 'entry thinking-entry';
  item.dataset.since = String(conversation.busySince || Date.now());
  const avatar = conversation.icon
    ? `<img class="avatar provider-avatar" src="${escapeHtml(conversation.icon)}" alt="${escapeHtml(providerName(conversation.provider))}">`
    : `<div class="avatar">${initials(providerName(conversation.provider))}</div>`;
  item.innerHTML = `
    ${avatar}
    <div class="thinking-bubble" role="status" aria-live="polite">
      <span class="thinking-spinner" aria-hidden="true">${THINKING_FRAMES[0]}</span>
      <span class="thinking-verb">${THINKING_VERBS[0]}</span>
      <span class="thinking-ellipsis" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="thinking-elapsed">0s</span>
    </div>
  `;
  return item;
}

function renderTranscript() {
  transcript.replaceChildren();
  const conversation = ensureConversation(activeTarget || config.channel);
  if (conversation.kind === 'llm' && conversation.loading) {
    transcript.appendChild(renderEntry('system', { text: 'Loading conversation history…' }));
    stopThinkingAnimation();
    return;
  }
  const finalEventIndex = conversation.events.length - 1;
  for (const [index, event] of conversation.events.entries()) {
    transcript.appendChild(renderEntry(event.kind, event.data, {
      conversation,
      actionable: index === finalEventIndex && Boolean(event.data.assistant)
    }));
  }
  if (conversation.kind === 'llm' && conversation.busy) {
    transcript.appendChild(renderThinkingRow(conversation));
    startThinkingAnimation();
  } else {
    stopThinkingAnimation();
  }
  transcript.scrollTop = transcript.scrollHeight;
}

async function copyText(value) {
  const text = String(value || '');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.setAttribute('readonly', '');
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.select();
  document.execCommand('copy');
  fallback.remove();
}

let commandConfirmationDialog;

function commandDialog() {
  if (commandConfirmationDialog) return commandConfirmationDialog;
  commandConfirmationDialog = document.createElement('dialog');
  commandConfirmationDialog.className = 'command-confirm-dialog';
  commandConfirmationDialog.innerHTML = `
    <form method="dialog" class="command-confirm-form">
      <div class="command-confirm-head">
        <div>
          <span class="eyebrow">Command approval</span>
          <h3>Run with agent?</h3>
        </div>
        <button type="button" class="plain-icon command-confirm-close" aria-label="Close">×</button>
      </div>
      <p class="command-confirm-copy"></p>
      <pre><code></code></pre>
      <div class="command-confirm-actions">
        <button type="button" class="secondary-button command-confirm-cancel">Cancel</button>
        <button type="submit" class="primary-button">Run</button>
      </div>
    </form>
  `;
  document.body.appendChild(commandConfirmationDialog);
  return commandConfirmationDialog;
}

function confirmAgentCommand(command, conversation) {
  const dialog = commandDialog();
  dialog.querySelector('h3').textContent = `Run with ${conversation.provider || 'agent'}?`;
  dialog.querySelector('.command-confirm-copy').textContent = `Workspace: ${conversation.workspace || 'current workspace'}`;
  dialog.querySelector('code').textContent = command;
  return new Promise((resolve) => {
    let settled = false;
    const close = (accepted) => {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(accepted);
    };
    dialog.querySelector('.command-confirm-close').onclick = () => close(false);
    dialog.querySelector('.command-confirm-cancel').onclick = () => close(false);
    dialog.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      close(true);
    };
    dialog.oncancel = (event) => {
      event.preventDefault();
      close(false);
    };
    dialog.showModal ? dialog.showModal() : dialog.setAttribute('open', '');
  });
}

async function sendAgentAction(conversation, reply, controls) {
  if (!conversation?.writable || !window.subjectiveChat.sendLlmMessage) return false;
  for (const button of controls.querySelectorAll('button')) button.disabled = true;
  controls.classList.add('pending');
  try {
    const result = await window.subjectiveChat.sendLlmMessage(conversation.target, reply);
    if (!result?.ok) {
      addEvent('system', {
        target: conversation.target,
        text: result?.error || `${conversation.provider} did not accept the response.`
      });
      return false;
    }
    return true;
  } catch (error) {
    addEvent('system', { target: conversation.target, text: `Action failed: ${error.message}` });
    return false;
  } finally {
    controls.classList.remove('pending');
    for (const button of controls.querySelectorAll('button')) button.disabled = Boolean(conversation.busy);
  }
}

function appendPromptActions(content, data, context) {
  if (!data.assistant || !context.actionable) return;
  const actions = richMessages.detectPromptActions(data.text);
  if (!actions.length) return;
  const controls = document.createElement('div');
  controls.className = 'prompt-actions';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Answer agent question');
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action.primary ? 'prompt-action primary' : 'prompt-action';
    if (action.custom) button.classList.add('prompt-action-custom');
    button.textContent = action.label;
    button.disabled = !context.conversation.writable || Boolean(context.conversation.busy);
    if (!context.conversation.writable) button.title = 'Historical conversation is read-only';
    button.addEventListener('click', () => {
      // "Something else..." doesn't have a canned reply to send - it just hands focus to
      // the composer so the user can type their own answer instead of picking one of the
      // detected options.
      if (action.custom) {
        if (context.conversation.target === activeTarget) input.focus();
        return;
      }
      sendAgentAction(context.conversation, action.reply, controls);
    });
    controls.appendChild(button);
  }
  content.appendChild(controls);
}

function wireRichMessage(content, data, context) {
  content.addEventListener('click', async (event) => {
    const localPath = event.target.closest('[data-local-path]');
    if (localPath) {
      event.preventDefault();
      const result = window.subjectiveChat.revealPath
        ? await window.subjectiveChat.revealPath(localPath.dataset.localPath)
        : { ok: false, error: 'Show in folder is unavailable.' };
      if (!result?.ok) {
        addEvent('system', {
          target: context.conversation.target,
          text: result?.error || 'Could not open containing folder.'
        });
      }
      return;
    }

    const codeButton = event.target.closest('[data-code-action]');
    if (codeButton) {
      const card = codeButton.closest('.code-card');
      if (codeButton.dataset.codeAction === 'wrap') {
        const wrapped = card?.classList.toggle('wrapped');
        codeButton.classList.toggle('active', Boolean(wrapped));
        return;
      }
      const code = card?.querySelector('code')?.textContent || '';
      if (!code) return;
      if (codeButton.dataset.codeAction === 'copy') {
        const original = codeButton.textContent;
        try {
          await copyText(code);
          codeButton.textContent = 'Copied';
        } catch (error) {
          rendererLog('error', 'Code copy failed', { message: error.message });
          codeButton.textContent = 'Copy failed';
        }
        window.setTimeout(() => { codeButton.textContent = original; }, 1400);
        return;
      }
      if (!context.conversation.writable || context.conversation.busy) return;
      if (!await confirmAgentCommand(code, context.conversation)) return;
      await sendAgentAction(
        context.conversation,
        `Run this command in the current workspace and report its output:\n\n<command>\n${code}\n</command>`,
        card.querySelector('.code-actions')
      );
      return;
    }

    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    const url = link.getAttribute('href');
    if (window.subjectiveChat.openExternal) await window.subjectiveChat.openExternal(url);
  });

  for (const runButton of content.querySelectorAll('[data-code-action="run"]')) {
    runButton.disabled = !context.conversation.writable || Boolean(context.conversation.busy);
    if (!context.conversation.writable) runButton.title = 'Open a writable agent conversation to run commands';
  }
  appendPromptActions(content, data, context);
}

function renderEntry(kind, data, context = {}) {
  const item = document.createElement('article');
  item.className = `entry ${kind}`;

  if (kind === 'message') {
    item.classList.toggle('mine', Boolean(data.mine));
    const avatar = data.icon
      ? `<img class="avatar provider-avatar" src="${escapeHtml(data.icon)}" alt="${escapeHtml(data.from)}">`
      : `<div class="avatar">${initials(data.from)}</div>`;
    item.innerHTML = `
      ${avatar}
      <div class="bubble">
        <div class="meta"><span>${escapeHtml(data.from)}</span><time>${timeLabel(data.time)}</time></div>
        <div class="text rich-text">${richMessages.renderMessage(data.text)}</div>
      </div>
    `;
    wireRichMessage(item.querySelector('.rich-text'), data, context);
  } else if (kind === 'command') {
    item.classList.add('command-entry');
    const avatar = data.icon
      ? `<img class="avatar provider-avatar" src="${escapeHtml(data.icon)}" alt="${escapeHtml(data.from)}">`
      : `<div class="avatar">${initials(data.from || 'CMD')}</div>`;
    item.innerHTML = `
      ${avatar}
      <div class="bubble command-bubble">
        <div class="meta command-meta">
          <span>${escapeHtml(data.from || 'Command')}</span>
          <span class="command-shell">${escapeHtml(data.shell || 'shell')}</span>
          <time>${timeLabel(data.time)}</time>
        </div>
        <div class="text rich-text command-content">${richMessages.renderCommand(data.command, data.shell)}</div>
      </div>
    `;
    wireRichMessage(item.querySelector('.rich-text'), data, context);
  } else if (kind === 'code') {
    item.classList.add('command-entry', 'code-entry');
    const avatar = data.icon
      ? `<img class="avatar provider-avatar" src="${escapeHtml(data.icon)}" alt="${escapeHtml(data.from)}">`
      : `<div class="avatar">${initials(data.from || 'CODE')}</div>`;
    item.innerHTML = `
      ${avatar}
      <div class="bubble command-bubble code-bubble">
        <div class="meta command-meta">
          <span>${escapeHtml(data.from || 'Tool')}</span>
          <span class="command-shell">${escapeHtml(data.label || 'Output')}</span>
          <time>${timeLabel(data.time)}</time>
        </div>
        <div class="text rich-text command-content">${richMessages.renderCode(data.code, data.language)}</div>
      </div>
    `;
    wireRichMessage(item.querySelector('.rich-text'), data, context);
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

function conversationTimestamp(conversation) {
  const eventTimestamp = (conversation.events || []).reduce(
    (latest, event) => Math.max(latest, Number(event.data?.time || 0)),
    0
  );
  const metadataTimestamp = Number(
    conversation.sortAt || conversation.updatedAt || conversation.createdAt || 0
  );
  return Math.max(metadataTimestamp, eventTimestamp);
}

function conversationSearchText(conversation) {
  return [
    conversation.label,
    conversation.provider,
    conversation.description,
    conversation.workspace,
    conversation.ircChannel,
    conversation.sourceUser,
    conversation.osUser,
    ...(conversation.events || []).map((event) => `${event.data?.from || ''} ${event.data?.text || event.data?.command || ''}`)
  ].join(' ').toLocaleLowerCase();
}

// IRC channels/DMs are listed above AI chats, most-recent-first within each group.
function conversationGroupRank(conversation) {
  return conversation.kind === 'llm' ? 1 : 0;
}

function conversationUserHue(username) {
  let hash = 2166136261;
  for (let index = 0; index < username.length; index += 1) {
    hash ^= username.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 12;
}

function conversationUserPillHtml(conversation) {
  const username = String(conversation.sourceUser || conversation.osUser || '').trim();
  if (!username || conversation.kind !== 'llm') {
    return '<span class="conversation-user-pill is-empty" aria-hidden="true"></span>';
  }
  const slot = conversationUserHue(username);
  return `<span class="conversation-user-pill user-hue-${slot}" title="${escapeHtml(username)}">${escapeHtml(username)}</span>`;
}

function renderConversations() {
  conversationList.replaceChildren();
  const ordered = [...conversations.values()].sort((left, right) => {
    const groupDifference = conversationGroupRank(left) - conversationGroupRank(right);
    if (groupDifference) return groupDifference;
    const timestampDifference = conversationTimestamp(right) - conversationTimestamp(left);
    if (timestampDifference) return timestampDifference;
    return String(left.label || '').localeCompare(String(right.label || ''));
  });
  const query = String(conversationSearch?.value || '').trim().toLocaleLowerCase();
  const visible = query
    ? ordered.filter((conversation) => conversationSearchText(conversation).includes(query))
    : ordered;
  if (conversationSearchCount) {
    const shown = visible.length;
    const total = llmListTotal || ordered.filter((item) => item.kind === 'llm').length;
    conversationSearchCount.textContent = query
      ? `${shown}${total > shown ? `/${total}` : ''}`
      : (total > shown ? `${shown}/${total}` : String(shown || ordered.length));
  }
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    empty.textContent = query ? `No chats matching “${conversationSearch.value.trim()}”` : 'No conversations yet';
    conversationList.appendChild(empty);
    return;
  }
  for (const conversation of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conversation-row';
    button.title = conversation.sourceUser
      ? `${conversation.sourceUser}: ${conversation.label}`
      : conversation.label;
    button.dataset.target = conversation.target;
    button.classList.toggle('active', conversation.target === activeTarget);
    button.classList.toggle('busy', Boolean(conversation.busy));
    const icon = conversation.icon
      ? `<img class="conversation-provider-icon" src="${escapeHtml(conversation.icon)}" alt="${escapeHtml(conversation.provider)}">`
      : `<span class="conversation-icon">${conversation.kind === 'channel' ? '#' : '@'}</span>`;
    button.innerHTML = `
      <span class="conversation-user-cell">${conversationUserPillHtml(conversation)}</span>
      <span class="conversation-icon-cell">${icon}</span>
      <span class="conversation-label">${escapeHtml(conversation.label.replace(/^#/, ''))}</span>
      <span class="conversation-unread-cell">${conversation.unread ? `<b>${conversation.unread}</b>` : ''}</span>
    `;
    button.addEventListener('click', () => setActiveTarget(conversation.target));
    if (conversation.kind === 'llm') {
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        window.subjectiveChat.showConversationContextMenu(conversation.target, event.clientX, event.clientY);
      });
      button.addEventListener('dblclick', (event) => {
        event.preventDefault();
        beginRenameConversation(conversation.target);
      });
    }
    conversationList.appendChild(button);
  }
}

// Inline chat rename: swap the label for a text field in place. Triggered by double-click
// on a chat row or the "Rename…" context-menu entry (which arrives as an app event).
function beginRenameConversation(target) {
  if (!window.subjectiveChat.renameLlmConversation) return;
  const conversation = conversations.get(target);
  if (!conversation || conversation.kind !== 'llm') return;
  const row = conversationList.querySelector(`.conversation-row[data-target="${CSS.escape(target)}"]`);
  if (!row) return;
  const labelSpan = row.querySelector('.conversation-label');
  if (!labelSpan || row.querySelector('.conversation-rename-input')) return;

  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'conversation-rename-input';
  field.value = conversation.label.replace(/^#/, '');
  field.maxLength = 200;
  labelSpan.replaceWith(field);
  field.focus();
  field.select();

  let settled = false;
  const cancel = () => {
    if (settled) return;
    settled = true;
    renderConversations();
  };
  const commit = async () => {
    if (settled) return;
    settled = true;
    const name = field.value.trim();
    if (!name || name === conversation.label.replace(/^#/, '')) {
      renderConversations();
      return;
    }
    const result = await window.subjectiveChat.renameLlmConversation(target, name);
    // On success the label is applied via the 'llm-conversation-renamed' event; either way
    // re-render to drop the inline input and restore the row.
    if (!result?.ok) {
      rendererLog('error', 'Failed to rename conversation', { target, error: result?.error });
    }
    renderConversations();
  };

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  });
  field.addEventListener('blur', commit);
  field.addEventListener('click', (event) => event.stopPropagation());
  field.addEventListener('dblclick', (event) => event.stopPropagation());
}

if (conversationSearch) {
  let searchReloadTimer = 0;
  conversationSearch.addEventListener('input', () => {
    window.clearTimeout(searchReloadTimer);
    searchReloadTimer = window.setTimeout(() => {
      loadLlmConversations();
    }, 200);
  });
  conversationSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && conversationSearch.value) {
      event.preventDefault();
      conversationSearch.value = '';
      loadLlmConversations();
    }
    if (event.key === 'Enter') {
      const firstResult = conversationList.querySelector('.conversation-row');
      if (firstResult) {
        event.preventDefault();
        firstResult.click();
      }
    }
  });
}

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && conversationSearch) {
    event.preventDefault();
    conversationSearch.focus();
    conversationSearch.select();
  }
});

function renderUsers() {
  const conversation = conversations.get(activeTarget);
  const visibleUsers = conversation?.kind === 'llm' ? (conversation.participants || []) : users;
  userCount.textContent = String(visibleUsers.length);
  userList.replaceChildren();
  for (const user of visibleUsers) {
    const row = document.createElement('div');
    row.className = 'user-row';
    row.innerHTML = `
      <button type="button" class="user-name" title="Open direct message">
        <span class="user-dot"></span>
        <span>${escapeHtml(user.modes || '')}${escapeHtml(user.nick)}</span>
      </button>
      <button type="button" class="dm-button" title="Direct message">DM</button>
    `;
    const dmButton = row.querySelector('.dm-button');
    if (conversation?.kind === 'llm') {
      dmButton.hidden = true;
      row.querySelector('.user-name').disabled = true;
    } else {
      row.querySelector('.user-name').addEventListener('click', () => openDirectMessage(user.nick));
      dmButton.addEventListener('click', () => openDirectMessage(user.nick));
    }
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

async function llmAttachment(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    filename: file.name || `attachment-${Date.now()}.${extensionFor(file.type)}`,
    mime_type: file.type || 'application/octet-stream',
    content: btoa(binary)
  };
}

// LLM composer optimistic echo: show the user's own bubble - and start the thinking row -
// the instant Send is clicked, instead of waiting on the full agent round-trip. Previously
// both only appeared once the 'llm-message' event for the sent text came back from main,
// which meant a slow reply (or any hiccup in that event reaching this window) left the
// composed message looking like it vanished into nothing. Reconciled against the
// authoritative 'llm-message' echo once it arrives (see the onEvent switch below) so the
// bubble isn't shown twice.
function addOptimisticLlmEcho(conversation, text) {
  conversation.pendingEchoes = conversation.pendingEchoes || [];
  conversation.pendingEchoes.push(text);
  conversation.busy = true;
  conversation.busySince = conversation.busySince || Date.now();
  if (conversation.target === activeTarget) {
    input.disabled = true;
    input.placeholder = `${providerName(conversation.provider)} is working…`;
  }
  addEvent('message', {
    target: conversation.target,
    from: config.nick || 'You',
    text,
    time: Date.now(),
    mine: true,
    assistant: false,
    optimistic: true
  });
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
        const conversation = conversations.get(activeTarget);
        if (conversation?.kind === 'llm') {
          addOptimisticLlmEcho(conversation, outgoing);
          const result = await window.subjectiveChat.sendLlmMessage(activeTarget, outgoing);
          if (!result.ok) {
            const detail = result.error || result.status || 'Message was not sent.';
            addEvent('system', { target: activeTarget, text: `${providerName(conversation.provider)}: ${detail}` });
            if (result.sessions?.users) {
              openSessionPicker({
                target: activeTarget,
                provider: conversation.provider,
                text: outgoing,
                sessions: result.sessions.users,
                currentUser: result.sessions.currentUser
              });
            }
          }
        } else {
          const result = await window.subjectiveChat.sendMessage(activeTarget, outgoing);
          if (!result.ok) addEvent('system', { target: activeTarget, text: 'Message was not sent. The IRC connection is not ready.' });
        }
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
  const conversation = conversations.get(activeTarget);
  if (conversation?.kind === 'llm' && images.length) {
    try {
      const files = await Promise.all(images.map(llmAttachment));
      addOptimisticLlmEcho(conversation, lines.join('\n') || 'Review attached image.');
      await window.subjectiveChat.sendLlmMessage(activeTarget, lines.join('\n') || 'Review attached image.', files);
    } catch (error) {
      addEvent('system', { target: activeTarget, text: `Attachment send failed: ${error.message}` });
    }
    return;
  }
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

const PROVIDER_DISPLAY_NAMES = Object.freeze({
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  grok: 'Grok'
});

function providerName(provider) {
  const key = String(provider || '').toLowerCase();
  return PROVIDER_DISPLAY_NAMES[key] || String(provider || 'Agent');
}

function llmMessageEvent(message, conversation) {
  const role = String(message.role || 'system');
  const assistant = role !== 'user';
  return {
    kind: 'message',
    data: {
      from: assistant
        ? providerName(conversation.provider)
        : (message.from || config.nick || 'You'),
      text: message.text,
      time: message.time,
      mine: !assistant,
      icon: assistant ? conversation.icon : '',
      assistant
    }
  };
}

function llmCommandEvent(entry, conversation) {
  const message = entry.message || {};
  return {
    kind: 'command',
    data: {
      from: providerName(conversation.provider),
      command: entry.command,
      shell: entry.shell || 'shell',
      time: message.time || message.timestamp,
      icon: conversation.icon,
      assistant: false
    }
  };
}

function llmCodeEvent(entry, conversation) {
  const message = entry.message || {};
  return {
    kind: 'code',
    data: {
      from: providerName(conversation.provider),
      code: entry.code,
      language: entry.language || 'text',
      label: entry.label || 'Output',
      time: message.time || message.timestamp,
      icon: conversation.icon,
      assistant: false
    }
  };
}

function upsertLlmConversation(payload) {
  if (!payload?.target) return null;
  const conversation = ensureConversation(payload.target, payload.label, 'llm', payload);
  if (payload.loaded !== false) {
    conversation.events = richMessages.normalizeToolMessages(payload.messages || []).map((entry) => {
      if (entry.type === 'command') return llmCommandEvent(entry, conversation);
      if (entry.type === 'code') return llmCodeEvent(entry, conversation);
      return llmMessageEvent(entry.message, conversation);
    });
    conversation.hydrated = true;
  }
  if (conversation.target === activeTarget) {
    renderTranscript();
    renderUsers();
  }
  if (!deferConversationRender) renderConversations();
  return conversation;
}

async function loadLlmConversations() {
  if (!window.subjectiveChat.listLlmConversations) return;
  const q = String(conversationSearch?.value || '').trim();
  const result = await window.subjectiveChat.listLlmConversations({ limit: 200, q });
  if (!result?.ok) {
    rendererLog('error', 'Failed to load LLM conversations', { error: result?.error });
    return;
  }
  llmListTotal = Number(result.total || (result.conversations || []).length || 0);
  deferConversationRender += 1;
  try {
    for (const [target, conversation] of [...conversations.entries()]) {
      if (conversation.kind === 'llm') conversations.delete(target);
    }
    for (const conversation of result.conversations || []) upsertLlmConversation(conversation);
  } finally {
    deferConversationRender -= 1;
    renderConversations();
  }
}

function selectedLlmProvider() {
  return String(llmProviderSelect?.value || 'codex');
}

function llmProviderLabel(provider) {
  if (provider === 'claude') return 'Claude';
  if (provider === 'cursor') return 'Cursor';
  return 'Codex';
}

let pendingSessionChoice = null;

function openSessionPicker({ target, provider, text, sessions, currentUser }) {
  if (!sessionPickerDialog || !sessionPickerList) return;
  pendingSessionChoice = { target, provider, text, currentUser };
  const label = llmProviderLabel(provider);
  if (sessionPickerTitle) sessionPickerTitle.textContent = `Run ${label} as…`;
  if (sessionPickerSubtitle) {
    sessionPickerSubtitle.textContent = `${label} is not logged in as ${currentUser || 'this user'}. Pick an OS user whose ${label} CLI login to use.`;
  }
  sessionPickerList.replaceChildren();
  const users = Array.isArray(sessions) ? sessions : [];
  if (!users.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No other user accounts found on this computer.';
    sessionPickerList.appendChild(empty);
  }
  for (const user of users) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `session-choice${user.ready ? ' ready' : ''}`;
    button.dataset.username = user.username;
    const name = document.createElement('span');
    name.textContent = user.current ? `${user.username} (this process)` : user.username;
    const hint = document.createElement('small');
    hint.textContent = user.ready
      ? `${label} login found`
      : user.unknown
        ? `${label} login not readable from this process — pick to switch and check`
        : `no ${label} login file found — pick to sign in`;
    button.append(name, hint);
    button.addEventListener('click', () => chooseSessionUser(user.username));
    sessionPickerList.appendChild(button);
  }
  sessionPickerDialog.showModal ? sessionPickerDialog.showModal() : sessionPickerDialog.setAttribute('open', '');
}

async function chooseSessionUser(username) {
  const pending = pendingSessionChoice;
  if (sessionPickerDialog?.close) sessionPickerDialog.close();
  else sessionPickerDialog?.removeAttribute('open');
  if (!pending) return;
  const label = llmProviderLabel(pending.provider);
  if (username === pending.currentUser) {
    addEvent('system', {
      target: pending.target,
      text: `${label} has no login for ${username}. Run the ${label} CLI login in a terminal as that user, then retry.`
    });
    pendingSessionChoice = null;
    return;
  }
  pendingSessionChoice = { ...pending, retryUsername: username };
  if (!window.subjectiveChat.continueAsUser) {
    addEvent('system', { target: pending.target, text: `Cannot switch to ${username} from this client.` });
    return;
  }
  const result = await window.subjectiveChat.continueAsUser(pending.target, username);
  if (result?.conversation?.target && pending.text) {
    const sibling = result.conversation.target;
    pendingSessionChoice = null;
    await window.subjectiveChat.sendLlmMessage(sibling, pending.text);
    return;
  }
  if (!result?.ok) {
    addEvent('system', { target: pending.target, text: result?.error || `Could not continue as ${username}.` });
    pendingSessionChoice = null;
  }
}

if (sessionPickerCloseButton) {
  sessionPickerCloseButton.addEventListener('click', () => {
    pendingSessionChoice = null;
    sessionPickerDialog?.close?.();
  });
}
if (sessionPickerDialog) {
  sessionPickerDialog.addEventListener('click', (event) => {
    if (event.target === sessionPickerDialog) {
      pendingSessionChoice = null;
      sessionPickerDialog.close?.();
    }
  });
}

async function refreshLlmStatus() {
  const provider = selectedLlmProvider();
  const label = llmProviderLabel(provider);
  llmStatusText.textContent = `Checking ${label} datasource…`;
  llmStatusText.dataset.ready = 'false';
  const status = await window.subjectiveChat.getLlmStatus(provider);
  if (selectedLlmProvider() !== provider) return;
  llmStatusText.textContent = status.ok
    ? `Ready · ${status.cli_version || `${label} CLI`} · existing login`
    : `${status.status || 'Unavailable'} · ${status.error || `${label} CLI login required`}`;
  llmStatusText.dataset.ready = status.ok ? 'true' : 'false';
}

async function openLlmDialog() {
  if (!llmDialog) return;
  llmDialog.showModal ? llmDialog.showModal() : llmDialog.setAttribute('open', '');
  llmNameInput.focus();
  await refreshLlmStatus();
}

if (createLlmButton) createLlmButton.addEventListener('click', openLlmDialog);
if (llmProviderSelect) llmProviderSelect.addEventListener('change', refreshLlmStatus);
if (llmCloseButton) llmCloseButton.addEventListener('click', () => llmDialog.close());
if (llmDialog) llmDialog.addEventListener('click', (event) => {
  if (event.target === llmDialog) llmDialog.close();
});
if (llmForm) llmForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const provider = selectedLlmProvider();
  const result = await window.subjectiveChat.createLlmConversation({
    name: llmNameInput.value,
    workspace: llmWorkspaceInput.value,
    provider
  });
  if (!result?.ok) {
    llmStatusText.textContent = result?.error || `Could not create ${llmProviderLabel(provider)} conversation.`;
    llmStatusText.dataset.ready = 'false';
    return;
  }
  const conversation = upsertLlmConversation(result.conversation);
  llmDialog.close();
  llmNameInput.value = '';
  setActiveTarget(conversation.target);
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

if (accentGrid) {
  accentGrid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-accent]');
    if (!button) return;
    document.body.dataset.accent = button.dataset.accent;
    for (const swatch of accentGrid.querySelectorAll('.accent-swatch')) swatch.classList.remove('active');
    button.classList.add('active');
    localStorage.setItem('subjective-chat-accent', button.dataset.accent);
  });
}

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
      if (conversations.get(activeTarget)?.kind !== 'llm') renderUsers();
      break;
    case 'system':
      addEvent('system', event);
      break;
    case 'message':
      addEvent('message', event);
      break;
    case 'llm-conversation':
      upsertLlmConversation(event.conversation);
      break;
    case 'llm-history-refreshed':
      loadLlmConversations();
      break;
    case 'conversation-rename-request':
      beginRenameConversation(event.target);
      break;
    case 'llm-conversation-renamed': {
      const conversation = conversations.get(event.target);
      if (conversation) {
        conversation.label = event.label;
        if (event.target === activeTarget) {
          topChannel.textContent = event.label;
          topChannel.title = event.label;
        }
        renderConversations();
      }
      break;
    }
    case 'llm-choose-session':
      openSessionPicker(event);
      break;
    case 'llm-switch-user':
      // The new sibling conversation was already added via the llm-conversation event
      // just before this one; switch the view over to it now that it exists.
      if (conversations.has(event.target)) setActiveTarget(event.target);
      if (pendingSessionChoice?.retryUsername === event.osUser && pendingSessionChoice.text) {
        const text = pendingSessionChoice.text;
        pendingSessionChoice = null;
        window.subjectiveChat.sendLlmMessage(event.target, text);
      }
      break;
    case 'llm-message': {
      const conversation = conversations.get(event.target);
      if (conversation) {
        const entry = llmMessageEvent({ ...event.message, from: event.from }, conversation);
        // This is the authoritative echo of a message we may have already shown
        // optimistically (see addOptimisticLlmEcho) - drop our placeholder bubble so the
        // confirmed one takes its place instead of appearing twice.
        if (!entry.data.assistant && conversation.pendingEchoes?.length) {
          const echoIndex = conversation.pendingEchoes.indexOf(entry.data.text);
          if (echoIndex !== -1) {
            conversation.pendingEchoes.splice(echoIndex, 1);
            const optimisticIndex = conversation.events.findIndex((item) => item.data.optimistic && item.data.text === entry.data.text);
            if (optimisticIndex !== -1) conversation.events.splice(optimisticIndex, 1);
          }
        }
        addEvent(entry.kind, { ...entry.data, target: event.target });
      }
      break;
    }
    case 'llm-busy': {
      const conversation = conversations.get(event.target);
      if (conversation) {
        conversation.busy = event.busy;
        conversation.busySince = event.busy ? Date.now() : 0;
        if (event.target === activeTarget) {
          input.disabled = event.busy;
          input.placeholder = event.busy ? `${providerName(conversation.provider)} is working…` : `Message ${providerName(conversation.provider)}`;
          // Agent replies arrive before busy clears, so re-render to re-enable
          // the Allow/Deny and Run controls on the freshly rendered answer.
          renderTranscript();
        }
        renderConversations();
      }
      break;
    }
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

window.subjectiveChat.getConfig().then(async (appConfig) => {
  updateConfig(appConfig);
  activeTarget = config.channel;
  ensureConversation(config.channel, config.channel, 'channel');
  setActiveTarget(config.channel);
  await loadLlmConversations();
  mountMobileLayout();
  const savedAccent = localStorage.getItem('subjective-chat-accent') || 'gold';
  document.body.dataset.accent = savedAccent;
  if (accentGrid) {
    for (const swatch of accentGrid.querySelectorAll('.accent-swatch')) {
      swatch.classList.toggle('active', swatch.dataset.accent === savedAccent);
    }
  }
  const collapseChatsButton = document.getElementById('collapseChatsButton');
  if (collapseChatsButton) {
    const key = 'subjective-chat-chats-collapsed';
    const applyCollapsed = (collapsed) => {
      document.body.classList.toggle('chats-collapsed', collapsed);
      collapseChatsButton.setAttribute('aria-expanded', String(!collapsed));
      collapseChatsButton.title = collapsed ? 'Show chats' : 'Hide chats';
    };
    applyCollapsed(localStorage.getItem(key) === '1');
    collapseChatsButton.addEventListener('click', () => {
      const collapsed = !document.body.classList.contains('chats-collapsed');
      localStorage.setItem(key, collapsed ? '1' : '0');
      applyCollapsed(collapsed);
    });
  }
});
