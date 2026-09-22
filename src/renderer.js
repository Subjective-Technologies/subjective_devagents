const chatFrames = document.getElementById('chatFrames');
const frameLayoutPicker = document.getElementById('frameLayoutPicker');
const frameBroadcast = document.getElementById('frameBroadcast');
let transcript = document.getElementById('transcript');
let composer = document.getElementById('composer');
let input = document.getElementById('messageInput');
let pendingImagesEl = document.getElementById('pendingImages');
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
let commandPalette = document.getElementById('commandPalette');
const mobileMenuButton = document.getElementById('mobileMenuButton');
const mobileDrawer = document.getElementById('mobileDrawer');
const mobileDrawerClose = document.getElementById('mobileDrawerClose');
const mobileDrawerLabel = document.getElementById('mobileDrawerLabel');
const mobileTabsSlot = document.getElementById('mobileTabsSlot');
const mobileUsersSlot = document.getElementById('mobileUsersSlot');
const mobileNewChatSlot = document.getElementById('mobileNewChatSlot');
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
const importLlmButton = document.getElementById('importLlmButton');
const importLlmFileInput = document.getElementById('importLlmFileInput');
const llmDialog = document.getElementById('llmDialog');
const llmForm = document.getElementById('llmForm');
const llmCloseButton = document.getElementById('llmCloseButton');
const llmNameInput = document.getElementById('llmNameInput');
const llmWorkspaceInput = document.getElementById('llmWorkspaceInput');
const llmOsUserSelect = document.getElementById('llmOsUserSelect');
const llmOsUserRow = document.getElementById('llmOsUserRow');
const llmWorkspaceLabel = document.getElementById('llmWorkspaceLabel');
const llmOverSshToggle = document.getElementById('llmOverSshToggle');
const sshConnectionRow = document.getElementById('sshConnectionRow');
const sshConnectionSelect = document.getElementById('sshConnectionSelect');
const sshConnectionForm = document.getElementById('sshConnectionForm');
const sshHostInput = document.getElementById('sshHostInput');
const sshPortInput = document.getElementById('sshPortInput');
const sshUsernameInput = document.getElementById('sshUsernameInput');
const sshAuthSelect = document.getElementById('sshAuthSelect');
const sshKeyRow = document.getElementById('sshKeyRow');
const sshKeySelect = document.getElementById('sshKeySelect');
const sshPasswordRow = document.getElementById('sshPasswordRow');
const sshPasswordInput = document.getElementById('sshPasswordInput');
const sshPassphraseRow = document.getElementById('sshPassphraseRow');
const sshPassphraseInput = document.getElementById('sshPassphraseInput');
const sshHostKeySelect = document.getElementById('sshHostKeySelect');
const sshDirectoryInput = document.getElementById('sshDirectoryInput');
const sshNameInput = document.getElementById('sshNameInput');
const sshKeyUploadButton = document.getElementById('sshKeyUploadButton');
const sshKeyDeleteButton = document.getElementById('sshKeyDeleteButton');
const sshKeyFileInput = document.getElementById('sshKeyFileInput');
const sshTestButton = document.getElementById('sshTestButton');
const sshDeleteButton = document.getElementById('sshDeleteButton');
const sshTestStatus = document.getElementById('sshTestStatus');
const agentDialog = document.getElementById('agentDialog');
const agentForm = document.getElementById('agentForm');
const agentIdInput = document.getElementById('agentIdInput');
const agentCapabilityInput = document.getElementById('agentCapabilityInput');
const agentModelSelect = document.getElementById('agentModelSelect');
const agentDialogStatus = document.getElementById('agentDialogStatus');
const agentCloseButton = document.getElementById('agentCloseButton');
const agentEditDialog = document.getElementById('agentEditDialog');
const agentEditForm = document.getElementById('agentEditForm');
const agentEditTitle = document.getElementById('agentEditTitle');
const agentEditRoleFile = document.getElementById('agentEditRoleFile');
const agentEditTextarea = document.getElementById('agentEditTextarea');
const agentEditStatus = document.getElementById('agentEditStatus');
const agentEditCloseButton = document.getElementById('agentEditCloseButton');
const llmProviderSelect = document.getElementById('llmProviderSelect');
const llmStatusText = document.getElementById('llmStatusText');
const sessionPickerDialog = document.getElementById('sessionPickerDialog');
const sessionPickerTitle = document.getElementById('sessionPickerTitle');
const sessionPickerSubtitle = document.getElementById('sessionPickerSubtitle');
const sessionPickerList = document.getElementById('sessionPickerList');
const sessionPickerCloseButton = document.getElementById('sessionPickerCloseButton');
const suLoginDialog = document.getElementById('suLoginDialog');
const suLoginForm = document.getElementById('suLoginForm');
const suLoginTitle = document.getElementById('suLoginTitle');
const suLoginSubtitle = document.getElementById('suLoginSubtitle');
const suLoginStatus = document.getElementById('suLoginStatus');
const suLoginLog = document.getElementById('suLoginLog');
const suLoginInput = document.getElementById('suLoginInput');
const suLoginCloseButton = document.getElementById('suLoginCloseButton');
const suLoginTerminalLink = document.getElementById('suLoginTerminalLink');
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
  if (!commandPalette) return;
  commandPalette.hidden = true;
  commandPalette.replaceChildren();
}

function renderCommandPalette(items) {
  commandMatches = items;
  commandMatchIndex = 0;
  if (!commandPalette) return;
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

function fitAppToWindow() {
  const vv = window.visualViewport;
  const candidates = [
    vv?.height,
    window.innerHeight,
    document.documentElement.clientHeight
  ].filter((n) => typeof n === 'number' && n > 0);
  const height = Math.max(1, Math.round(Math.min(...(candidates.length ? candidates : [600]))));
  const offsetTop = Math.max(0, Math.round(vv?.offsetTop || 0));
  const offsetLeft = Math.max(0, Math.round(vv?.offsetLeft || 0));
  const root = document.documentElement;
  root.style.setProperty('--app-height', `${height}px`);
  root.style.setProperty('--app-offset-top', `${offsetTop}px`);
  root.style.setProperty('--app-offset-left', `${offsetLeft}px`);
}

fitAppToWindow();
window.addEventListener('resize', fitAppToWindow);
window.visualViewport?.addEventListener('resize', fitAppToWindow);
window.visualViewport?.addEventListener('scroll', fitAppToWindow);

/** Max rows/cols in the Excel-style layout matrix (hover a×b, click to apply). */
const FRAME_LAYOUT_MAX = 4;
const LEGACY_CHAT_FRAME_LAYOUTS = Object.freeze({
  single: { rows: 1, cols: 1 },
  'split-h': { rows: 1, cols: 2 },
  'split-v': { rows: 2, cols: 1 },
  quad: { rows: 2, cols: 2 }
});
const CHAT_FRAME_STORAGE = 'subjective-chat-frames';
let chatFrameRows = 1;
let chatFrameCols = 1;
let frameTargets = [''];
let focusedFrame = 0;
let frameLayoutMenuOpen = false;

function framesEnabled() {
  return Boolean(chatFrames);
}

function frameLayoutCount() {
  return Math.max(1, chatFrameRows * chatFrameCols);
}

function frameLayoutKey() {
  return `${chatFrameRows}x${chatFrameCols}`;
}

function clampFrameDim(n) {
  const value = Math.floor(Number(n));
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(FRAME_LAYOUT_MAX, value);
}

function parseFrameLayout(saved) {
  if (!saved || typeof saved !== 'object') return { rows: 1, cols: 1 };
  if (saved.rows != null || saved.cols != null) {
    return { rows: clampFrameDim(saved.rows), cols: clampFrameDim(saved.cols) };
  }
  const key = String(saved.layout || '');
  if (LEGACY_CHAT_FRAME_LAYOUTS[key]) return { ...LEGACY_CHAT_FRAME_LAYOUTS[key] };
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(key);
  if (match) return { rows: clampFrameDim(match[1]), cols: clampFrameDim(match[2]) };
  return { rows: 1, cols: 1 };
}

function setChatFrameLayout(rows, cols, options = {}) {
  chatFrameRows = clampFrameDim(rows);
  chatFrameCols = clampFrameDim(cols);
  if (options.apply === false) return;
  ensureChatFrameDom();
  if (options.render !== false) renderVisibleFrameTranscripts();
  persistChatFrames();
  syncFrameLayoutPicker();
}

function visibleFrameTargets() {
  return frameTargets.slice(0, frameLayoutCount()).filter(Boolean);
}

function isTargetOnScreen(target) {
  if (!framesEnabled()) return target === activeTarget;
  return visibleFrameTargets().includes(target);
}

// Nothing may save a layout before restoreChatFrames() has loaded the stored one.
// updateConfig() activates the default channel on startup - through setActiveTarget ->
// assignChatFrame -> persistChatFrames - and that runs before initChatFrames(), so an
// unguarded save overwrote the saved panes with the 1x1 default and restore then read
// back the value it had just destroyed. The multi-pane layout never survived a reload.
let chatFramesRestored = false;

function persistChatFrames() {
  if (!framesEnabled() || !chatFramesRestored) return;
  try {
    localStorage.setItem(CHAT_FRAME_STORAGE, JSON.stringify({
      layout: frameLayoutKey(),
      rows: chatFrameRows,
      cols: chatFrameCols,
      targets: frameTargets,
      focused: focusedFrame,
      broadcast: Boolean(frameBroadcast?.checked)
    }));
  } catch (_error) {
    /* ignore quota / private mode */
  }
}

function restoreChatFrames() {
  if (!framesEnabled()) return;
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_FRAME_STORAGE) || 'null');
    if (!saved) return;
    const parsed = parseFrameLayout(saved);
    if (isMobileLayout()) {
      chatFrameRows = 1;
      chatFrameCols = 1;
    } else {
      chatFrameRows = parsed.rows;
      chatFrameCols = parsed.cols;
    }
    const count = frameLayoutCount();
    frameTargets = Array.from({ length: count }, (_, index) => String(saved.targets?.[index] || ''));
    focusedFrame = Math.min(Math.max(0, Number(saved.focused) || 0), count - 1);
    if (frameBroadcast) frameBroadcast.checked = Boolean(saved.broadcast);
  } catch (_error) {
    chatFrameRows = 1;
    chatFrameCols = 1;
    frameTargets = [''];
    focusedFrame = 0;
  }
}

function bindFocusedFrameDom(frameEl) {
  if (!frameEl) return;
  transcript = frameEl.querySelector('.transcript');
  composer = frameEl.querySelector('.composer');
  input = frameEl.querySelector('textarea');
  pendingImagesEl = frameEl.querySelector('.pending-images');
  commandPalette = frameEl.querySelector('.command-palette');
}

function attachFrameComposer(frameEl) {
  const form = frameEl.querySelector('.composer');
  const textarea = frameEl.querySelector('textarea');
  if (!form || form.dataset.bound === '1') return;
  form.dataset.bound = '1';
  attachImagePicker(form);
  form.addEventListener('submit', onComposerSubmit);
  const stopButton = frameEl.querySelector('.frame-stop');
  if (stopButton) {
    stopButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      stopActiveTurn(frameEl);
    });
  }
  textarea.addEventListener('keydown', onComposerKeydown);
  textarea.addEventListener('input', () => updateCommandPalette());
  textarea.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (document.activeElement !== input) hideCommandPalette();
    }, 120);
  });
  textarea.addEventListener('paste', onComposerPaste);
}

function createChatFrame(index) {
  const frame = document.createElement('article');
  frame.className = 'chat-frame';
  frame.dataset.frame = String(index);
  frame.tabIndex = 0;
  frame.innerHTML = `
    <header class="frame-head">
      <img class="frame-icon provider-icon" alt="" hidden>
      <strong class="frame-title">Drop a chat here</strong>
      <button type="button" class="frame-refresh" hidden title="Refresh chat" aria-label="Refresh chat">↻</button>
      <button type="button" class="frame-clear" hidden title="Clear pane" aria-label="Clear pane">×</button>
    </header>
    <div class="transcript" aria-live="polite"></div>
    <form class="composer">
      <div class="pending-images" hidden></div>
      <textarea rows="1" autocomplete="off" placeholder="Drop a chat from the list"></textarea>
      <div class="command-palette" hidden></div>
      <button type="button" class="frame-stop" hidden title="Stop this agent" aria-label="Stop this agent">Stop</button>
      <button type="submit">Send</button>
    </form>
  `;
  // `click`, not `pointerdown`. Focusing re-renders the pane, and on pointerdown
  // that happened *between* the press and the release — so the element under the
  // cursor was replaced before the browser could raise a click on it, and every
  // button inside a pane silently did nothing. On click the button's own handler
  // has already run by the time this bubbles up.
  frame.addEventListener('click', () => focusChatFrame(Number(frame.dataset.frame)));
  frame.querySelector('.frame-refresh').addEventListener('click', (event) => {
    event.stopPropagation();
    refreshChatFrame(index);
  });
  frame.querySelector('.frame-clear').addEventListener('click', (event) => {
    event.stopPropagation();
    assignChatFrame(index, '');
  });
  frame.addEventListener('dragover', (event) => {
    if (![...event.dataTransfer.types].includes('application/x-subjective-chat')) return;
    event.preventDefault();
    frame.classList.add('is-drop');
  });
  frame.addEventListener('dragleave', () => frame.classList.remove('is-drop'));
  frame.addEventListener('drop', (event) => {
    event.preventDefault();
    frame.classList.remove('is-drop');
    const target = event.dataTransfer.getData('application/x-subjective-chat');
    if (target) assignChatFrame(index, target);
  });
  attachFrameComposer(frame);
  return frame;
}

function syncChatFrame(frameEl, index) {
  const target = frameTargets[index] || '';
  const conversation = target ? conversations.get(target) : null;
  frameEl.classList.toggle('is-focused', index === focusedFrame);
  frameEl.classList.toggle('is-empty', !target);
  const title = frameEl.querySelector('.frame-title');
  const icon = frameEl.querySelector('.frame-icon');
  const refresh = frameEl.querySelector('.frame-refresh');
  const clear = frameEl.querySelector('.frame-clear');
  const textarea = frameEl.querySelector('textarea');
  title.textContent = conversation?.label || (target ? target : 'Drop a chat here');
  title.title = title.textContent;
  if (icon) {
    icon.hidden = !conversation?.icon;
    icon.src = conversation?.icon || '';
    icon.alt = conversation?.provider || '';
  }
  if (refresh) refresh.hidden = !target;
  if (clear) clear.hidden = !target;
  const stop = frameEl.querySelector('.frame-stop');
  if (stop) {
    // Only while this pane's own agent is working. The composer is disabled then, so
    // without this there is no way to interrupt a turn at all.
    stop.hidden = !(conversation && conversation.busy);
    stop.disabled = false;
  }
  const send = frameEl.querySelector('button[type="submit"]');
  if (send) send.hidden = Boolean(conversation && conversation.busy);
  if (textarea) {
    // Busy no longer disables the composer: a disabled control cannot hold focus,
    // so sending a message took the cursor out of the box and the next message
    // could not be typed without clicking back in. An agent turn can run for
    // minutes; composing the next message during one is normal. Only sending is
    // gated — see onComposerSubmit.
    textarea.disabled = Boolean(conversation?.kind === 'llm' && !conversation.writable);
    textarea.placeholder = !conversation
      ? 'Drop a chat from the list'
      : (conversation.kind === 'llm' && !conversation.writable
        ? `${providerName(conversation.provider)} history is read-only`
        : (conversation.busy
          ? `${providerName(conversation.provider)} is working…`
          : `Message ${providerName(conversation.provider) || conversation.label}`));
  }
}

function ensureChatFrameDom() {
  if (!framesEnabled()) return;
  if (isMobileLayout()) {
    chatFrameRows = 1;
    chatFrameCols = 1;
  }
  const count = frameLayoutCount();
  chatFrames.dataset.layout = frameLayoutKey();
  chatFrames.style.setProperty('--frame-rows', String(chatFrameRows));
  chatFrames.style.setProperty('--frame-cols', String(chatFrameCols));
  frameTargets = Array.from({ length: count }, (_, index) => frameTargets[index] || '');
  if (focusedFrame >= count) focusedFrame = 0;
  while (chatFrames.children.length > count) chatFrames.lastElementChild.remove();
  while (chatFrames.children.length < count) {
    chatFrames.appendChild(createChatFrame(chatFrames.children.length));
  }
  [...chatFrames.children].forEach((frameEl, index) => {
    frameEl.dataset.frame = String(index);
    syncChatFrame(frameEl, index);
  });
  syncFrameLayoutPicker();
  bindFocusedFrameDom(chatFrames.children[focusedFrame]);
}

function renderFrameTranscript(frameEl, target) {
  const node = frameEl?.querySelector('.transcript');
  if (!node) return;
  const previous = transcript;
  transcript = node;
  if (!target) {
    node.replaceChildren();
    const empty = document.createElement('article');
    empty.className = 'entry system-entry frame-empty-hint';
    empty.innerHTML = '<div class="bubble">Drag a chat from the list, or click one to open it here.</div>';
    node.appendChild(empty);
    transcript = previous;
    return;
  }
  const conversation = ensureConversation(target);
  renderOneTranscript(conversation);
  frameEl.dataset.renderedCount = String(conversation.events.length);
  if (frameEl === chatFrames.children[focusedFrame]) {
    transcriptTarget = conversation.target;
    transcriptRenderedCount = conversation.events.length;
  }
  transcript = previous;
}

function focusChatFrame(index, options = {}) {
  if (!framesEnabled()) return;
  const count = frameLayoutCount();
  if (index < 0 || index >= count) return;
  // Focusing the pane that already has focus is not a state change, and doing the
  // work anyway meant every click inside it rebuilt its transcript.
  if (index === focusedFrame && frameTargets[index] === activeTarget) return;
  focusedFrame = index;
  bindFocusedFrameDom(chatFrames.children[index]);
  const target = frameTargets[index];
  if (target && !options.skipActive) setActiveTarget(target, { skipFrame: true });
  ensureChatFrameDom();
  persistChatFrames();
}

function assignChatFrame(index, target, options = {}) {
  if (!framesEnabled()) return;
  const next = String(target || '');
  if (next) {
    const existing = frameTargets.indexOf(next);
    if (existing >= 0 && existing !== index) {
      focusChatFrame(existing);
      return;
    }
  }
  frameTargets[index] = next;
  focusedFrame = index;
  persistChatFrames();
  if (next && !options.skipActive) setActiveTarget(next, { skipFrame: true });
  ensureChatFrameDom();
  renderVisibleFrameTranscripts();
}

function renderVisibleFrameTranscripts() {
  if (!framesEnabled()) return;
  ensureChatFrameDom();
  [...chatFrames.children].forEach((frameEl, index) => {
    renderFrameTranscript(frameEl, frameTargets[index]);
  });
}

function paintFrameLayoutMatrix(hoverRows, hoverCols) {
  const matrix = document.getElementById('frameLayoutMatrix');
  const caption = document.getElementById('frameLayoutCaption');
  if (!matrix) return;
  const rows = clampFrameDim(hoverRows || chatFrameRows);
  const cols = clampFrameDim(hoverCols || chatFrameCols);
  for (const cell of matrix.querySelectorAll('.frame-layout-cell')) {
    const r = Number(cell.dataset.row);
    const c = Number(cell.dataset.col);
    const inHover = r <= rows && c <= cols;
    const inActive = r <= chatFrameRows && c <= chatFrameCols;
    cell.classList.toggle('is-hover', inHover);
    cell.classList.toggle('is-active', inActive);
    cell.setAttribute('aria-pressed', String(r === chatFrameRows && c === chatFrameCols));
  }
  if (caption) caption.textContent = `${rows} × ${cols}`;
}

function syncFrameLayoutPicker() {
  const label = document.getElementById('frameLayoutLabel');
  const mini = document.getElementById('frameLayoutMini');
  const toggle = document.getElementById('frameLayoutToggle');
  if (label) label.textContent = frameLayoutKey().replace('x', '×');
  if (toggle) {
    toggle.title = `Chat layout ${chatFrameRows}×${chatFrameCols}`;
    toggle.setAttribute('aria-label', `Chat layout ${chatFrameRows} by ${chatFrameCols}`);
  }
  if (mini) {
    mini.style.setProperty('--mini-rows', String(chatFrameRows));
    mini.style.setProperty('--mini-cols', String(chatFrameCols));
    mini.replaceChildren();
    for (let i = 0; i < chatFrameRows * chatFrameCols; i += 1) {
      mini.appendChild(document.createElement('span'));
    }
  }
  paintFrameLayoutMatrix(chatFrameRows, chatFrameCols);
}

function closeFrameLayoutMenu() {
  const popover = document.getElementById('frameLayoutPopover');
  const toggle = document.getElementById('frameLayoutToggle');
  if (popover) popover.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  frameLayoutMenuOpen = false;
  paintFrameLayoutMatrix(chatFrameRows, chatFrameCols);
}

function openFrameLayoutMenu() {
  const popover = document.getElementById('frameLayoutPopover');
  const toggle = document.getElementById('frameLayoutToggle');
  if (popover) popover.hidden = false;
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  frameLayoutMenuOpen = true;
  paintFrameLayoutMatrix(chatFrameRows, chatFrameCols);
}

function buildFrameLayoutMatrix() {
  const matrix = document.getElementById('frameLayoutMatrix');
  if (!matrix || matrix.dataset.ready === '1') return;
  matrix.dataset.ready = '1';
  matrix.style.setProperty('--matrix-max', String(FRAME_LAYOUT_MAX));
  matrix.replaceChildren();
  for (let row = 1; row <= FRAME_LAYOUT_MAX; row += 1) {
    for (let col = 1; col <= FRAME_LAYOUT_MAX; col += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'frame-layout-cell';
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute('role', 'gridcell');
      cell.title = `${row} × ${col}`;
      cell.setAttribute('aria-label', `${row} by ${col} chats`);
      cell.addEventListener('pointerenter', () => paintFrameLayoutMatrix(row, col));
      cell.addEventListener('focus', () => paintFrameLayoutMatrix(row, col));
      cell.addEventListener('click', (event) => {
        event.preventDefault();
        if (isMobileLayout()) return;
        setChatFrameLayout(row, col);
        closeFrameLayoutMenu();
      });
      matrix.appendChild(cell);
    }
  }
  matrix.addEventListener('pointerleave', () => paintFrameLayoutMatrix(chatFrameRows, chatFrameCols));
}

function initChatFrames() {
  if (!framesEnabled()) return;
  restoreChatFrames();
  chatFramesRestored = true;
  buildFrameLayoutMatrix();
  ensureChatFrameDom();
  const toggle = document.getElementById('frameLayoutToggle');
  if (toggle) {
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (isMobileLayout()) return;
      if (frameLayoutMenuOpen) closeFrameLayoutMenu();
      else openFrameLayoutMenu();
    });
  }
  document.addEventListener('pointerdown', (event) => {
    if (!frameLayoutMenuOpen || !frameLayoutPicker) return;
    if (frameLayoutPicker.contains(event.target)) return;
    closeFrameLayoutMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && frameLayoutMenuOpen) closeFrameLayoutMenu();
  });
  if (frameBroadcast) {
    frameBroadcast.addEventListener('change', persistChatFrames);
  }
}

async function rehydrateConversation(target, { force = false } = {}) {
  const conversation = conversations.get(target);
  if (!conversation || conversation.kind !== 'llm') return;
  if (conversation.loading || conversation.busy) return;
  if (!force && conversation.hydrated) return;
  conversation.loading = true;
  if (force) conversation.hydrated = false;
  if (isTargetOnScreen(target)) renderTranscript();
  rendererLog('info', 'Rehydrate conversation start', {
    target,
    force,
    provider: conversation.provider,
    label: conversation.label
  });
  try {
    const result = await window.subjectiveChat.getLlmConversation(target);
    conversation.loading = false;
    rendererLog(result?.ok ? 'info' : 'error', 'Rehydrate conversation done', {
      target,
      ok: Boolean(result?.ok),
      error: result?.error || '',
      messageCount: result?.conversation?.messages?.length || 0
    });
    if (result?.ok) upsertLlmConversation(result.conversation);
    else if (force) addEvent('system', { target, text: result?.error || 'Could not refresh conversation history.' });
  } catch (error) {
    conversation.loading = false;
    rendererLog('error', 'Rehydrate conversation crashed', { target, message: error.message });
    if (force) addEvent('system', { target, text: error.message || 'Could not refresh conversation history.' });
  }
}

async function refreshChatFrame(index) {
  if (!framesEnabled()) return;
  const frameEl = chatFrames.children[index];
  const button = frameEl?.querySelector('.frame-refresh');
  if (button?.disabled) return;
  const target = frameTargets[index] || '';
  if (button) {
    button.disabled = true;
    button.classList.add('is-busy');
  }
  rendererLog('info', 'Frame refresh start', { index, target });
  try {
    const targets = new Set(visibleFrameTargets());
    if (target) targets.add(target);
    const reloadOne = window.subjectiveChat.reloadLlmConversation
      || ((item) => window.subjectiveChat.getLlmConversation(item));
    await Promise.all([...targets].map(async (item) => {
      const conversation = conversations.get(item);
      if (conversation?.busy) return;
      if (conversation) {
        conversation.hydrated = false;
        conversation.loading = true;
      }
      const result = await reloadOne(item);
      if (conversation) conversation.loading = false;
      if (result?.ok && result.conversation) {
        upsertLlmConversation(result.conversation);
        rendererLog('info', 'Frame live reload ok', {
          target: item,
          messageCount: result.conversation.messages?.length || 0
        });
      } else {
        rendererLog('error', 'Frame live reload failed', { target: item, error: result?.error || '' });
        addEvent('system', { target: item, text: result?.error || 'Could not reload this chat from the IDE.' });
      }
    }));
    if (target) {
      const conversation = conversations.get(target);
      const count = conversation?.events?.filter((event) => event.kind === 'message' || event.kind === 'code' || event.kind === 'command').length || 0;
      addEvent('system', { target, text: `Reloaded from ${conversation?.provider || 'IDE'} (${count} messages).` });
    }
  } catch (error) {
    rendererLog('error', 'Frame refresh crashed', { index, target, message: error.message });
    if (target) addEvent('system', { target, text: error.message || 'Refresh failed.' });
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-busy');
    }
    rendererLog('info', 'Frame refresh done', { index, target });
  }
}

// Where each node lived before the drawer borrowed it, so widening the viewport
// (rotating a phone to landscape, dragging the iframe wider) can put it back.
const mobileNodeHomes = new WeakMap();

function mountNode(node, slot) {
  if (!node || !slot) return;
  if (slot.contains(node)) return;
  if (!mobileNodeHomes.has(node) && node.parentNode) {
    mobileNodeHomes.set(node, { parent: node.parentNode, next: node.nextSibling });
  }
  slot.replaceChildren(node);
}

function unmountNode(node) {
  const home = node && mobileNodeHomes.get(node);
  if (!home || !home.parent) return;
  if (node.parentNode === home.parent) return;
  home.parent.insertBefore(node, home.next && home.next.parentNode === home.parent ? home.next : null);
}

function mobileMovableNodes() {
  return [conversationBrowser || conversationList, usersPane, accentPanel, topbarMeta, topActions, createLlmButton];
}

function mountMobileLayout() {
  if (!isMobileLayout() || mobileMounted) return;
  mountNode(conversationBrowser || conversationList, mobileTabsSlot);
  mountNode(usersPane, mobileUsersSlot);
  mountNode(accentPanel, mobileAppearanceSlot);
  mountNode(topbarMeta, mobileTopbarMetaSlot);
  mountNode(topActions, mobileTopActionsSlot);
  mountNode(createLlmButton, mobileNewChatSlot);
  mobileMounted = true;
}

// Without this the borrowed panels stay stranded in a closed dialog once the
// viewport grows back past 720px, and the rail comes back empty.
function unmountMobileLayout() {
  if (!mobileMounted) return;
  for (const node of mobileMovableNodes()) unmountNode(node);
  mobileMounted = false;
}

function syncMobileLayout() {
  fitAppToWindow();
  if (isMobileLayout()) {
    mountMobileLayout();
    if (framesEnabled() && (chatFrameRows !== 1 || chatFrameCols !== 1)) {
      chatFrameRows = 1;
      chatFrameCols = 1;
      ensureChatFrameDom();
      renderVisibleFrameTranscripts();
      persistChatFrames();
    }
    return;
  }
  if (mobileDrawer && mobileDrawer.open) closeMobileDrawer();
  unmountMobileLayout();
}

function setMobileDrawerTab(name) {
  // Builds differ: the Android shell has no "conversations" panel (chats live in
  // an always-visible strip), the web build has no "appearance" panel. Fall back
  // to the first tab that exists rather than activating nothing.
  const known = mobileDrawerTabs.map((tab) => tab.dataset.mobileDrawerTab);
  const target = known.includes(name) ? name : known[0];
  for (const tab of mobileDrawerTabs) {
    tab.classList.toggle('active', tab.dataset.mobileDrawerTab === target);
  }
  for (const panel of mobileDrawerPanels) {
    panel.classList.toggle('active', panel.dataset.mobileDrawerPanel === target);
  }
}

function openMobileDrawer(tabName = 'conversations') {
  if (!mobileDrawer) return;
  syncMobileLayout();
  setMobileDrawerTab(tabName);
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

function isGenericProviderLabel(label) {
  return /^(cursor|codex|claude|chatgpt|gemini|grok|chat)\s+conversation$/i.test(String(label || '').trim());
}

function preferConversationLabel(existing, incoming, provider) {
  const next = String(incoming || '').trim();
  const prev = String(existing || '').trim();
  if (!next) return prev;
  if (prev && isGenericProviderLabel(next, provider) && !isGenericProviderLabel(prev, provider)) return prev;
  return next;
}

function ensureConversation(target, label = target, kind = target.startsWith('#') ? 'channel' : 'dm', metadata = {}) {
  if (!conversations.has(target)) {
    conversations.set(target, { target, label, kind, events: [], unread: 0, updatedAt: 0, sortAt: 0, ...metadata });
  } else if (metadata && Object.keys(metadata).length) {
    const conversation = conversations.get(target);
    const latestTimestamp = Math.max(Number(conversation.updatedAt || 0), Number(metadata.updatedAt || 0));
    const latestSortTimestamp = Math.max(Number(conversation.sortAt || 0), Number(metadata.sortAt || 0));
    const keepLabel = preferConversationLabel(conversation.label, label, metadata.provider || conversation.provider);
    Object.assign(conversation, metadata, {
      target,
      label: keepLabel,
      kind,
      updatedAt: latestTimestamp,
      sortAt: latestSortTimestamp
    });
  }
  if (!deferConversationRender) renderConversations();
  return conversations.get(target);
}

function setActiveTarget(target, options = {}) {
  if (mobileDrawer && mobileDrawer.open) closeMobileDrawer();
  const conversation = ensureConversation(target);
  // Re-selecting the chat that is already open rebuilds its transcript for no
  // reason, which throws away whatever the reader was in the middle of — a text
  // selection, a hovered button, or a press that has not been released yet.
  const unchanged = activeTarget === target;
  activeTarget = target;
  if (framesEnabled() && !options.skipFrame) assignChatFrame(focusedFrame, target, { skipActive: true });
  conversation.unread = 0;
  topChannel.textContent = conversation.label;
  topChannel.title = conversation.label;
  input.disabled = conversation.kind === 'llm' && !conversation.writable;
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
  if (!unchanged) renderTranscript();
  renderUsers();
  if (conversation.kind === 'llm' && !conversation.hydrated && !conversation.loading) {
    conversation.loading = true;
    rendererLog('info', 'Hydrate conversation start', {
      target,
      provider: conversation.provider,
      label: conversation.label,
      sessionId: conversation.sessionId || '',
      origin: conversation.origin || ''
    });
    renderTranscript();
    window.subjectiveChat.getLlmConversation(target).then((result) => {
      conversation.loading = false;
      rendererLog(result?.ok ? 'info' : 'error', 'Hydrate conversation done', {
        target,
        ok: Boolean(result?.ok),
        error: result?.error || '',
        messageCount: result?.conversation?.messages?.length || 0,
        label: result?.conversation?.label || conversation.label
      });
      if (result?.ok) upsertLlmConversation(result.conversation);
      else addEvent('system', { target, text: result?.error || 'Could not load conversation history.' });
    });
  }
  if (conversation.kind === 'llm' && window.subjectiveChat.activateLlmConversation) {
    window.subjectiveChat.activateLlmConversation(target).then((result) => {
      if (result?.channel) identityLabel.textContent = `${conversation.provider} · ${result.channel} · ${conversation.workspace}`;
      // Authoritative recovery for a conversation whose buttons got stuck disabled by a
      // missed llm-busy:false (e.g. a dropped websocket mid-turn). Unlike the one-time
      // hydrate fetch above (gated on !conversation.hydrated), activation runs every time
      // this conversation is opened, so this is what actually self-heals it for as long as
      // the tab stays open, not just the first time ever.
      if (typeof result?.busy === 'boolean' && result.busy !== conversation.busy) {
        conversation.busy = result.busy;
        conversation.busySince = result.busy ? (conversation.busySince || Date.now()) : 0;
        if (!result.busy) conversation.progress = '';
        if (target === activeTarget) {
          if (input) {
            input.disabled = conversation.kind === 'llm' && !conversation.writable;
            input.placeholder = conversation.busy
              ? `${providerName(conversation.provider)} is working…`
              : `Message ${providerName(conversation.provider)}`;
          }
          renderTranscript();
        }
        renderConversations();
      }
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
  if (!isTargetOnScreen(target) || (framesEnabled() && target !== activeTarget)) conversation.unread += 1;
  if (isTargetOnScreen(target) && !appendTranscriptEntry(conversation)) renderTranscript();
  renderConversations();
}

// A new message used to redraw the whole transcript: markdown-it and highlight.js re-ran
// over every earlier message (~110ms in a 200-message chat, on the main thread, for each
// arriving message). Appending the single new entry is the same DOM, ~1ms. Falls back to
// a full render whenever the transcript is not exactly one event behind the model.
function appendTranscriptEntry(conversation) {
  if (pendingTranscriptRender) return false;          // a full render is already queued
  if (framesEnabled()) {
    const frameIndex = frameTargets.indexOf(conversation.target);
    if (frameIndex < 0) return false;
    const frameEl = chatFrames.children[frameIndex];
    if (frameEl) transcript = frameEl.querySelector('.transcript');
  } else if (conversation.target !== activeTarget) {
    return false;
  }
  if (transcriptTarget !== conversation.target && !framesEnabled()) return false;
  if (conversation.loading) return false;
  if (!transcript) return false;
  const events = conversation.events;
  const frameEl = framesEnabled() ? chatFrames.children[frameTargets.indexOf(conversation.target)] : null;
  const renderedCount = frameEl
    ? Number(frameEl.dataset.renderedCount || -1)
    : transcriptRenderedCount;
  if (renderedCount !== events.length - 1) return false;
  const index = events.length - 1;
  // Action buttons belong to the final assistant message only, so the entry that was last
  // until now has to give them up. renderEntry() emits exactly one .entry per event, which
  // is what makes this positional lookup safe.
  const previous = events[index - 1];
  if (previous && previous.data.assistant) {
    const rendered = transcript.querySelectorAll('.entry:not(.thinking-entry)');
    const stale = rendered[index - 1];
    if (!stale) return false;
    stale.replaceWith(renderEntry(previous.kind, previous.data, { conversation, actionable: false }));
  }
  // Only follow new messages down if the reader was already at the bottom - otherwise
  // someone scrolled up to read history (or is mid-selection) and an incoming message
  // would yank the view out from under them.
  const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 80;
  const event = events[index];
  const node = renderEntry(event.kind, event.data, {
    conversation,
    actionable: Boolean(event.data.assistant)
  });
  const thinking = transcript.querySelector('.thinking-entry');
  if (thinking) transcript.insertBefore(node, thinking);
  else transcript.appendChild(node);
  // The message that *starts* a turn arrives through this fast path, and the thinking
  // row is only ever built by a full render — so the pane showed the sent message and
  // then nothing at all for the rest of the turn: no verb, no steps, no elapsed clock.
  // Only the composer's placeholder and the Stop button said anything was happening.
  if (!thinking && conversation.kind === 'llm' && conversation.busy) {
    transcript.appendChild(renderThinkingRow(conversation));
    startThinkingAnimation();
  }
  transcriptRenderedCount = events.length;
  if (frameEl) frameEl.dataset.renderedCount = String(events.length);
  if (nearBottom) transcript.scrollTop = transcript.scrollHeight;
  return true;
}

const THINKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const THINKING_VERBS = ['Thinking', 'Processing', 'Percolating', 'Pondering', 'Noodling', 'Computing', 'Deliberating', 'Ruminating'];
const THINKING_FRAME_MS = 90;
const THINKING_VERB_MS = 4000;
let thinkingTimer = null;
let thinkingFrame = 0;

function tickThinkingRow() {
  const roots = framesEnabled() ? [...chatFrames.querySelectorAll('.transcript')] : (transcript ? [transcript] : []);
  const rows = roots.flatMap((node) => [...node.querySelectorAll('.thinking-entry')]);
  if (!rows.length) {
    stopThinkingAnimation();
    return;
  }
  thinkingFrame += 1;
  for (const row of rows) {
    const elapsed = Math.max(0, Date.now() - Number(row.dataset.since || Date.now()));
    const spinner = row.querySelector('.thinking-spinner');
    const verb = row.querySelector('.thinking-verb');
    const clock = row.querySelector('.thinking-elapsed');
    if (spinner) spinner.textContent = THINKING_FRAMES[thinkingFrame % THINKING_FRAMES.length];
    if (verb) {
      const target = row.dataset.target;
      const live = target && conversations.get(target)?.progress;
      verb.textContent = live || THINKING_VERBS[Math.floor(elapsed / THINKING_VERB_MS) % THINKING_VERBS.length];
    }
    if (clock) clock.textContent = `${Math.floor(elapsed / 1000)}s`;
  }
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
  item.dataset.target = conversation.target || '';
  const avatar = conversation.icon
    ? `<img class="avatar provider-avatar" src="${escapeHtml(conversation.icon)}" alt="${escapeHtml(providerName(conversation.provider))}">`
    : `<div class="avatar">${initials(providerName(conversation.provider))}</div>`;
  const steps = Array.isArray(conversation.thoughts) ? conversation.thoughts : [];
  item.innerHTML = `
    ${avatar}
    <div class="thinking-bubble" role="status" aria-live="polite">
      <div class="thinking-headline">
        <span class="thinking-spinner" aria-hidden="true">${THINKING_FRAMES[0]}</span>
        <span class="thinking-verb">${escapeHtml(conversation.progress || 'Working')}</span>
        <span class="thinking-ellipsis" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="thinking-elapsed">0s</span>
      </div>
      ${renderThinkingSteps(steps)}
    </div>
  `;
  return item;
}

// The agent's status stream, kept as an accumulating list rather than a single line that
// overwrites itself — so a turn's reasoning reads as steps you can scroll back through. The
// latest step stays visible in the headline; the rest fold into a disclosure that remembers
// whether the reader opened it (updateThinkingSteps preserves the `open` state on refresh).
function renderThinkingSteps(steps) {
  if (!steps || steps.length <= 1) return '<div class="thinking-steps" hidden></div>';
  const rows = steps
    .map((step) => `<li class="thinking-step">${escapeHtml(step)}</li>`)
    .join('');
  return `
    <details class="thinking-steps">
      <summary>${steps.length} steps</summary>
      <ol class="thinking-step-list">${rows}</ol>
    </details>
  `;
}

function updateThinkingSteps(target, conversation) {
  const bubble = document.querySelector(`.thinking-entry[data-target="${CSS.escape(target)}"] .thinking-bubble`);
  if (!bubble) return;
  const verb = bubble.querySelector('.thinking-verb');
  if (verb) verb.textContent = conversation.progress || 'Working';
  const existing = bubble.querySelector('.thinking-steps');
  const wasOpen = existing && existing.tagName === 'DETAILS' && existing.open;
  const replacement = document.createElement('div');
  replacement.innerHTML = renderThinkingSteps(conversation.thoughts || []);
  const next = replacement.firstElementChild;
  if (existing && next) {
    if (next.tagName === 'DETAILS' && wasOpen) next.open = true;
    existing.replaceWith(next);
  }
}

// A burst of events (an agent reply arriving as several messages, a batch of IRC joins)
// used to run one full transcript + chat-list rebuild each. Collapse them into a single
// repaint: the DOM only has to be right once per frame.
let transcriptTarget = null;
let transcriptRenderedCount = -1;
let pendingTranscriptRender = false;
let pendingConversationsRender = false;
let renderFrame = 0;

function flushRenders() {
  renderFrame = 0;
  if (pendingTranscriptRender) {
    pendingTranscriptRender = false;
    renderTranscriptNow();
  }
  if (pendingConversationsRender) {
    pendingConversationsRender = false;
    renderConversationsNow();
  }
}

// requestAnimationFrame never fires while the tab is hidden/minimized, so a
// background tab would queue renders forever and only paint on refocus
// (the underlying work keeps running server-side the whole time — this was
// purely a frozen UI, see flushRenders). Fall back to a timer while hidden,
// and catch up immediately the moment the tab becomes visible again.
function scheduleRender() {
  if (renderFrame) return;
  renderFrame = document.hidden
    ? window.setTimeout(flushRenders, 250)
    : window.requestAnimationFrame(flushRenders);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (!renderFrame) return;
  window.clearTimeout(renderFrame);
  window.cancelAnimationFrame(renderFrame);
  flushRenders();
});

function renderTranscript() {
  pendingTranscriptRender = true;
  scheduleRender();
}

function renderConversations() {
  pendingConversationsRender = true;
  scheduleRender();
}

function renderOneTranscript(conversation) {
  if (!transcript || !conversation) return;
  // A full rebuild (triggered by anything from a busy-state flip to a live reload) must
  // not yank someone back to the bottom just for scrolling up to read history or
  // selecting text - only follow the bottom if that's where they already were, and
  // otherwise restore the exact scroll offset replaceChildren() would reset to 0.
  const sameConversation = transcript.dataset.renderedTarget === conversation.target;
  const nearBottom = !sameConversation
    || transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 80;
  const previousScrollTop = transcript.scrollTop;
  transcript.replaceChildren();
  if (conversation.kind === 'llm' && conversation.loading) {
    transcript.appendChild(renderEntry('system', { text: 'Loading conversation history…' }));
    transcript.dataset.renderedTarget = conversation.target;
    return;
  }
  const TRANSCRIPT_WINDOW = 80;
  const allEvents = conversation.events;
  const hidden = allEvents.length > TRANSCRIPT_WINDOW ? allEvents.length - TRANSCRIPT_WINDOW : 0;
  const visible = hidden ? allEvents.slice(-TRANSCRIPT_WINDOW) : allEvents;
  if (hidden) {
    transcript.appendChild(renderEntry('system', {
      text: `Showing last ${TRANSCRIPT_WINDOW} of ${allEvents.length} messages.`
    }));
  }
  const finalEventIndex = visible.length - 1;
  for (const [index, event] of visible.entries()) {
    transcript.appendChild(renderEntry(event.kind, event.data, {
      conversation,
      actionable: index === finalEventIndex && Boolean(event.data.assistant)
    }));
  }
  if (conversation.kind === 'llm' && conversation.busy) {
    transcript.appendChild(renderThinkingRow(conversation));
  }
  transcript.dataset.renderedTarget = conversation.target;
  transcript.scrollTop = nearBottom ? transcript.scrollHeight : previousScrollTop;
}

function renderTranscriptNow() {
  if (framesEnabled()) {
    renderVisibleFrameTranscripts();
    const focused = conversations.get(frameTargets[focusedFrame] || activeTarget);
    transcriptTarget = focused?.target || null;
    transcriptRenderedCount = focused?.events.length ?? -1;
    if (visibleFrameTargets().some((target) => conversations.get(target)?.busy)) startThinkingAnimation();
    else stopThinkingAnimation();
    return;
  }
  if (!transcript) return;
  const conversation = ensureConversation(activeTarget || config.channel);
  transcriptTarget = conversation.target;
  renderOneTranscript(conversation);
  transcriptRenderedCount = conversation.kind === 'llm' && conversation.loading ? -1 : conversation.events.length;
  if (conversation.kind === 'llm' && conversation.busy) startThinkingAnimation();
  else stopThinkingAnimation();
}

async function copyText(value) {
  const text = String(value || '');
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_error) {
      // Falls through to execCommand below - the async Clipboard API throws when this
      // page is embedded in an iframe without a clipboard-write permissions policy (the
      // dashboard's My Agents iframe, notably), even though the older API still works there.
    }
  }
  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.setAttribute('readonly', '');
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('Clipboard copy was blocked by the browser.');
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

function confirmAgentCommand(command, conversation, options = {}) {
  const dialog = commandDialog();
  dialog.querySelector('h3').textContent = options.direct
    ? 'Run directly on the server?'
    : `Run with ${conversation.provider || 'agent'}?`;
  dialog.querySelector('.command-confirm-copy').textContent = options.direct
    ? 'No agent is involved — this runs immediately on the machine hosting this service.'
    : `Workspace: ${conversation.workspace || 'current workspace'}`;
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
  // A quick-reply button that does nothing, silently, is worse than an error: the reader
  // cannot tell whether it sent. Every path that stops now says why — in the transcript for
  // the reader, and in the server journal (rendererLog) so a failure is diagnosable after
  // the fact instead of only in the browser console.
  if (!conversation?.writable) {
    rendererLog('warn', 'Agent action blocked: conversation not writable', { target: conversation?.target, provider: conversation?.provider });
    addEvent('system', { target: conversation?.target, text: 'This conversation is read-only, so that answer cannot be sent.' });
    return false;
  }
  if (!window.subjectiveChat.sendLlmMessage) {
    rendererLog('error', 'Agent action blocked: sendLlmMessage missing from the bridge', { target: conversation.target });
    addEvent('system', { target: conversation.target, text: 'The backend bridge is not ready. Reload the page.' });
    return false;
  }
  rendererLog('info', 'Agent action send', { target: conversation.target, provider: conversation.provider, replyChars: String(reply || '').length });
  for (const button of controls.querySelectorAll('button')) button.disabled = true;
  controls.classList.add('pending');
  // The same echo typing a message gets. Without it a clicked option produced no
  // visible change at all: the POST only returns {ok, pending}, and the answer and
  // the reply both arrive later over the event socket — so whenever that socket is
  // not delivering, clicking a button was indistinguishable from a dead button.
  // This is the difference the bug reports were describing.
  addOptimisticLlmEcho(conversation, reply);
  try {
    const result = await window.subjectiveChat.sendLlmMessage(conversation.target, reply);
    if (result?.unauthorized) {
      rendererLog('error', 'Agent action rejected: unauthorized', { target: conversation.target });
      addEvent('system', { target: conversation.target, text: result.error || 'The API rejected the request (missing or wrong token).' });
      return false;
    }
    if (!result?.ok) {
      rendererLog('error', 'Agent action not accepted', { target: conversation.target, error: result?.error || '', status: result?.status || '' });
      addEvent('system', {
        target: conversation.target,
        text: result?.error || `${conversation.provider} did not accept the response.`
      });
      return false;
    }
    return true;
  } catch (error) {
    rendererLog('error', 'Agent action threw', { target: conversation.target, message: error.message });
    addEvent('system', { target: conversation.target, text: `Action failed: ${error.message}` });
    return false;
  } finally {
    controls.classList.remove('pending');
    for (const button of controls.querySelectorAll('button')) button.disabled = Boolean(conversation.busy);
  }
}

// Normalize the backend's promptOptions (the authoritative source) into the button model
// this renderer draws. Falls back to the client-side prose heuristic only when the backend
// sent nothing — an older server, or a message that predates this field.
function resolvePromptActions(data) {
  const backend = data.promptOptions;
  if (backend && Array.isArray(backend.options) && backend.options.length) {
    const actions = backend.options.map((option, index) => ({
      id: option.id || `opt-${index}`,
      label: option.label || option.reply || `Option ${index + 1}`,
      description: option.description || '',
      reply: option.reply,
      primary: index === 0,
    }));
    if (backend.allows_other) {
      actions.push({ id: 'other', label: 'Other…', description: backend.other_hint || 'Answer in your own words', custom: true });
    }
    return actions;
  }
  return richMessages.detectPromptActions(data.text);
}

function appendPromptActions(content, data, context) {
  if (!data.assistant || !context.actionable) return;
  const actions = resolvePromptActions(data);
  if (!actions.length) return;
  const controls = document.createElement('div');
  controls.className = 'prompt-actions';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Answer agent question');
  const readOnly = !context.conversation.writable;
  const busy = Boolean(context.conversation.busy);
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action.primary ? 'prompt-action primary' : 'prompt-action';
    if (action.custom) button.classList.add('prompt-action-custom');
    // Label on top, the backend's description underneath — so the user sees what each
    // choice means, not just a bare word.
    const label = document.createElement('span');
    label.className = 'prompt-action-label';
    label.textContent = action.label;
    button.appendChild(label);
    if (action.description) {
      const description = document.createElement('span');
      description.className = 'prompt-action-description';
      description.textContent = action.description;
      button.appendChild(description);
    }
    button.disabled = readOnly || busy;
    if (readOnly) button.title = 'Historical conversation is read-only';
    button.addEventListener('click', () => {
      rendererLog('info', 'Prompt action clicked', {
        target: context.conversation.target, action: action.id || action.label, custom: Boolean(action.custom),
      });
      // "Other…" has no canned reply: hand focus to the composer so the user writes their
      // own answer, which sends as the next turn like any typed message.
      if (action.custom) {
        if (context.conversation.target === activeTarget && input) {
          input.focus();
          input.placeholder = 'Type your answer…';
        }
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
      if (codeButton.dataset.codeAction === 'run-direct') {
        if (!window.subjectiveChat.exec) return;
        const target = context.conversation.target;
        try {
          if (!await confirmAgentCommand(code, context.conversation, { direct: true })) return;
          const original = codeButton.textContent;
          codeButton.disabled = true;
          codeButton.textContent = 'Running…';
          try {
            const result = await window.subjectiveChat.exec(code);
            if (!result?.ok) {
              addEvent('system', { target, text: result?.error || 'Command execution failed.' });
              return;
            }
            const output = [result.stdout, result.stderr].filter((part) => String(part || '').trim()).join('\n').trim();
            addEvent('code', {
              target,
              from: 'Server (no agent)',
              code: output || '(no output)',
              language: 'text',
              label: `exit ${result.exit_code}${result.truncated ? ' · truncated' : ''}`,
              time: Date.now(),
              icon: '',
              assistant: false
            });
          } finally {
            codeButton.disabled = false;
            codeButton.textContent = original;
          }
        } catch (error) {
          rendererLog('error', 'Direct exec failed', { message: error.message });
          addEvent('system', { target, text: `Run failed: ${error.message}` });
        }
        return;
      }
      if (!context.conversation.writable || context.conversation.busy) return;
      try {
        if (!await confirmAgentCommand(code, context.conversation)) return;
        await sendAgentAction(
          context.conversation,
          `Run this command in the current workspace and report its output:\n\n<command>\n${code}\n</command>`,
          card.querySelector('.code-actions')
        );
      } catch (error) {
        // Without this, a thrown confirm/send (e.g. the confirmation <dialog> failing to
        // open) died as an unhandled rejection - the button just looked like it did
        // nothing, with no clue in the UI that anything had gone wrong.
        rendererLog('error', 'Code run failed', { message: error.message });
        addEvent('system', { target: context.conversation.target, text: `Run failed: ${error.message}` });
      }
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
    const attachments = imageAttachmentMarkup(data.attachments);
    // Terminal output goes into the same code card as a fenced block — Copy, Wrap,
    // line count — rather than through markdown, which would reflow the runs of
    // spaces that carry the layout.
    const body = data.terminal
      ? `<div class="text rich-text">${richMessages.renderTerminal(data.text)}</div>`
      : `<div class="text rich-text">${richMessages.renderMessage(data.text)}</div>`;
    item.innerHTML = `
      ${avatar}
      <div class="bubble">
        <div class="meta"><span>${escapeHtml(data.from)}</span><time>${timeLabel(data.time)}</time></div>
        ${body}
        ${attachments}
      </div>
    `;
    // Wired either way: the card's Copy and Wrap buttons live behind this.
    wireRichMessage(item.querySelector('.rich-text'), data, context);
    wireImageAttachments(item);
    if (data.awaitingSecret) openSshSecretDialog(data.target, data.awaitingSecret);
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

function imageAttachmentMarkup(attachments) {
  const images = Array.isArray(attachments) ? attachments.filter((item) => /^image\//i.test(String(item?.mime_type || item?.mimeType || '')) && item?.content) : [];
  if (!images.length) return '';
  return `<div class="message-images">${images.map((image, index) => {
    const mime = escapeHtml(String(image.mime_type || image.mimeType));
    const src = `data:${mime};base64,${String(image.content).replace(/[^A-Za-z0-9+/=_-]/g, '')}`;
    return `<button type="button" class="message-image-open" data-image-src="${src}" aria-label="Open image ${index + 1}"><img src="${src}" alt="${escapeHtml(image.filename || 'Attached image')}" loading="lazy"></button>`;
  }).join('')}</div>`;
}

function wireImageAttachments(item) {
  for (const button of item.querySelectorAll('.message-image-open')) {
    button.addEventListener('click', () => openImageModal(button.dataset.imageSrc, button.querySelector('img')?.alt || 'Attached image'));
  }
}

let imageModal;
function openImageModal(src, alt) {
  if (!imageModal) {
    imageModal = document.createElement('dialog');
    imageModal.className = 'image-modal';
    imageModal.innerHTML = '<form method="dialog"><button type="submit" class="image-modal-close" aria-label="Close">×</button><img></form>';
    document.body.appendChild(imageModal);
  }
  const image = imageModal.querySelector('img');
  image.src = src;
  image.alt = alt;
  if (imageModal.showModal) imageModal.showModal();
  else imageModal.setAttribute('open', '');
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

// Which machine a chat's agent runs on. Worth a column of its own: two chats with
// the same agent and the same name behave completely differently depending on the
// answer, and nothing else in the row distinguishes them.
const LOCATION_ICONS = {
  // Two nodes and a link — the conventional "somewhere else on the network".
  ssh: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
     + '<rect x="1" y="2" width="6" height="4" rx="1"/><rect x="9" y="10" width="6" height="4" rx="1"/>'
     + '<path d="M4 6v3a1 1 0 0 0 1 1h7"/></svg>',
  // One box, standing on its own.
  local: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
       + '<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 14h4"/></svg>',
};

function conversationLocationHtml(conversation) {
  if (conversation.kind !== 'llm') {
    return '<span class="conversation-location is-empty" aria-hidden="true"></span>';
  }
  const overSsh = conversation.provider === SSH_PROVIDER || Boolean(conversation.sshConnection);
  if (!overSsh) {
    return `<span class="conversation-location is-local" title="Runs on this machine">`
      + `${LOCATION_ICONS.local}</span>`;
  }
  let where = '';
  if (conversation.provider === SSH_PROVIDER) {
    // An SSH chat's target is its workspace, so that string is the machine.
    where = String(conversation.workspace || '').trim();
  } else {
    // The catalog is loaded once at startup; a chat can outlive the connection it
    // names, and saying so beats a tooltip that claims a machine that is gone.
    const saved = savedConnection(conversation.sshConnection);
    where = saved ? `${saved.username ? saved.username + '@' : ''}${saved.host}` : '';
  }
  const title = where ? `Runs over SSH on ${where}` : 'Runs over SSH — that connection no longer exists';
  return `<span class="conversation-location is-ssh${where ? '' : ' is-broken'}" `
    + `title="${escapeHtml(title)}">${LOCATION_ICONS.ssh}</span>`;
}

function syncConversationTitles() {
  const active = conversations.get(activeTarget);
  if (active) {
    topChannel.textContent = active.label;
    topChannel.title = active.label;
  }
  if (framesEnabled()) {
    [...chatFrames.children].forEach((frameEl, index) => syncChatFrame(frameEl, index));
  }
}

// A re-render whose row set is unchanged patches the existing rows in place instead of
// rebuilding the table. Replacing every row on each selection change or list refresh broke
// inline rename two ways: it discarded a field the operator was already typing into, and -
// since the row a double-click started on was swapped out between the two clicks - the
// browser was often left with no common target to fire the opening dblclick on at all.
function paintConversationRow(row, conversation) {
  row.title = conversation.sourceUser
    ? `${conversation.sourceUser}: ${conversation.label}`
    : conversation.label;
  row.classList.toggle('active', conversation.target === activeTarget);
  row.classList.toggle('in-frame', framesEnabled() && frameTargets.includes(conversation.target));
  row.classList.toggle('busy', Boolean(conversation.busy));
  row.draggable = Boolean(framesEnabled() && conversation.kind === 'llm');
  // A row mid-rename has no .conversation-label to repaint - the field replaced it, and
  // overwriting it would throw away the operator's keystrokes.
  const label = row.querySelector('.conversation-label');
  if (label) label.textContent = conversation.label.replace(/^#/, '');
  const unread = row.querySelector('.conversation-unread-cell');
  if (unread) unread.innerHTML = conversation.unread ? `<b>${conversation.unread}</b>` : '';
}

function renderConversationsNow() {
  // Metadata-only updates (rename/list refresh) do not render transcripts. Keep
  // every visible pane header in sync without replacing messages or drafts.
  syncConversationTitles();
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
  // Same rows in the same order: repaint them where they stand, keeping every live DOM
  // node (the rename field included) attached.
  const rendered = conversationList.querySelectorAll('.conversation-row:not(.agent-row)');
  if (
    visible.length
    && visible.length === rendered.length
    && visible.every((conversation, index) => rendered[index].dataset.target === conversation.target)
  ) {
    visible.forEach((conversation, index) => paintConversationRow(rendered[index], conversation));
    syncAgentRows();
    return;
  }
  conversationList.replaceChildren();
  if (!visible.length) {
    // The agents are part of this list, so they stay even when no chat matches.
    if (agentsAvailable && agents.length) {
      const table = document.createElement('table');
      table.className = 'conversation-table';
      const body = document.createElement('tbody');
      appendAgentRows(body);
      table.appendChild(body);
      conversationList.appendChild(table);
    }
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    empty.textContent = query ? `No chats matching “${conversationSearch.value.trim()}”` : 'No conversations yet';
    conversationList.appendChild(empty);
    return;
  }
  // A real <table>: the four columns line up across every row because the browser
  // does the column sizing. A stack of <button>s with display:table-cell children
  // does not form a table box, so the columns drifted per row.
  const table = document.createElement('table');
  table.className = 'conversation-table';
  const colgroup = document.createElement('colgroup');
  for (const name of ['col-user', 'col-location', 'col-icon', 'col-name', 'col-unread']) {
    const col = document.createElement('col');
    col.className = name;
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);
  const body = document.createElement('tbody');
  // Agents first, as rows of this same table: one list, one set of columns, one scrollbar.
  appendAgentRows(body);
  for (const conversation of visible) {
    const row = document.createElement('tr');
    row.className = 'conversation-row';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.title = conversation.sourceUser
      ? `${conversation.sourceUser}: ${conversation.label}`
      : conversation.label;
    row.dataset.target = conversation.target;
    row.classList.toggle('active', conversation.target === activeTarget);
    row.classList.toggle('in-frame', framesEnabled() && frameTargets.includes(conversation.target));
    row.classList.toggle('busy', Boolean(conversation.busy));
    if (framesEnabled() && conversation.kind === 'llm') {
      row.draggable = true;
      row.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('application/x-subjective-chat', conversation.target);
        event.dataTransfer.effectAllowed = 'copy';
      });
    }
    const icon = conversation.icon
      ? `<img class="conversation-provider-icon" src="${escapeHtml(conversation.icon)}" alt="${escapeHtml(conversation.provider)}">`
      : `<span class="conversation-icon">${conversation.kind === 'channel' ? '#' : '@'}</span>`;
    row.innerHTML = `
      <td class="conversation-user-cell">${conversationUserPillHtml(conversation)}</td>
      <td class="conversation-location-cell">${conversationLocationHtml(conversation)}</td>
      <td class="conversation-icon-cell">${icon}</td>
      <td class="conversation-name-cell"><span class="conversation-label">${escapeHtml(conversation.label.replace(/^#/, ''))}</span></td>
      <td class="conversation-unread-cell">${conversation.unread ? `<b>${conversation.unread}</b>` : ''}</td>
    `;
    row.addEventListener('click', () => setActiveTarget(conversation.target));
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target !== row) return; // let the inline rename field keep its keys
      event.preventDefault();
      setActiveTarget(conversation.target);
    });
    if (conversation.kind === 'llm') {
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        window.subjectiveChat.showConversationContextMenu(conversation.target, event.clientX, event.clientY);
      });
      row.addEventListener('dblclick', (event) => {
        event.preventDefault();
        beginRenameConversation(conversation.target);
      });
    }
    body.appendChild(row);
  }
  table.appendChild(body);
  conversationList.appendChild(table);
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
  // Put the label span back rather than leaving the field for the next render to clear:
  // a render that finds the row set unchanged now patches rows in place and would keep
  // the field (and the stale name inside it) on screen indefinitely.
  const restore = () => {
    if (!field.isConnected) return;
    const span = document.createElement('span');
    span.className = 'conversation-label';
    span.textContent = conversation.label.replace(/^#/, '');
    field.replaceWith(span);
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    restore();
    renderConversations();
  };
  const commit = async () => {
    if (settled) return;
    settled = true;
    const name = field.value.trim();
    if (!name || name === conversation.label.replace(/^#/, '')) {
      restore();
      renderConversations();
      return;
    }
    try {
      const result = await window.subjectiveChat.renameLlmConversation(target, name);
      // Apply the confirmed HTTP result too: the WebSocket event can be missed
      // during reconnect. Do not replace transcript state with the metadata reply.
      if (result?.ok && result.conversation?.label) {
        conversation.label = result.conversation.label;
      } else if (!result?.ok) {
        rendererLog('error', 'Failed to rename conversation', { target, error: result?.error });
      }
    } catch (error) {
      rendererLog('error', 'Failed to rename conversation', { target, error: String(error) });
    }
    restore();
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

async function confirmDeleteConversation(target) {
  if (!window.subjectiveChat.deleteLlmConversation) return;
  const conversation = conversations.get(target);
  if (!conversation || conversation.kind !== 'llm') return;
  const label = conversation.label.replace(/^#/, '');
  if (!window.confirm(`Delete "${label}"? This can't be undone from here.`)) return;
  const result = await window.subjectiveChat.deleteLlmConversation(target);
  // On success the row disappears via the broadcasted 'llm-conversation-deleted' event
  // (same target this client is also subscribed to), same as rename applies its new label
  // through 'llm-conversation-renamed' - one code path for every connected tab, not just
  // whichever one clicked delete.
  if (!result?.ok) {
    rendererLog('error', 'Failed to delete conversation', { target, error: result?.error });
    window.alert(result?.error || 'Could not delete this conversation.');
  }
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
    mime_type: imageMimeType(file) || 'application/octet-stream',
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
function addOptimisticLlmEcho(conversation, text, attachments = []) {
  conversation.pendingEchoes = conversation.pendingEchoes || [];
  conversation.pendingEchoes.push(text);
  conversation.busy = true;
  conversation.busySince = conversation.busySince || Date.now();
  if (conversation.target === activeTarget) {
    // Placeholder only: the box stays usable so the next message can be written
    // while this turn runs.
    input.placeholder = `${providerName(conversation.provider)} is working…`;
  }
  addEvent('message', {
    target: conversation.target,
    from: config.nick || 'You',
    text,
    attachments,
    time: Date.now(),
    mine: true,
    assistant: false,
    optimistic: true
  });
}

// The optimistic bubble is a promise that the message went out. When the send fails that
// promise is false, so take the bubble back and hand the text to the composer instead —
// the accompanying system message says why, and nothing the user typed is lost.
function dropOptimisticLlmEcho(conversation, text) {
  if (!conversation) return;
  const pending = conversation.pendingEchoes || [];
  const echoIndex = pending.indexOf(text);
  if (echoIndex !== -1) pending.splice(echoIndex, 1);
  const eventIndex = conversation.events.findIndex(
    (item) => item.data.optimistic && item.data.text === text
  );
  if (eventIndex !== -1) conversation.events.splice(eventIndex, 1);
  conversation.busy = false;
  conversation.busySince = 0;
  if (conversation.target === activeTarget) {
    input.placeholder = `Message ${providerName(conversation.provider)}`;
    // Only reclaim the composer if the user has not started typing something else.
    if (!input.value.trim()) input.value = text;
    renderTranscript();
  }
  renderConversations();
}

async function sendTextMessages(text, targetOverride) {
  const sendTarget = targetOverride || activeTarget;
  // An LLM prompt is one message, including indentation and blank lines. IRC
  // still needs one message per line. A pending LLM response ends this send.
  const isLlm = conversations.get(sendTarget)?.kind === 'llm';
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  const lines = isLlm ? [normalized] : normalized.split('\n');
  const previousTarget = activeTarget;
  if (targetOverride) activeTarget = targetOverride;
  try {
  for (const text of lines) {
    const outgoing = normalizeLiteralSlash(isLlm ? text : text.trim());
    if (!outgoing.trim()) continue;
    rendererLog('info', 'Composer submit', { target: sendTarget, length: outgoing.length });
    try {
      if (isSlashCommand(text) && !(isLlm && outgoing.includes('\n'))) {
        const result = await window.subjectiveChat.executeCommand(outgoing, activeTarget);
        if (result?.focusTarget) setActiveTarget(result.focusTarget);
        if (!result?.ok) addEvent('system', { target: activeTarget, text: 'Command was not accepted.' });
      } else {
        const conversation = conversations.get(activeTarget);
        if (conversation?.kind === 'llm') {
          addOptimisticLlmEcho(conversation, outgoing);
          const result = await window.subjectiveChat.sendLlmMessage(activeTarget, outgoing);
          rendererLog(result?.ok ? 'info' : 'error', 'Composer LLM send result', {
            target: activeTarget,
            provider: conversation.provider,
            ok: Boolean(result?.ok),
            pending: Boolean(result?.pending),
            proxyTimeout: result?.proxyTimeout || 0,
            status: result?.status || '',
            error: result?.error || '',
            sessionId: result?.conversation?.sessionId || conversation.sessionId || ''
          });
          // HTTP returns pending immediately so Cloudflare cannot 524 the POST.
          // Reply arrives on the WebSocket. Only mention a proxy timeout when
          // one actually happened (502/504/524) — not on every normal accept.
          if (result?.pending) {
            if (result.proxyTimeout) {
              addEvent('system', {
                target: activeTarget,
                text: `${providerName(conversation.provider)} is still working. The page proxy returned ${result.proxyTimeout}; the reply will appear here when it lands.`
              });
            }
            return;
          }
          if (!result.ok) {
            dropOptimisticLlmEcho(conversation, outgoing);
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
      dropOptimisticLlmEcho(conversations.get(activeTarget), outgoing);
      addEvent('system', { target: activeTarget, text: `Message send failed: ${error.message}` });
    }
  }
  } finally {
    activeTarget = previousTarget;
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

function imageMimeType(file) {
  if (/^image\//i.test(file?.type || '')) return file.type.toLowerCase();
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' })[extension] || '';
}

function readImagePreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '');
      const comma = data.indexOf(',');
      if (comma < 0) return reject(new Error('Could not read this image.'));
      resolve(`data:${imageMimeType(file)};base64,${data.slice(comma + 1)}`);
    };
    reader.onerror = () => reject(new Error('Could not read this image. Select it again.'));
    reader.onabort = () => reject(new Error('Image loading was interrupted. Select it again.'));
    reader.readAsDataURL(file);
  });
}

function uniqueImageFiles(files) {
  const seen = new Set();
  return files.filter((file) => {
    if (!file || !imageMimeType(file)) return false;
    const key = imageFileSignature(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function addPendingImages(files) {
  const loading = [];
  for (const file of files) {
    const image = {
      id: pendingImageId++,
      file,
      url: '',
      error: '',
      loading: true
    };
    pendingImages.push(image);
    const ready = readImagePreview(file).then((url) => {
      image.url = url;
      const binary = atob(url.slice(url.indexOf(',') + 1));
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      image.file = new File([bytes], file.name || 'image.png', { type: imageMimeType(file) });
    })
      .catch((error) => { image.error = error.message; })
      .finally(() => {
        image.loading = false;
        if (pendingImages.includes(image)) renderPendingImages();
      });
    image.ready = ready;
    loading.push(ready);
  }
  renderPendingImages();
  await Promise.all(loading);
}

// A native file picker works on mobile photo libraries as well as desktop files.
// Install per form because the web UI creates and removes split chat panes.
function attachImagePicker(form) {
  if (!form || form.querySelector('.composer-attach')) return;
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif';
  picker.multiple = true;
  picker.hidden = true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'composer-attach';
  button.textContent = '+';
  button.title = 'Attach images';
  button.setAttribute('aria-label', 'Attach images');
  button.addEventListener('click', () => {
    const frame = form.closest('.chat-frame');
    if (frame) focusChatFrame(Number(frame.dataset.frame));
    if (form.querySelector('textarea')?.disabled) return;
    picker.click();
  });
  picker.addEventListener('change', async () => {
    const files = uniqueImageFiles([...picker.files]);
    if (!files.length || !form.isConnected) return;
    const frame = form.closest('.chat-frame');
    if (frame) focusChatFrame(Number(frame.dataset.frame));
    await addPendingImages(files);
    // Mobile providers may revoke access when the picker is cleared. Keep our own
    // byte snapshot for subsequent Send, even after the native input is reset.
    picker.value = '';
  });
  form.classList.add('has-image-picker');
  form.insertBefore(button, form.querySelector('textarea'));
  form.appendChild(picker);
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
  if (!pendingImagesEl) return;
  pendingImagesEl.replaceChildren();
  pendingImagesEl.hidden = pendingImages.length === 0;
  for (const image of pendingImages) {
    const item = document.createElement('div');
    item.className = 'pending-image';
    item.innerHTML = '<button type="button" class="pending-image-remove" aria-label="Remove image" title="Remove image">&times;</button>';
    item.querySelector('button').addEventListener('click', () => removePendingImage(image.id));
    if (image.loading || image.error) {
      const status = document.createElement('span');
      status.className = 'pending-image-status';
      status.textContent = image.error || 'Loading image…';
      status.setAttribute('role', image.error ? 'alert' : 'status');
      item.appendChild(status);
      item.classList.add('has-status');
    } else {
      const preview = document.createElement('img');
      preview.alt = image.file.name || 'Attached image';
      preview.addEventListener('error', () => {
        image.error = 'Preview unavailable. Choose a PNG or JPEG image.';
        renderPendingImages();
      }, { once: true });
      preview.src = image.url;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'pending-image-preview';
      open.setAttribute('aria-label', `Preview ${preview.alt}`);
      open.addEventListener('click', () => openImageModal(image.url, preview.alt));
      open.appendChild(preview);
      item.appendChild(open);
    }
    pendingImagesEl.appendChild(item);
  }
}

async function onComposerSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const frameEl = form.closest('.chat-frame');
  if (frameEl) focusChatFrame(Number(frameEl.dataset.frame), { skipActive: false });
  const box = (frameEl ? frameEl.querySelector('textarea') : input);
  if (box) input = box;
  const text = String(input?.value || '').replace(/\r\n?/g, '\n');
  if (pendingImages.some((image) => image.loading || image.error)) {
    addEvent('system', { target: activeTarget, text: 'Wait for image previews to load, or remove images that could not be opened.' });
    return;
  }
  const images = pendingImages.map((image) => image.file);
  if (!text.trim() && !images.length) return;
  // The composer stays typable during a turn, so this is where a second send is
  // refused. The text is deliberately left in the box: the operator wrote it, and
  // clearing it to show a "still working" notice would throw their words away.
  const activeConversation = conversations.get(activeTarget);
  if (activeConversation?.kind === 'llm' && activeConversation.busy) {
    addEvent('system', {
      target: activeTarget,
      text: `${providerName(activeConversation.provider)} is still working. Your message is kept in the box — send it when the turn finishes.`,
    });
    return;
  }
  if (input) {
    input.value = '';
    // Sending should not cost the operator their cursor: without this the next
    // message has to start by clicking back into the box.
    input.focus();
  }
  hideCommandPalette();
  clearPendingImages();
  const broadcast = Boolean(frameBroadcast?.checked) && framesEnabled();
  const targets = broadcast
    ? [...new Set(visibleFrameTargets())]
    : [activeTarget];
  for (const target of targets) {
    const conversation = conversations.get(target);
    if (conversation?.kind === 'llm' && images.length) {
      try {
        const files = await Promise.all(images.map(llmAttachment));
        const prompt = text.trim() ? text : 'Review attached image.';
        addOptimisticLlmEcho(conversation, prompt, files);
        await window.subjectiveChat.sendLlmMessage(target, prompt, files);
      } catch (error) {
        addEvent('system', { target, text: `Attachment send failed: ${error.message}` });
      }
      continue;
    }
    await sendTextMessages(text, target);
    if (!broadcast) {
      for (const file of images) await sendPastedImage(file);
    }
  }
}

async function onComposerKeydown(event) {
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
  if (event.key === 'Enter') {
    // Enter sends, Ctrl/Cmd+Enter and Shift+Enter make a new line. A chat composer
    // is typed in far more often than it is used to compose a paragraph, and this
    // is the way round every other chat works.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    (event.currentTarget.closest('form') || composer)?.requestSubmit();
  }
}

async function onComposerPaste(event) {
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
}

if (composer) {
  attachImagePicker(composer);
  composer.addEventListener('submit', onComposerSubmit);
}
if (input) {
  input.addEventListener('keydown', onComposerKeydown);
  input.addEventListener('input', () => updateCommandPalette());
  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (document.activeElement !== input) hideCommandPalette();
    }, 120);
  });
  input.addEventListener('paste', onComposerPaste);
}

connectButton.addEventListener('click', async () => {
  await window.subjectiveChat.connect();
});

sendImageButton.addEventListener('click', () => {
  window.subjectiveChat.sendImage(activeTarget);
});

// Only the web bundle ships #versionBanner (src/index.html, the Electron shell, does not),
// and only it can go stale like this: a deploy lands while the tab stays open, and the
// page keeps running JS from before the deploy no matter what the server now serves,
// since a file changing on disk does not re-run already-loaded script in an open tab.
(function initVersionWatcher() {
  const banner = document.getElementById('versionBanner');
  const reloadButton = document.getElementById('versionBannerReload');
  if (!banner || !reloadButton || !window.subjectiveChat.getVersion) return;
  const pageVersion = String(document.documentElement.dataset.devagentsVersion || '');
  const pageInstance = String(document.documentElement.dataset.devagentsInstance || '');
  if (!pageVersion || pageVersion === 'DEVAGENTS_DEPLOY_VERSION') return; // unstamped local checkout
  reloadButton.addEventListener('click', () => window.location.reload());
  const check = async () => {
    try {
      const result = await window.subjectiveChat.getVersion();
      if (!result?.ok) return;
      // version is a git SHA - unchanged across a plain restart with no new commit, which
      // is most restarts during active development. instanceId is fresh every process
      // start regardless, so it is what actually catches "this tab predates the restart".
      const versionChanged = result.version && result.version !== pageVersion;
      const instanceChanged = result.instanceId && pageInstance && result.instanceId !== pageInstance;
      if (versionChanged || instanceChanged) banner.hidden = false;
    } catch (_error) {
      // A failed check is not itself news - stay quiet rather than nag on a flaky connection.
    }
  };
  check();
  window.setInterval(check, 2 * 60 * 1000);
}());

const PROVIDER_DISPLAY_NAMES = Object.freeze({
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  grok: 'Grok',
  ssh: 'SSH'
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
      attachments: message.attachments || [],
      time: message.time,
      mine: !assistant,
      icon: assistant ? conversation.icon : '',
      assistant,
      // An SSH reply is terminal output, not prose. Markdown reflows it — every
      // run of spaces collapses, so `ls` columns and any box drawing fall apart —
      // and there is no markdown in it to render in the first place.
      terminal: assistant && String(conversation.provider || '').toLowerCase() === 'ssh',
      // Set when the remote is blocked on a password prompt; the composer must not
      // be how that is answered.
      awaitingSecret: message.awaitingSecret || '',
      target: conversation.target,
      // The backend's structured choices for this message, when it is an assistant question.
      // appendPromptActions prefers this over parsing the prose itself.
      promptOptions: message.promptOptions || null
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

function llmListMetadata(payload) {
  const meta = { ...payload };
  delete meta.messages;
  delete meta.events;
  delete meta.hydrated;
  delete meta.loading;
  delete meta.pendingEchoes;
  delete meta.unread;
  delete meta.busy;
  return meta;
}

function upsertLlmConversation(payload) {
  if (!payload?.target) return null;
  const existing = conversations.get(payload.target);
  // The server sends the authoritative busy state on hydrate. Apply it before deciding
  // anything else: a stale busy stuck true (from a dropped socket that ate llm-busy:false)
  // would otherwise both wedge the UI and block this fresh transcript from rendering.
  if (existing && typeof payload.busy === 'boolean') existing.busy = payload.busy;
  const live = Boolean(existing?.busy || existing?.pendingEchoes?.length || existing?.loading);
  const replaceEvents = payload.loaded !== false
    && Array.isArray(payload.messages)
    && !(existing?.hydrated && live);
  const conversation = ensureConversation(
    payload.target,
    preferConversationLabel(existing?.label, payload.label, payload.provider || existing?.provider),
    'llm',
    llmListMetadata(payload)
  );
  if (replaceEvents) {
    conversation.events = richMessages.normalizeToolMessages(payload.messages || []).map((entry) => {
      if (entry.type === 'command') return llmCommandEvent(entry, conversation);
      if (entry.type === 'code') return llmCodeEvent(entry, conversation);
      return llmMessageEvent(entry.message, conversation);
    });
    if (payload.hiddenBefore) {
      conversation.events.unshift({
        kind: 'system',
        data: { text: `Showing last ${payload.messages.length} of ${payload.messageCount || payload.messages.length + payload.hiddenBefore} messages.` }
      });
    }
    conversation.hydrated = true;
  }
  if (typeof payload.busy === 'boolean') conversation.busy = payload.busy;
  if (isTargetOnScreen(conversation.target) && (replaceEvents || !existing)) {
    renderTranscript();
    renderUsers();
  } else if (conversation.target === activeTarget && payload.label) {
    topChannel.textContent = conversation.label;
    topChannel.title = conversation.label;
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
  const seen = new Set();
  let keptHydrated = 0;
  let dropped = 0;
  deferConversationRender += 1;
  try {
    for (const payload of result.conversations || []) {
      seen.add(payload.target);
      upsertLlmConversation(payload);
    }
    for (const [target, conversation] of [...conversations.entries()]) {
      if (conversation.kind !== 'llm') continue;
      if (seen.has(target)) continue;
      if (target === activeTarget || conversation.hydrated || conversation.loading || conversation.busy) {
        keptHydrated += 1;
        continue;
      }
      dropped += 1;
      conversations.delete(target);
    }
  } finally {
    deferConversationRender -= 1;
    renderConversations();
  }
  rendererLog('info', 'LLM conversation list refreshed', {
    query: q,
    listed: (result.conversations || []).length,
    total: llmListTotal,
    keptHydrated,
    dropped,
    activeTarget,
    activeHydrated: Boolean(conversations.get(activeTarget)?.hydrated)
  });
  const open = conversations.get(activeTarget);
  if (open?.kind === 'llm' && !open.hydrated && !open.loading) {
    open.loading = true;
    window.subjectiveChat.getLlmConversation(activeTarget).then((loaded) => {
      open.loading = false;
      if (loaded?.ok) upsertLlmConversation(loaded.conversation);
    });
  }
}

// --- agents -----------------------------------------------------------------------
// The registry in workflow/agents: one row per logical role, its role file, and the model
// currently assigned to it. Models are runtime metadata there, never part of an agent's
// identity, so changing one re-points the agent rather than defining a new one.
//
// Agent rows are <tr>s in the same <table> as the chats, sharing its columns and its one
// scroll container: agents and chats are a single list, not two stacked ones.
let agents = [];
let agentsAvailable = true;
let agentsCollapsed = true; // set from storage on first render
// Kept across renders so rebuilding the chat list cannot close a model <select> that the
// operator has open, and so the person icon is not re-parsed 28 times a render.
const agentRowNodes = new Map();
let agentsHeaderRow = null;
const AGENTS_COLLAPSED_KEY = 'subjective-chat-agents-collapsed';

// Inline rather than an <img>: it inherits the row's colour through currentColor, so it
// tracks the theme and the hover state like the rest of the list.
const AGENT_ICON_SVG = `
  <svg class="agent-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
    <circle cx="8" cy="5" r="3" fill="currentColor"></circle>
    <path d="M8 9.4c-3.05 0-5.4 1.9-5.4 4.3 0 .33.27.6.6.6h9.6c.33 0 .6-.27.6-.6 0-2.4-2.35-4.3-5.4-4.3Z" fill="currentColor"></path>
  </svg>`;

function readAgentsCollapsed() {
  try {
    return localStorage.getItem(AGENTS_COLLAPSED_KEY) !== 'false';
  } catch (_error) {
    return true; // private mode: collapsed, so the registry cannot bury the chats
  }
}

function modelOptionsHtml(selected) {
  const chosen = String(selected || '');
  const options = llmProviders.length
    ? llmProviders
    : [...llmProviderSelect?.options || []].map((option) => ({ key: option.value, label: option.textContent }));
  const rows = options.map((provider) =>
    `<option value="${escapeHtml(provider.key)}"${provider.key === chosen ? ' selected' : ''}>${escapeHtml(provider.label)}</option>`
  );
  // "Not set" is a real state: a role may deliberately leave the model to the caller.
  return `<option value=""${chosen ? '' : ' selected'}>Not set</option>${rows.join('')}`;
}

function setAgentsCollapsed(next) {
  agentsCollapsed = Boolean(next);
  try {
    localStorage.setItem(AGENTS_COLLAPSED_KEY, agentsCollapsed ? 'true' : 'false');
  } catch (_error) { /* ignore quota / private mode */ }
  renderConversations();
}

function applyAgentsCollapsed() {
  if (agentsHeaderRow) agentsHeaderRow.classList.toggle('is-collapsed', agentsCollapsed);
}

function ensureAgentsHeaderRow() {
  if (agentsHeaderRow) return agentsHeaderRow;
  const row = document.createElement('tr');
  row.className = 'agents-header-row';
  row.innerHTML = `
    <td class="agents-header-cell" colspan="4">
      <span class="agents-title">Agents</span>
      <small id="agentsCount" class="agents-count"></small>
      <button type="button" id="agentCreateButton" class="agents-add" title="New agent" aria-label="New agent">+</button>
    </td>
  `;
  row.querySelector('#agentCreateButton').addEventListener('click', (event) => {
    // The header toggles the group, so the + must not also collapse it.
    event.preventDefault();
    event.stopPropagation();
    openAgentDialog();
  });
  row.addEventListener('click', () => setAgentsCollapsed(!agentsCollapsed));
  agentsHeaderRow = row;
  return row;
}

function buildAgentRow(agent) {
  const row = document.createElement('tr');
  row.className = 'conversation-row agent-row';
  row.dataset.agent = agent.id;
  // A registry row whose role file is missing is shown and flagged, not hidden: hiding it
  // would make a broken registry look healthy.
  row.classList.toggle('is-missing', agent.exists === false);
  row.title = agent.exists === false
    ? `${agent.id} — role file ${agent.roleFile} is missing`
    : `${agent.id}${agent.capability ? ` — ${agent.capability}` : ''}`;
  row.innerHTML = `
    <td class="conversation-user-cell">
      <select class="agent-model" aria-label="Model for ${escapeHtml(agent.id)}">${modelOptionsHtml(agent.model)}</select>
    </td>
    <!-- An agent row is a registry entry, not a chat, so it has no machine. The
         cell still has to be here: it shares this table's columns. -->
    <td class="conversation-location-cell"><span class="conversation-location is-empty" aria-hidden="true"></span></td>
    <td class="conversation-icon-cell">${AGENT_ICON_SVG}</td>
    <td class="conversation-name-cell"><span class="agent-name">${escapeHtml(agent.id)}</span></td>
    <td class="conversation-unread-cell"></td>
  `;
  row.querySelector('.agent-model').addEventListener('click', (event) => event.stopPropagation());
  row.querySelector('.agent-model').addEventListener('change', (event) => {
    event.stopPropagation();
    setAgentModel(agent.id, event.target.value);
  });
  row.addEventListener('click', () => startAgentChat(agent.id));
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    window.subjectiveChat.showAgentContextMenu?.(agent.id, event.clientX, event.clientY);
  });
  return row;
}

function renderAgents() {
  if (!agentsAvailable) return;
  agentsCollapsed = readAgentsCollapsed();
  const header = ensureAgentsHeaderRow();
  const count = header.querySelector('#agentsCount');
  if (count) count.textContent = agents.length ? String(agents.length) : '';
  const seen = new Set();
  for (const agent of agents) {
    seen.add(agent.id);
    const existing = agentRowNodes.get(agent.id);
    // Rebuild only what changed, so an open <select> elsewhere in the group survives.
    if (!existing || existing.dataset.model !== String(agent.model || '')) {
      const row = buildAgentRow(agent);
      row.dataset.model = String(agent.model || '');
      agentRowNodes.set(agent.id, row);
    }
  }
  for (const id of [...agentRowNodes.keys()]) {
    if (!seen.has(id)) agentRowNodes.delete(id);
  }
  applyAgentsCollapsed();
  renderConversations();
}

// Reconcile the agent rows inside the table that is already on screen. Rebuilding the
// whole tbody because the agent list changed would replace every chat row too, and a row
// swapped out from under a click becomes a stale element.
function syncAgentRows() {
  const body = conversationList.querySelector('table.conversation-table tbody');
  if (!body) return;
  for (const row of agentRowNodes.values()) row.remove();
  if (!agentsAvailable || !agents.length) {
    agentsHeaderRow?.remove();
    return;
  }
  const header = ensureAgentsHeaderRow();
  applyAgentsCollapsed();
  if (header.parentNode !== body || body.firstChild !== header) {
    body.insertBefore(header, body.firstChild);
  }
  if (agentsCollapsed) return;
  const firstChat = header.nextSibling;
  for (const agent of agents) {
    const row = agentRowNodes.get(agent.id);
    if (row) body.insertBefore(row, firstChat);
  }
}

function appendAgentRows(body) {
  if (!agentsAvailable || !agents.length) return;
  body.appendChild(ensureAgentsHeaderRow());
  applyAgentsCollapsed();
  // Collapsed means not in the table at all, rather than present-but-hidden. Agent rows
  // carry .conversation-row so they match the chat rows' styling, and those rules set
  // `display` — including a mobile grid override — which beats [hidden]. Leaving them out
  // is unambiguous and cannot be re-shown by a stylesheet.
  if (agentsCollapsed) return;
  for (const agent of agents) {
    const row = agentRowNodes.get(agent.id);
    if (row) body.appendChild(row);
  }
}

async function loadAgents() {
  if (!window.subjectiveChat.listAgents) {
    // A backend with no registry to serve: no agent rows at all, rather than an empty group.
    agentsAvailable = false;
    agents = [];
    agentRowNodes.clear();
    agentsHeaderRow = null;
    renderConversations();
    return;
  }
  let payload = null;
  try {
    payload = await window.subjectiveChat.listAgents();
  } catch (error) {
    rendererLog('error', 'Failed to load agents', { error: String(error) });
  }
  agents = Array.isArray(payload?.agents) ? payload.agents : [];
  renderAgents();
}

async function setAgentModel(id, model) {
  if (!window.subjectiveChat.setAgentModel) return;
  try {
    const result = await window.subjectiveChat.setAgentModel(id, model);
    if (!result?.ok) {
      rendererLog('error', 'Failed to set agent model', { id, error: result?.error });
      await loadAgents(); // put the picker back to what is actually on disk
      return;
    }
    const agent = agents.find((item) => item.id === id);
    if (agent) agent.model = result.model || '';
  } catch (error) {
    rendererLog('error', 'Failed to set agent model', { id, error: String(error) });
    await loadAgents();
  }
}

async function startAgentChat(id) {
  const agent = agents.find((item) => item.id === id);
  if (!agent || !window.subjectiveChat.createLlmConversation) return;
  // An agent with no model assigned cannot pick one for you — say so rather than
  // silently starting the chat on whatever the default happens to be.
  if (!agent.model) {
    addEvent('system', { target: activeTarget, text: `${id} has no model set. Choose one next to it first.` });
    return;
  }
  const result = await window.subjectiveChat.createLlmConversation({
    name: id,
    provider: agent.model,
    workspace: ''
  });
  if (!result?.ok) {
    rendererLog('error', 'Failed to start agent chat', { id, error: result?.error });
    addEvent('system', { target: activeTarget, text: result?.error || `Could not start ${id}.` });
    return;
  }
  const conversation = upsertLlmConversation(result.conversation);
  setActiveTarget(conversation.target);
}

function openAgentDialog() {
  if (!agentDialog) return;
  if (agentDialogStatus) agentDialogStatus.textContent = '';
  if (agentIdInput) agentIdInput.value = '';
  if (agentCapabilityInput) agentCapabilityInput.value = '';
  if (agentModelSelect) agentModelSelect.innerHTML = modelOptionsHtml('');
  agentDialog.showModal ? agentDialog.showModal() : agentDialog.setAttribute('open', '');
  if (agentIdInput) agentIdInput.focus();
}

// Right-click an agent row -> "Edit agent…" -> load its role .md and let the operator edit
// the file directly. Unlike openAgentDialog (a few fields for a brand-new agent), this is
// the agent's actual prose, so the source of truth is the file's full text, not a form.
async function beginEditAgent(id) {
  if (!agentEditDialog || !window.subjectiveChat.getAgentRole) return;
  if (agentEditStatus) agentEditStatus.textContent = 'Loading…';
  if (agentEditTitle) agentEditTitle.textContent = id;
  if (agentEditRoleFile) agentEditRoleFile.textContent = `roles/${id}.md`;
  if (agentEditTextarea) agentEditTextarea.value = '';
  agentEditForm?.setAttribute('data-agent-id', id);
  agentEditDialog.showModal ? agentEditDialog.showModal() : agentEditDialog.setAttribute('open', '');
  const result = await window.subjectiveChat.getAgentRole(id);
  if (!result?.ok) {
    if (agentEditStatus) agentEditStatus.textContent = result?.error || `Could not load ${id}.`;
    return;
  }
  if (agentEditTextarea) agentEditTextarea.value = result.text || '';
  if (agentEditStatus) agentEditStatus.textContent = '';
  agentEditTextarea?.focus();
}

async function stopActiveTurn(frameEl) {
  if (!window.subjectiveChat.cancelLlmMessage) return;
  const index = Number(frameEl?.dataset?.frame ?? focusedFrame);
  const target = (framesEnabled() ? frameTargets[index] : activeTarget) || activeTarget;
  const conversation = target ? conversations.get(target) : null;
  if (!conversation || !conversation.busy) return;
  const button = frameEl?.querySelector('.frame-stop');
  if (button) button.disabled = true; // one press per turn; re-enabled by the next render
  try {
    const result = await window.subjectiveChat.cancelLlmMessage(target);
    if (!result?.ok) {
      rendererLog('error', 'Failed to stop turn', { target, error: result?.error });
      if (button) button.disabled = false;
    }
    // The busy flag is cleared by the broadcast the backend sends, not here, so every
    // connected tab agrees on whether the agent is still running.
  } catch (error) {
    rendererLog('error', 'Failed to stop turn', { target, error: String(error) });
    if (button) button.disabled = false;
  }
}

function selectedLlmProvider() {
  return String(llmProviderSelect?.value || 'codex');
}

// Filled from the backend by loadLlmProviders(). The <option>s in index.html are only a
// pre-load fallback: which agents exist differs between the FastAPI backend and the
// desktop build, and hard-coding them in both index.html files is how Grok ended up
// creatable but unofferable while Cursor was offered where it cannot run.
let llmProviders = [];

function llmProviderLabel(provider) {
  const key = String(provider || '');
  const known = llmProviders.find((item) => item.key === key);
  if (known) return known.label;
  // Pre-load, or a history-only provider (Gemini, ChatGPT) that has no writable
  // datasource and so never appears in the picker but still labels its imported chats.
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Codex';
}

async function loadLlmProviders() {
  if (!window.subjectiveChat.listLlmProviders) return;
  let payload = null;
  try {
    payload = await window.subjectiveChat.listLlmProviders();
  } catch (error) {
    rendererLog('error', 'Failed to load agent list', { error: String(error) });
  }
  const listed = Array.isArray(payload?.providers) ? payload.providers : [];
  if (!listed.length) return; // keep whatever index.html shipped rather than empty the picker
  llmProviders = listed;
  if (!llmProviderSelect) return;
  const previous = llmProviderSelect.value;
  llmProviderSelect.replaceChildren();
  for (const provider of listed) {
    const option = document.createElement('option');
    option.value = provider.key;
    // An agent whose datasource module is missing can still run through its exported
    // bundle, so it stays selectable - just flagged, rather than silently absent.
    option.textContent = provider.available === false ? `${provider.label} (unavailable)` : provider.label;
    llmProviderSelect.appendChild(option);
  }
  const wanted = listed.some((item) => item.key === previous) ? previous : (payload?.default || listed[0].key);
  llmProviderSelect.value = wanted;
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

// --- "Continue as…" sign-in modal -----------------------------------------------------
// Replaces the old window.open('/terminal.html', ...) popup: su and the provider CLI login
// both drive a real pty (see suSessionManager.js), which is why this still needs a text log
// and a generic input, not just a password field - a provider that needs OAuth prints a
// URL/code here instead of a password prompt. The input still defaults to a password field
// since that's what every "Continue as…" login starts with.
let suLoginUsername = null;

const SU_LOGIN_STATE_TEXT = {
  connecting: 'Connecting…',
  'awaiting-password': 'Waiting for password',
  'auth-failed': 'Wrong password — try again',
  'checking-login': 'Checking login…',
  'awaiting-oauth': 'Waiting for browser sign-in',
  ready: 'Signed in',
  error: 'Something went wrong',
  disconnected: 'Disconnected'
};

// Strips the ANSI/control noise a real pty emits (cursor moves, color codes, \r) down to
// readable text - not a full terminal emulator, just enough that a password prompt or an
// OAuth URL reads cleanly in a plain log instead of showing escape codes.
function suLoginCleanChunk(text) {
  return String(text || '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function applySuLoginState(state) {
  if (!suLoginStatus) return;
  suLoginStatus.dataset.state = state;
  suLoginStatus.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  label.textContent = SU_LOGIN_STATE_TEXT[state] || state;
  suLoginStatus.append(dot, label);
  if (suLoginInput) {
    const isOauth = state === 'awaiting-oauth';
    suLoginInput.type = isOauth ? 'text' : 'password';
    suLoginInput.placeholder = isOauth ? 'Response (if needed)' : 'Password';
  }
}

function openSuLoginDialog(username, provider) {
  if (!suLoginDialog) return;
  suLoginUsername = username;
  const label = provider ? providerName(provider) : '';
  if (suLoginTitle) suLoginTitle.textContent = `Sign in as ${username}`;
  if (suLoginSubtitle) {
    suLoginSubtitle.textContent = label
      ? `${label} needs ${username}’s login on this computer to continue.`
      : `Continuing as ${username} needs this computer’s login.`;
  }
  if (suLoginLog) suLoginLog.textContent = '';
  if (suLoginInput) suLoginInput.value = '';
  applySuLoginState('connecting');
  if (suLoginTerminalLink) {
    const providerQuery = provider ? `&provider=${encodeURIComponent(provider)}` : '';
    suLoginTerminalLink.href = `/terminal.html?username=${encodeURIComponent(username)}${providerQuery}`;
  }
  if (suLoginDialog.showModal) suLoginDialog.showModal();
  else suLoginDialog.setAttribute('open', '');
  suLoginInput?.focus();
}

function closeSuLoginDialog() {
  if (!suLoginUsername) return;
  if (suLoginDialog?.close) suLoginDialog.close();
  else suLoginDialog?.removeAttribute('open');
  suLoginUsername = null;
}

function handleSwitchUserEvent(event) {
  if (event.type === 'terminal-needed' && event.username) {
    openSuLoginDialog(event.username, event.provider);
    return;
  }
  if (!suLoginUsername || event.username !== suLoginUsername) return;
  if (event.type === 'pty-data') {
    if (!suLoginLog) return;
    suLoginLog.textContent += suLoginCleanChunk(event.chunk);
    suLoginLog.scrollTop = suLoginLog.scrollHeight;
    return;
  }
  if (event.type === 'status' || event.type === 'provider-status') {
    applySuLoginState(event.status);
    if (event.error && suLoginLog) {
      suLoginLog.textContent += `${suLoginLog.textContent.endsWith('\n') ? '' : '\n'}${event.error}\n`;
      suLoginLog.scrollTop = suLoginLog.scrollHeight;
    }
  }
}

if (window.subjectiveChat.onSwitchUserEvent) window.subjectiveChat.onSwitchUserEvent(handleSwitchUserEvent);

if (suLoginForm) {
  suLoginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!suLoginUsername || !suLoginInput || !window.subjectiveChat.sendSwitchUserPtyInput) return;
    const value = suLoginInput.value;
    suLoginInput.value = '';
    window.subjectiveChat.sendSwitchUserPtyInput(suLoginUsername, `${value}\n`);
  });
}
if (suLoginCloseButton) suLoginCloseButton.addEventListener('click', closeSuLoginDialog);
if (suLoginDialog) {
  suLoginDialog.addEventListener('click', (event) => {
    if (event.target === suLoginDialog) closeSuLoginDialog();
  });
  // Escape (or any other native close) bypasses closeSuLoginDialog() - clear the username
  // directly here too, or a stale suLoginUsername would swallow the next login's events.
  suLoginDialog.addEventListener('close', () => { suLoginUsername = null; });
}

// An SSH chat is a shell on another machine, not a CLI on this one. Three fields in
// this dialog mean something different for it, so the dialog changes shape rather
// than asking for answers that do not apply.
const SSH_PROVIDER = 'ssh';

// Saved connections, ~/.ssh keys and ~/.ssh/config aliases, as the server last sent
// them. Never contains a password: the server reports only whether one is stored.
let sshCatalog = { connections: [], keys: [], configHosts: [] };

// True when the chat being created should run its agent on another machine: either
// the SSH datasource itself, or an LLM with the toggle on.
function usingSsh(provider) {
  return provider === SSH_PROVIDER || Boolean(llmOverSshToggle?.checked);
}

function applyProviderShape(provider) {
  const ssh = usingSsh(provider);
  // The toggle is meaningless for the SSH datasource, which is nothing but SSH.
  const toggleRow = llmOverSshToggle?.closest('label');
  if (toggleRow) toggleRow.hidden = provider === SSH_PROVIDER;
  // "Run as" picks whose *local* CLI login answers, which is meaningless once the
  // agent runs on a different computer — that machine has its own accounts.
  if (llmOsUserRow) llmOsUserRow.hidden = ssh;
  // For the SSH datasource the workspace box *is* the target and is replaced by the
  // picker. For an LLM over SSH it stays: it is the directory the agent works in,
  // now a path on the remote machine.
  const workspaceRow = llmWorkspaceInput?.closest('label');
  const bareSsh = provider === SSH_PROVIDER;
  if (workspaceRow) workspaceRow.hidden = bareSsh;
  if (llmWorkspaceInput) {
    llmWorkspaceInput.required = !bareSsh;
    if (ssh && !bareSsh) llmWorkspaceInput.placeholder = 'a path on the remote machine';
  }
  if (llmWorkspaceLabel && !bareSsh) {
    llmWorkspaceLabel.textContent = ssh ? 'Remote workspace' : 'Workspace';
  }
  if (sshConnectionRow) sshConnectionRow.hidden = !ssh;
  if (!ssh && sshConnectionForm) sshConnectionForm.hidden = true;
  if (llmWorkspaceInput && !ssh && !llmWorkspaceInput.value) llmWorkspaceInput.value = '/subjective';
  if (ssh) applyConnectionChoice();
}

function selectedSshChoice() {
  return sshConnectionSelect ? sshConnectionSelect.value : '';
}

function savedConnection(id) {
  return sshCatalog.connections.find((item) => item.id === id) || null;
}

async function refreshSshCatalog() {
  if (!window.subjectiveChat.listSshConnections || !sshConnectionSelect) return;
  let payload = null;
  try {
    payload = await window.subjectiveChat.listSshConnections();
  } catch (error) {
    rendererLog('error', 'Failed to load SSH connections', { error: String(error) });
    return;
  }
  sshCatalog = {
    connections: Array.isArray(payload?.connections) ? payload.connections : [],
    keys: Array.isArray(payload?.keys) ? payload.keys : [],
    configHosts: Array.isArray(payload?.configHosts) ? payload.configHosts : [],
  };

  const previous = sshConnectionSelect.value;
  sshConnectionSelect.replaceChildren();
  const add = (value, label, parent) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    (parent || sshConnectionSelect).appendChild(option);
    return option;
  };
  const group = (label) => {
    const element = document.createElement('optgroup');
    element.label = label;
    sshConnectionSelect.appendChild(element);
    return element;
  };

  if (sshCatalog.connections.length) {
    const saved = group('Saved');
    for (const item of sshCatalog.connections) {
      const account = item.username ? `${item.username}@` : '';
      add(`saved:${item.id}`, `${item.name} — ${account}${item.host}`, saved);
    }
  }
  if (sshCatalog.configHosts.length) {
    // Already saved, in the place ssh itself reads. Offered, never copied here.
    const fromConfig = group('From ~/.ssh/config');
    for (const item of sshCatalog.configHosts) add(item.host, item.host, fromConfig);
  }
  add('__new__', 'New connection…');
  sshConnectionSelect.value =
    [...sshConnectionSelect.options].some((option) => option.value === previous)
      ? previous
      : (sshCatalog.connections.length ? `saved:${sshCatalog.connections[0].id}` : '__new__');

  // Keys are offered by path; their contents never leave the server.
  if (sshKeySelect) {
    const previousKey = sshKeySelect.value;
    sshKeySelect.replaceChildren();
    if (!sshCatalog.keys.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No keys yet — use Upload…';
      sshKeySelect.appendChild(option);
    }
    for (const key of sshCatalog.keys) {
      const option = document.createElement('option');
      option.value = key.path;
      const where = key.source === 'uploaded' ? 'uploaded' : "server's ~/.ssh";
      option.textContent = key.tooOpen
        ? `${key.name} — too readable, ssh will refuse it`
        : `${key.name} · ${where}`;
      sshKeySelect.appendChild(option);
    }
    if ([...sshKeySelect.options].some((option) => option.value === previousKey)) {
      sshKeySelect.value = previousKey;
    }
  }
  applyKeyShape();
  applyConnectionChoice();
}

function selectedKey() {
  const path = sshKeySelect ? sshKeySelect.value : '';
  return sshCatalog.keys.find((key) => key.path === path) || null;
}

function applyKeyShape() {
  // Only an uploaded key can be removed from here. One in the server's own ~/.ssh
  // belongs to the machine, and deleting it from a chat dialog would be a surprise.
  const key = selectedKey();
  if (sshKeyDeleteButton) sshKeyDeleteButton.hidden = !(key && key.source === 'uploaded');
}

function applyAuthShape() {
  const method = sshAuthSelect ? sshAuthSelect.value : 'agent';
  if (sshKeyRow) sshKeyRow.hidden = method !== 'private_key_path';
  if (sshPasswordRow) sshPasswordRow.hidden = method !== 'password';
  // A passphrase only means anything for a key file; an agent already holds one.
  if (sshPassphraseRow) sshPassphraseRow.hidden = method !== 'private_key_path';
}

function applyConnectionChoice() {
  if (!sshConnectionForm) return;
  const choice = selectedSshChoice();
  const saved = choice.startsWith('saved:') ? savedConnection(choice.slice(6)) : null;
  // The form is for creating or editing. A ~/.ssh/config alias has nothing to edit
  // here — its settings live in that file — so the form stays shut for one.
  sshConnectionForm.hidden = !(choice === '__new__' || saved);
  if (sshTestStatus) sshTestStatus.textContent = '';
  if (sshDeleteButton) sshDeleteButton.hidden = !saved;

  if (saved) {
    sshHostInput.value = saved.host || '';
    sshPortInput.value = saved.port || '';
    sshUsernameInput.value = saved.username || '';
    sshAuthSelect.value = saved.auth_method || 'agent';
    if (sshKeySelect && saved.private_key_path) sshKeySelect.value = saved.private_key_path;
    sshDirectoryInput.value = saved.working_directory || '';
    sshNameInput.value = saved.name || '';
    if (sshHostKeySelect) {
      // A connection saved before the policy existed carries the boolean it replaced.
      sshHostKeySelect.value = saved.host_key_policy
        || (saved.strict_host_key_checking === false ? 'off'
          : saved.strict_host_key_checking === true ? 'strict' : 'accept-new');
    }
    // Stored secrets are never sent to the browser. An empty box with this
    // placeholder means "one is saved"; typing replaces it, clearing it removes it.
    sshPasswordInput.value = '';
    sshPasswordInput.placeholder = saved.hasPassword ? '•••••••• saved' : '';
    sshPassphraseInput.value = '';
    sshPassphraseInput.placeholder = saved.hasKeyPassphrase
      ? '•••••••• saved'
      : 'only if the key is encrypted';
  } else if (choice === '__new__') {
    for (const input of [sshHostInput, sshPortInput, sshUsernameInput, sshDirectoryInput,
                         sshNameInput, sshPasswordInput, sshPassphraseInput]) {
      if (input) input.value = '';
    }
    if (sshAuthSelect) sshAuthSelect.value = 'agent';
    if (sshHostKeySelect) sshHostKeySelect.value = 'accept-new';
    if (sshPasswordInput) sshPasswordInput.placeholder = '';
    if (sshPassphraseInput) sshPassphraseInput.placeholder = 'only if the key is encrypted';
  }
  applyAuthShape();
}

function sshFormValues() {
  const values = {
    host: sshHostInput.value.trim(),
    username: sshUsernameInput.value.trim(),
    auth_method: sshAuthSelect.value,
    working_directory: sshDirectoryInput.value.trim(),
    name: sshNameInput.value.trim(),
    host_key_policy: sshHostKeySelect ? sshHostKeySelect.value : 'accept-new',
  };
  if (sshPortInput.value.trim()) values.port = sshPortInput.value.trim();
  if (values.auth_method === 'private_key_path') {
    values.private_key_path = sshKeySelect ? sshKeySelect.value : '';
    // Only send a secret the operator actually typed: an untouched box means
    // "leave whatever is stored alone", not "clear it".
    if (sshPassphraseInput.value) values.key_passphrase = sshPassphraseInput.value;
  }
  if (values.auth_method === 'password' && sshPasswordInput.value) {
    values.password = sshPasswordInput.value;
  }
  return values;
}

async function refreshLlmStatus() {
  const provider = selectedLlmProvider();
  const label = llmProviderLabel(provider);
  applyProviderShape(provider);
  if (provider !== SSH_PROVIDER && usingSsh(provider)) {
    // Nothing local to probe: the login that matters is on the other machine, and
    // the connection's own Test button is what checks it.
    llmStatusText.textContent = `${label} will run on the machine you pick below. `
      + 'Use Test connection to check it is reachable.';
    llmStatusText.dataset.ready = 'true';
    return;
  }
  if (provider === SSH_PROVIDER) {
    // Nothing to probe until a target exists: the status of "some machine" is not a
    // question, and asking the backend would only report the host as missing.
    llmStatusText.textContent = 'Name a machine above. Credentials come from this '
      + "server's ~/.ssh — a Host alias needs nothing else.";
    llmStatusText.dataset.ready = 'true';
    return;
  }
  llmStatusText.textContent = `Checking ${label} datasource…`;
  llmStatusText.dataset.ready = 'false';
  const status = await window.subjectiveChat.getLlmStatus(provider);
  if (selectedLlmProvider() !== provider) return; // the operator moved on while we asked
  // The machine can change under us too: ticking "run this over SSH" while the probe
  // is in flight rewrites the status, and this answer — about *this* box's CLI login —
  // would then land on top of it and describe a login the chat will never use.
  if (usingSsh(provider)) return;
  llmStatusText.textContent = status.ok
    ? `Ready · ${status.cli_version || `${label} CLI`} · existing login`
    : `${status.status || 'Unavailable'} · ${status.error || `${label} CLI login required`}`;
  llmStatusText.dataset.ready = status.ok ? 'true' : 'false';
}

async function refreshLlmOsUsers() {
  // Each agent keeps its credentials in a home directory, so which accounts can answer
  // differs per agent: the Codex logins on this box are not the Claude ones. Re-asked
  // whenever the agent changes rather than listed once.
  if (!llmOsUserSelect || !window.subjectiveChat.listProviderSessions) return;
  const provider = selectedLlmProvider();
  if (provider === SSH_PROVIDER) return; // no local login is involved
  let listed = null;
  try {
    listed = await window.subjectiveChat.listProviderSessions(provider);
  } catch (error) {
    rendererLog('error', 'Failed to list agent logins', { provider, error: String(error) });
  }
  if (selectedLlmProvider() !== provider) return; // the operator moved on while we asked
  const users = Array.isArray(listed?.users) ? listed.users : [];
  const previous = llmOsUserSelect.value;
  llmOsUserSelect.replaceChildren();
  const current = listed?.currentUser || '';
  for (const user of users) {
    const option = document.createElement('option');
    // The service account's own chats carry no osUser — that flag means "route through
    // someone else's session", and setting it for ourselves would demand a connection.
    option.value = user.current ? '' : user.username;
    const state = user.ready ? '' : (user.unknown ? ' · login unknown' : ' · not logged in');
    option.textContent = `${user.username}${user.current ? ' (this machine)' : ''}${state}`;
    llmOsUserSelect.appendChild(option);
  }
  if (!users.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = current ? `${current} (this machine)` : "This machine's account";
    llmOsUserSelect.appendChild(option);
  }
  const stillThere = [...llmOsUserSelect.options].some((option) => option.value === previous);
  llmOsUserSelect.value = stillThere ? previous : '';
}

async function openLlmDialog() {
  if (!llmDialog) return;
  llmDialog.showModal ? llmDialog.showModal() : llmDialog.setAttribute('open', '');
  applyProviderShape(selectedLlmProvider());
  llmNameInput.focus();
  await Promise.all([refreshLlmStatus(), refreshLlmOsUsers(), refreshSshCatalog()]);
  applyProviderShape(selectedLlmProvider());
}

async function importLlmChatsFromZip(file) {
  if (!window.subjectiveChat.importLlmChats || !file) return;
  const originalTitle = importLlmButton.title;
  importLlmButton.disabled = true;
  importLlmButton.title = 'Importing chats…';
  try {
    const result = await window.subjectiveChat.importLlmChats(file);
    if (!result?.ok) {
      rendererLog('error', 'Failed to import chats', { error: result?.error });
      window.alert(result?.error || 'Could not import chats from that zip.');
      return;
    }
    await loadLlmConversations();
    const errorNote = result.errors?.length ? ` (${result.errors.length} file(s) could not be read)` : '';
    window.alert(`Imported ${result.imported} chat(s), skipped ${result.skipped} already-known chat(s).${errorNote}`);
  } finally {
    importLlmButton.disabled = false;
    importLlmButton.title = originalTitle;
  }
}

if (importLlmButton && importLlmFileInput) {
  importLlmButton.addEventListener('click', () => importLlmFileInput.click());
  importLlmFileInput.addEventListener('change', async () => {
    const file = importLlmFileInput.files?.[0];
    importLlmFileInput.value = '';
    if (file) await importLlmChatsFromZip(file);
  });
}

if (createLlmButton) createLlmButton.addEventListener('click', openLlmDialog);
if (agentCloseButton) agentCloseButton.addEventListener('click', () => agentDialog.close());
if (agentForm) {
  agentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = String(agentIdInput?.value || '').trim().toLowerCase();
    const result = await window.subjectiveChat.createAgent({
      id,
      capability: String(agentCapabilityInput?.value || '').trim(),
      model: String(agentModelSelect?.value || '')
    });
    if (!result?.ok) {
      if (agentDialogStatus) agentDialogStatus.textContent = result?.error || 'Could not create the agent.';
      return;
    }
    agentDialog.close();
    // Re-read rather than trusting the local copy: the registry is a file two processes
    // can edit, and the row order is the file's, not ours.
    await loadAgents();
  });
}
if (agentEditCloseButton) agentEditCloseButton.addEventListener('click', () => agentEditDialog.close());
if (agentEditForm) {
  agentEditForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = agentEditForm.getAttribute('data-agent-id') || '';
    if (!id || !window.subjectiveChat.saveAgentRole) return;
    const result = await window.subjectiveChat.saveAgentRole(id, agentEditTextarea?.value || '');
    if (!result?.ok) {
      if (agentEditStatus) agentEditStatus.textContent = result?.error || 'Could not save the agent.';
      return;
    }
    agentEditDialog.close();
    await loadAgents();
  });
}
async function resolveSshWorkspace() {
  const choice = selectedSshChoice();
  const fail = (message, focus) => {
    llmStatusText.textContent = message;
    llmStatusText.dataset.ready = 'false';
    if (focus) focus.focus();
    return '';
  };

  // A ~/.ssh/config alias is already a complete connection; store it as-is.
  if (choice && choice !== '__new__' && !choice.startsWith('saved:')) return choice;

  const values = sshFormValues();
  if (!values.host) return fail('Name the machine this chat connects to.', sshHostInput);

  const existing = choice.startsWith('saved:') ? choice.slice(6) : '';
  if (existing) {
    const updated = await window.subjectiveChat.updateSshConnection({ id: existing, ...values });
    if (!updated?.ok) return fail(updated?.error || 'Could not save the connection.', sshHostInput);
    return `saved:${existing}`;
  }
  // Naming it is what makes it reusable; without a name this chat gets the target
  // written out longhand and nothing is stored.
  if (!values.name) {
    const account = values.username ? `${values.username}@` : '';
    const path = values.working_directory ? `:${values.working_directory}` : '';
    if (values.auth_method !== 'agent') {
      return fail('Give this connection a name so its key or password can be saved.', sshNameInput);
    }
    return `${account}${values.host}${path}`;
  }
  const created = await window.subjectiveChat.saveSshConnection(values);
  if (!created?.ok) return fail(created?.error || 'Could not save the connection.', sshHostInput);
  await refreshSshCatalog();
  sshConnectionSelect.value = `saved:${created.connection.id}`;
  applyConnectionChoice();
  return `saved:${created.connection.id}`;
}

// --- answering a password prompt ---------------------------------------------------

const sshSecretDialog = document.getElementById('sshSecretDialog');
const sshSecretForm = document.getElementById('sshSecretForm');
const sshSecretInput = document.getElementById('sshSecretInput');
const sshSecretPrompt = document.getElementById('sshSecretPrompt');
let sshSecretTarget = '';

function openSshSecretDialog(target, prompt) {
  if (!sshSecretDialog || sshSecretDialog.open) return;
  sshSecretTarget = target || activeTarget;
  if (sshSecretPrompt) sshSecretPrompt.textContent = prompt;
  if (sshSecretInput) sshSecretInput.value = '';
  sshSecretDialog.showModal ? sshSecretDialog.showModal() : sshSecretDialog.setAttribute('open', '');
  if (sshSecretInput) sshSecretInput.focus();
}

function closeSshSecretDialog() {
  // Clear before closing, so the value does not sit in the DOM until next time.
  if (sshSecretInput) sshSecretInput.value = '';
  sshSecretTarget = '';
  if (sshSecretDialog?.open) sshSecretDialog.close();
}

if (sshSecretForm) sshSecretForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const secret = sshSecretInput.value;
  const target = sshSecretTarget;
  closeSshSecretDialog();
  if (!secret || !target) return;
  try {
    const result = await window.subjectiveChat.sendSshSecret(target, secret);
    if (!result?.ok) addEvent('system', { target, text: result?.error || 'Could not send that input.' });
  } catch (error) {
    addEvent('system', { target, text: `Could not send that input: ${error.message}` });
  }
});
document.getElementById('sshSecretCloseButton')?.addEventListener('click', closeSshSecretDialog);
document.getElementById('sshSecretCancelButton')?.addEventListener('click', closeSshSecretDialog);

// Loaded at startup, not just when the dialog opens: the chat list's SSH markers
// name the machine each chat runs on, and that name comes from here.
refreshSshCatalog().then(() => renderConversations()).catch(() => {});

if (llmOverSshToggle) llmOverSshToggle.addEventListener('change', () => {
  applyProviderShape(selectedLlmProvider());
  refreshLlmStatus();
});
if (sshConnectionSelect) sshConnectionSelect.addEventListener('change', applyConnectionChoice);
if (sshAuthSelect) sshAuthSelect.addEventListener('change', applyAuthShape);
if (sshKeySelect) sshKeySelect.addEventListener('change', applyKeyShape);

if (sshKeyUploadButton) sshKeyUploadButton.addEventListener('click', () => sshKeyFileInput.click());

if (sshKeyFileInput) sshKeyFileInput.addEventListener('change', async () => {
  const file = sshKeyFileInput.files && sshKeyFileInput.files[0];
  // Clear it immediately: re-picking the same file fires no change event otherwise,
  // so a failed upload could not be retried with the same key.
  sshKeyFileInput.value = '';
  if (!file) return;
  sshTestStatus.textContent = `Uploading ${file.name}…`;
  sshTestStatus.dataset.ok = '';
  try {
    const content = await file.text();
    const result = await window.subjectiveChat.uploadSshKey(file.name, content);
    if (!result?.ok) {
      sshTestStatus.textContent = result?.error || 'Could not store that key.';
      sshTestStatus.dataset.ok = 'false';
      return;
    }
    await refreshSshCatalog();
    // Selecting it is the point of having uploaded it.
    if (sshAuthSelect) sshAuthSelect.value = 'private_key_path';
    if (sshKeySelect) sshKeySelect.value = result.key.path;
    applyAuthShape();
    applyKeyShape();
    sshTestStatus.textContent = `${result.key.name} added.`;
    sshTestStatus.dataset.ok = 'true';
  } catch (error) {
    sshTestStatus.textContent = String(error);
    sshTestStatus.dataset.ok = 'false';
  }
});

if (sshKeyDeleteButton) sshKeyDeleteButton.addEventListener('click', async () => {
  const key = selectedKey();
  if (!key || key.source !== 'uploaded') return;
  if (!window.confirm(`Delete the uploaded key “${key.name}” from the server?`)) return;
  const result = await window.subjectiveChat.deleteSshKey(key.path);
  if (!result?.ok) {
    sshTestStatus.textContent = result?.error || 'Could not delete that key.';
    sshTestStatus.dataset.ok = 'false';
    return;
  }
  await refreshSshCatalog();
  sshTestStatus.textContent = `${key.name} deleted.`;
  sshTestStatus.dataset.ok = '';
});

if (sshTestButton) sshTestButton.addEventListener('click', async () => {
  // The failures worth catching — a wrong account, an unreadable key, a changed
  // host key — are otherwise only discoverable by starting a chat and watching it
  // fail, which leaves a dead conversation behind.
  const choice = selectedSshChoice();
  const payload = choice.startsWith('saved:') && !sshHostInput.value.trim()
    ? { id: choice.slice(6) }
    : sshFormValues();
  if (!payload.id && !payload.host) {
    sshTestStatus.textContent = 'Name a host first.';
    return;
  }
  sshTestButton.disabled = true;
  sshTestStatus.textContent = 'Connecting…';
  try {
    const result = await window.subjectiveChat.testSshConnection(payload);
    sshTestStatus.textContent = result?.ok
      ? 'Connected.'
      : `${result?.status || 'Failed'} — ${result?.error || 'could not connect'}`;
    sshTestStatus.dataset.ok = result?.ok ? 'true' : 'false';
  } catch (error) {
    sshTestStatus.textContent = String(error);
    sshTestStatus.dataset.ok = 'false';
  } finally {
    sshTestButton.disabled = false;
  }
});

if (sshDeleteButton) sshDeleteButton.addEventListener('click', async () => {
  const choice = selectedSshChoice();
  if (!choice.startsWith('saved:')) return;
  const saved = savedConnection(choice.slice(6));
  if (!window.confirm(`Delete the saved connection “${saved?.name || choice}”?`)) return;
  await window.subjectiveChat.deleteSshConnection(choice.slice(6));
  await refreshSshCatalog();
});

if (llmProviderSelect) {
  llmProviderSelect.addEventListener('change', () => {
    refreshLlmStatus();
    refreshLlmOsUsers();
  });
}
if (llmCloseButton) llmCloseButton.addEventListener('click', () => llmDialog.close());
if (llmDialog) llmDialog.addEventListener('click', (event) => {
  if (event.target === llmDialog) llmDialog.close();
});
if (llmForm) llmForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const provider = selectedLlmProvider();
  let workspace = llmWorkspaceInput.value.trim();
  let sshConnection = '';
  if (provider === SSH_PROVIDER) {
    // The chat stores one string. For SSH it is either `saved:<id>`, which carries
    // the key and options with it, or a plain target for a ~/.ssh/config alias.
    workspace = await resolveSshWorkspace();
    if (!workspace) return;
  } else if (usingSsh(provider)) {
    // An agent over SSH keeps its workspace as the remote directory and names the
    // machine separately — the two answer different questions.
    const reference = await resolveSshWorkspace();
    if (!reference) return;
    if (!reference.startsWith('saved:')) {
      llmStatusText.textContent = 'Give this connection a name so the chat can refer to it.';
      llmStatusText.dataset.ready = 'false';
      sshNameInput.focus();
      return;
    }
    sshConnection = reference.slice('saved:'.length);
  }
  const result = await window.subjectiveChat.createLlmConversation({
    name: llmNameInput.value,
    workspace,
    provider,
    sshConnection,
    // Never both. "Run as" asks the backend to su into a local account first, which
    // is meaningless once the agent runs on another computer — and the backend
    // checks it before anything else, so sending one would make an SSH chat fail
    // with "reconnect as <user>" and never reach SSH at all. Hiding the row was not
    // enough: a hidden <select> still has a value.
    osUser: usingSsh(provider) ? '' : (llmOsUserSelect ? llmOsUserSelect.value : '')
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
  mobileMenuButton.addEventListener('click', () => openMobileDrawer('conversations'));
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

// Crossing the 720px breakpoint in either direction: hand the borrowed panels
// back to the rail when the viewport grows, so a rotation or an iframe resize
// never leaves Chats and Users stranded inside a closed dialog.
if (mobileDrawer) {
  const mobileQuery = window.matchMedia('(max-width: 720px)');
  const onBreakpointChange = () => syncMobileLayout();
  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onBreakpointChange);
  else mobileQuery.addListener(onBreakpointChange);
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
  syncMobileLayout();
});

window.subjectiveChat.onEvent((event) => {
  switch (event.type) {
    case 'socket-reconnected': {
      // The socket dropped and came back; while it was down we may have missed the agent's
      // reply and the llm-busy:false that re-enables the UI. Re-hydrate the open chat from
      // the server (authoritative busy + any messages that landed) so the view catches up.
      const open = conversations.get(activeTarget);
      if (open?.kind === 'llm' && window.subjectiveChat.getLlmConversation) {
        window.subjectiveChat.getLlmConversation(activeTarget).then((loaded) => {
          if (loaded?.ok) upsertLlmConversation(loaded.conversation);
        }).catch(() => {});
      }
      break;
    }
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
      rendererLog('info', 'History refresh event', { count: event.count, activeTarget });
      if ([...conversations.values()].some((item) => item.busy)) {
        rendererLog('info', 'History refresh skipped (send in flight)', { activeTarget });
        break;
      }
      loadLlmConversations();
      break;
    case 'conversation-rename-request':
      beginRenameConversation(event.target);
      break;
    case 'agent-edit-request':
      beginEditAgent(event.id);
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
    case 'conversation-delete-request':
      confirmDeleteConversation(event.target);
      break;
    case 'llm-conversation-deleted':
      if (!conversations.has(event.target)) break;
      conversations.delete(event.target);
      // setActiveTarget() re-renders the list itself; the non-active branch has to do it
      // explicitly since nothing else about the view is changing.
      if (event.target === activeTarget) setActiveTarget(config.channel);
      else renderConversations();
      break;
    case 'llm-choose-session':
      openSessionPicker(event);
      break;
    case 'llm-switch-user':
      // The new sibling conversation was already added via the llm-conversation event
      // just before this one; switch the view over to it now that it exists.
      if (conversations.has(event.target)) setActiveTarget(event.target);
      // Definitive "su login + provider login both succeeded" signal - closes whatever
      // the awaiting-password modal was still showing rather than guessing it from a
      // status/provider-status event, since providers that skip a separate login step
      // never emit a provider-status at all.
      if (suLoginUsername && suLoginUsername === event.osUser) closeSuLoginDialog();
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
    case 'llm-progress': {
      const conversation = conversations.get(event.target);
      if (conversation && event.text) {
        conversation.progress = event.text;
        if (!Array.isArray(conversation.thoughts)) conversation.thoughts = [];
        // Skip a repeat of the step we already show — a stream re-sends the same status
        // several times, and duplicated rows read as churn rather than progress.
        if (conversation.thoughts[conversation.thoughts.length - 1] !== event.text) {
          conversation.thoughts.push(event.text);
          if (conversation.thoughts.length > 100) conversation.thoughts.shift();
        }
        updateThinkingSteps(event.target, conversation);
      }
      break;
    }
    case 'llm-busy': {
      const conversation = conversations.get(event.target);
      if (conversation) {
        conversation.busy = event.busy;
        conversation.busySince = event.busy ? Date.now() : 0;
        // A new turn starts its own step list; a finished turn drops the live status.
        if (event.busy) conversation.thoughts = [];
        else conversation.progress = '';
        rendererLog('info', event.busy ? 'LLM busy' : 'LLM idle', {
          target: event.target,
          provider: conversation.provider,
          label: conversation.label
        });
        if (isTargetOnScreen(event.target)) {
          if (event.target === activeTarget && input) {
            // Busy leaves the composer typable; see syncChatFrame.
            input.disabled = false;
            input.placeholder = event.busy ? `${providerName(conversation.provider)} is working…` : `Message ${providerName(conversation.provider)}`;
          }
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
  initChatFrames();
  activeTarget = config.channel;
  ensureConversation(config.channel, config.channel, 'channel');
  const restored = framesEnabled() ? (frameTargets[focusedFrame] || visibleFrameTargets()[0]) : '';
  if (restored) setActiveTarget(restored, { skipFrame: true });
  else setActiveTarget(config.channel);
  await loadLlmConversations();
  if (framesEnabled()) {
    for (const target of visibleFrameTargets()) {
      const conversation = conversations.get(target);
      if (conversation?.kind === 'llm' && !conversation.hydrated && !conversation.loading) {
        setActiveTarget(target, { skipFrame: true });
      }
    }
    if (frameTargets[focusedFrame]) setActiveTarget(frameTargets[focusedFrame], { skipFrame: true });
    renderVisibleFrameTranscripts();
  }
  syncMobileLayout();
  loadLlmProviders().then(loadAgents);
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
  const topbarCollapseToggle = document.getElementById('topbarCollapseToggle');
  if (topbarCollapseToggle) {
    const key = 'subjective-chat-topbar-collapsed';
    const applyCollapsed = (collapsed) => {
      document.body.classList.toggle('topbar-collapsed', collapsed);
      topbarCollapseToggle.setAttribute('aria-expanded', String(!collapsed));
      topbarCollapseToggle.title = collapsed ? 'Show toolbar' : 'Collapse toolbar';
    };
    const stored = localStorage.getItem(key);
    applyCollapsed(stored === '1' || (stored === null && isMobileLayout()));
    topbarCollapseToggle.addEventListener('click', () => {
      const collapsed = !document.body.classList.contains('topbar-collapsed');
      localStorage.setItem(key, collapsed ? '1' : '0');
      applyCollapsed(collapsed);
    });
  }
});
