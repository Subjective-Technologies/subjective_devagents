(function () {
  if (window.subjectiveChat) return;

  const capacitor = window.Capacitor;
  const plugin = capacitor && capacitor.Plugins && capacitor.Plugins.SubjectiveIrc;
  const listeners = new Set();

  function emit(event) {
    for (const listener of listeners) listener(event);
  }

  function missingPluginResult() {
    emit({ type: 'status', state: 'error', text: 'Android IRC bridge is unavailable.' });
    return Promise.resolve({ ok: false });
  }

  if (plugin && plugin.addListener) {
    plugin.addListener('appEvent', emit);
  }

  window.subjectiveChat = {
    connect: () => plugin ? plugin.connect() : missingPluginResult(),
    disconnect: () => plugin ? plugin.disconnect() : missingPluginResult(),
    sendMessage: (target, text) => plugin ? plugin.sendMessage({ target, text }) : missingPluginResult(),
    executeCommand: (command, target) => plugin ? plugin.executeCommand({ command, target }) : missingPluginResult(),
    sendImage: (target) => plugin ? plugin.sendImage({ target }) : missingPluginResult(),
    sendImageData: (payload) => plugin ? plugin.sendImageData(payload) : missingPluginResult(),
    openFile: (filePath) => plugin ? plugin.openFile({ filePath }) : Promise.resolve({ ok: true }),
    log: (level, message, details) => plugin ? plugin.log({ level, message, details }) : Promise.resolve({ ok: true }),
    saveConfig: (payload) => plugin ? plugin.saveConfig(payload) : missingPluginResult(),
    getConfig: () => plugin
      ? plugin.getConfig()
      : Promise.resolve({
          host: '192.168.0.250',
          port: 6667,
          tls: false,
          channel: '#subjective',
          nick: 'Tomasso',
          realname: 'Tomasso',
          bookmarks: [],
          downloadDir: ''
        }),
    onEvent: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
}());
