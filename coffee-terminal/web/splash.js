(() => {
  const texture = document.getElementById('beanTexture');
  let seed = 0x5141524d;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let index = 0; index < 34; index += 1) {
    const bean = document.createElement('img');
    bean.className = 'bean-mark';
    bean.src = 'assets/brand/marks/bean.svg';
    bean.alt = '';
    bean.style.setProperty('--x', `${3 + random() * 94}%`);
    bean.style.setProperty('--y', `${3 + random() * 94}%`);
    bean.style.setProperty('--size', `${16 + random() * 25}px`);
    bean.style.setProperty('--rotation', `${Math.round(random() * 360)}deg`);
    bean.style.setProperty('--opacity', `${(0.025 + random() * 0.045).toFixed(3)}`);
    texture.appendChild(bean);
  }

  window.startupFailed = (message) => {
    document.getElementById('startupError').textContent = message || '启动失败，请检查设备配置后重试。';
    document.querySelector('.splash').classList.add('has-error');
    document.getElementById('progressGlyph').setAttribute('aria-valuetext', '启动失败');
  };
})();
