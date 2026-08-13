// Owns the small visible terminal window(s) used for the "Continue as…" su/login flow.
// Closing this window never touches the underlying pty/session - it only stops
// forwarding pty output to a UI (see SuSessionManager.detachViewer). The session itself
// keeps running headless until it's explicitly disconnected or the app quits.
const { BrowserWindow } = require('electron');
const path = require('path');

const windows = new Map(); // username -> BrowserWindow

function openTerminalWindow(username, { parent, suSessionManager } = {}) {
  const existing = windows.get(username);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width: 720,
    height: 460,
    parent,
    backgroundColor: '#0b0d12',
    title: `Continue as ${username}`,
    webPreferences: {
      preload: path.join(__dirname, 'terminalPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  windows.set(username, win);

  // Named so the exact same function reference can be removed on close - attachViewer now
  // supports multiple simultaneous viewers (e.g. a browser tab watching the same session
  // too), so detachViewer needs to know precisely which one this window owns.
  const viewer = (chunk) => {
    if (!win.isDestroyed()) win.webContents.send('switchuser:event', { type: 'pty-data', username, chunk });
  };
  if (suSessionManager) suSessionManager.attachViewer(username, viewer);

  win.on('closed', () => {
    windows.delete(username);
    suSessionManager?.detachViewer(username, viewer);
  });

  win.loadFile(path.join(__dirname, 'terminal.html'), { query: { username } });
  return win;
}

function closeTerminalWindow(username) {
  const win = windows.get(username);
  if (win && !win.isDestroyed()) win.close();
}

function getTerminalWindow(username) {
  const win = windows.get(username);
  return win && !win.isDestroyed() ? win : null;
}

function closeAllTerminalWindows() {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.destroy();
  }
  windows.clear();
}

module.exports = { openTerminalWindow, closeTerminalWindow, getTerminalWindow, closeAllTerminalWindows };
