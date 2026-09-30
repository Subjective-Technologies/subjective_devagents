// Chat code never loads or fetches conversations until the backend accepts login.
(async function () {
  try {
    await window.devagentsAuth.ready;
    const scripts = document.body.dataset.page === 'terminal'
      ? ['/terminalWebBridge.js?v=DEVAGENTS_DEPLOY_VERSION', '/terminal-renderer.js?v=DEVAGENTS_DEPLOY_VERSION']
      : ['/webBridge.js?v=DEVAGENTS_DEPLOY_VERSION', '/messageRenderer.js?v=DEVAGENTS_DEPLOY_VERSION', '/taggyClient.js?v=DEVAGENTS_DEPLOY_VERSION', '/renderer.js?v=DEVAGENTS_DEPLOY_VERSION'];
    for (const source of scripts) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = source;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }
  } catch (_error) {
    document.getElementById('ownerAuthPanel').hidden = false;
    document.getElementById('ownerAuthStatus').textContent = 'Chat could not load. Please reload.';
  }
}());
