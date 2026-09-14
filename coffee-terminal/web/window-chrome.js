'use strict';
(() => {
  let mounted = false;
  const icon = path => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${path}"/></svg>`;
  async function mount() {
    if (mounted) return;
    const preview = new URLSearchParams(location.search).get('windowChromePreview') === '1';
    const bridge = window.pywebview?.api;
    let state = { enabled: preview, maximized: false };
    if (bridge?.get_window_chrome) {
      try { state = await bridge.get_window_chrome(); } catch (_) { return; }
    }
    if (!state?.enabled && !preview) return;
    mounted = true;
    document.body.classList.add('windows-frameless');
    const bar = document.createElement('header');
    bar.className = 'window-chrome';
    bar.setAttribute('aria-label', '窗口控制');
    bar.innerHTML = `<div class="window-chrome-drag pywebview-drag-region" title="拖动窗口">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="11" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 9a3 3 0 0 1 0 6M8.5 9h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>COFFEE TERMINAL</span></div>
      <div class="window-chrome-actions">
        <button class="window-chrome-button minimize" type="button" aria-label="最小化" title="最小化">${icon('M4 11.5h8')}</button>
        <button class="window-chrome-button maximize" type="button" aria-label="最大化" title="最大化">${icon('M4.5 4.5h7v7h-7z')}</button>
        <button class="window-chrome-button close" type="button" aria-label="关闭" title="关闭">${icon('M4.5 4.5l7 7m0-7-7 7')}</button>
      </div>`;
    document.body.prepend(bar);
    const maximize = bar.querySelector('.maximize');
    const updateMaximize = maximized => {
      document.body.classList.toggle('window-maximized', Boolean(maximized));
      const label = maximized ? '还原' : '最大化';
      maximize.title = label;
      maximize.setAttribute('aria-label', label);
      maximize.innerHTML = maximized ? icon('M6 4.5h5.5V10M4.5 6H10v5.5H4.5z') : icon('M4.5 4.5h7v7h-7z');
    };
    updateMaximize(state.maximized);
    const invoke = async action => {
      if (!bridge?.window_control) return;
      const result = await bridge.window_control(action);
      if (result?.ok && action === 'toggle-maximize') updateMaximize(result.maximized);
    };
    bar.querySelector('.minimize').onclick = () => invoke('minimize');
    maximize.onclick = () => invoke('toggle-maximize');
    bar.querySelector('.close').onclick = () => invoke('close');
    bar.querySelector('.window-chrome-drag').ondblclick = () => invoke('toggle-maximize');
  }
  if (window.pywebview?.api) mount();
  else window.addEventListener('pywebviewready', mount, { once: true });
  if (new URLSearchParams(location.search).get('windowChromePreview') === '1') mount();
})();
