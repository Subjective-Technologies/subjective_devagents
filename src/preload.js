const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('subjectiveChat', {
  connect: () => ipcRenderer.invoke('irc:connect'),
  disconnect: () => ipcRenderer.invoke('irc:disconnect'),
  sendMessage: (target, text) => ipcRenderer.invoke('irc:send-message', { target, text }),
  executeCommand: (command, target) => ipcRenderer.invoke('irc:execute-command', { command, target }),
  listLlmConversations: (opts = {}) => ipcRenderer.invoke('llm:list-conversations', opts),
  getLlmConversation: (target) => ipcRenderer.invoke('llm:get-conversation', { target }),
  reloadLlmConversation: (target) => ipcRenderer.invoke('llm:reload-conversation', { target }),
  activateLlmConversation: (target) => ipcRenderer.invoke('llm:activate-conversation', { target }),
  createLlmConversation: (payload) => ipcRenderer.invoke('llm:create-conversation', payload),
  renameLlmConversation: (target, name) => ipcRenderer.invoke('llm:rename-conversation', { target, name }),
  deleteLlmConversation: (target) => ipcRenderer.invoke('llm:delete-conversation', { target }),
  refreshLlmHistory: () => ipcRenderer.invoke('llm:refresh-history'),
  getLlmStatus: (provider) => ipcRenderer.invoke('llm:status', { provider }),
  listProviderSessions: (provider) => ipcRenderer.invoke('llm:sessions', { provider }),
  sendLlmMessage: (target, text, files = []) => ipcRenderer.invoke('llm:send-message', { target, text, files }),
  listSystemUsers: () => ipcRenderer.invoke('system:list-users'),
  getSwitchUserStatus: (username) => ipcRenderer.invoke('switchuser:status', { username }),
  showConversationContextMenu: (target, x, y) => ipcRenderer.invoke('conversation:context-menu', { target, x, y }),
  continueAsUser: (target, username) => ipcRenderer.invoke('switchuser:continue-as', { target, username }),
  disconnectSwitchUser: (username) => ipcRenderer.invoke('switchuser:disconnect', { username }),
  onSwitchUserEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('switchuser:event', listener);
    return () => ipcRenderer.removeListener('switchuser:event', listener);
  },
  sendImage: (target) => ipcRenderer.invoke('dcc:send-image', { target }),
  sendImageData: (payload) => ipcRenderer.invoke('dcc:send-image-data', payload),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  revealPath: (filePath) => ipcRenderer.invoke('file:reveal', { filePath }),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', { url }),
  log: (level, message, details) => ipcRenderer.invoke('app:log', { level, message, details }),
  getConfig: () => ipcRenderer.invoke('app:config'),
  saveConfig: (payload) => ipcRenderer.invoke('app:save-config', payload),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  }
});
