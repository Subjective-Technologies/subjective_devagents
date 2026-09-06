(function fitAppToWindow() {
  function apply() {
    const viewport = window.visualViewport;
    const height = Math.max(1, Math.round((viewport && viewport.height) || window.innerHeight || document.documentElement.clientHeight));
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  }
  apply();
  window.addEventListener('resize', apply);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', apply);
    window.visualViewport.addEventListener('scroll', apply);
  }
})();
