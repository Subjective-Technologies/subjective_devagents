const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('subjectiveChat', {
  connect: () => ipcRenderer.invoke('irc:connect'),
  disconnect: () => ipcRenderer.invoke('irc:disconnect'),
  sendMessage: (target, text) => ipcRenderer.invoke('irc:send-message', { target, text }),
  executeCommand: (command, target) => ipcRenderer.invoke('irc:execute-command', { command, target }),
  sendImage: (target) => ipcRenderer.invoke('dcc:send-image', { target }),
  sendImageData: (payload) => ipcRenderer.invoke('dcc:send-image-data', payload),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  log: (level, message, details) => ipcRenderer.invoke('app:log', { level, message, details }),
  getConfig: () => ipcRenderer.invoke('app:config'),
  saveConfig: (payload) => ipcRenderer.invoke('app:save-config', payload),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  }
});
