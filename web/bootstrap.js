// Chat code never loads or fetches conversations until the backend accepts login.
(async function () {
  try {
    await window.devagentsAuth.ready;
    const scripts = document.body.dataset.page === 'terminal'
      ? ['/terminalWebBridge.js?v=20260911auth1', '/terminal-renderer.js?v=20260827c']
      : ['/webBridge.js?v=20260911auth1', '/messageRenderer.js?v=20260911b', '/renderer.js?v=20260911b'];
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
