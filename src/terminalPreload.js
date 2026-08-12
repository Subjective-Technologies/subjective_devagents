// Minimal preload for the "Continue as…" su/login terminal window. Deliberately exposes
// far less than the main window's preload.js - just enough to drive one pty for one
// already-known username, matching the main window's contextIsolation/nodeIntegration
// posture (see createWindow() in main.js) on a least-privilege basis.
const { contextBridge, ipcRenderer } = require('electron');

const username = new URL(window.location.href).searchParams.get('username') || '';

contextBridge.exposeInMainWorld('terminalBridge', {
  username,
  sendInput: (data) => ipcRenderer.invoke('switchuser:pty-input', { username, data }),
  resize: (cols, rows) => ipcRenderer.invoke('switchuser:pty-resize', { username, cols, rows }),
  onData: (callback) => {
    const listener = (_event, payload) => {
      if (payload?.type === 'pty-data' && payload.username === username) callback(payload.chunk);
    };
    ipcRenderer.on('switchuser:event', listener);
    return () => ipcRenderer.removeListener('switchuser:event', listener);
  },
  onStatus: (callback) => {
    const listener = (_event, payload) => {
      if (payload?.type === 'status' && payload.username === username) callback(payload);
    };
    ipcRenderer.on('switchuser:event', listener);
    return () => ipcRenderer.removeListener('switchuser:event', listener);
  }
});
