(function () {
  const term = new Terminal({
    fontFamily: 'Menlo, Consolas, monospace',
    fontSize: 13,
    theme: { background: '#0b0d12', foreground: '#e6e6e6', cursor: '#e6e6e6' },
    cursorBlink: true,
    scrollback: 2000
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('term'));
  fitAddon.fit();

  const statusLine = document.getElementById('statusLine');
  statusLine.textContent = `Connecting as ${window.terminalBridge.username}…`;

  term.onData((data) => window.terminalBridge.sendInput(data));
  window.terminalBridge.onData((chunk) => term.write(chunk));
  window.terminalBridge.onStatus((status) => { statusLine.textContent = describeStatus(status); });

  function describeStatus(status) {
    const username = window.terminalBridge.username;
    switch (status.status) {
      case 'connecting': return `Connecting as ${username}…`;
      case 'awaiting-password': return `Type ${username}'s password and press Enter.`;
      case 'ready': return `Connected as ${username}.`;
      case 'auth-failed': return status.error ? `${status.error} — try again.` : 'Authentication failed — try again.';
      case 'error': return status.error || 'Something went wrong.';
      default: return '';
    }
  }

  function sendResize() {
    fitAddon.fit();
    window.terminalBridge.resize(term.cols, term.rows);
  }
  window.addEventListener('resize', sendResize);
  sendResize();
})();
