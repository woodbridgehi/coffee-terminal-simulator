'use strict';

const $ = id => document.getElementById(id);
let cities = new Map();

function api() { return window.pywebview && window.pywebview.api; }
async function ready() {
  if (api()) return;
  await new Promise(resolve => window.addEventListener('pywebviewready', resolve, { once: true }));
}
function number(value) { return String(value || '').replace(/\D/g, '').slice(0, 6); }
function refreshPreview() {
  const deviceNumber = number($('deviceNumber').value);
  const storeNumber = number($('storeNumber').value);
  const year = $('serialYear').value || 'YYYY';
  const city = cities.get($('cityCode').value);
  $('deviceIdPreview').textContent = `coffee-bot-${deviceNumber || '…'}`;
  $('serialPreview').textContent = `CB-${year}-${deviceNumber || '…'}`;
  $('timezone').value = city ? city.timezone : '';
  $('storeIdPreview').value = city && storeNumber ? `store-${city.code.toLowerCase()}-${storeNumber}` : '';
}
function setConnection(message, error = false) {
  const el = $('connection'); el.textContent = message; el.style.color = error ? '#b33b2c' : '';
}
async function initialize() {
  await ready();
  const state = await api().get_setup_state();
  const currentYear = new Date().getFullYear();
  for (let year = 2025; year <= 2035; year += 1) {
    const option = document.createElement('option'); option.value = year; option.textContent = `${year} 年`;
    option.selected = year === currentYear; $('serialYear').append(option);
  }
  $('deviceName').value = state.deviceName || '';
  $('storeName').value = state.storeName || '';
  $('storeDescription').value = state.storeDescription || '';
  const options = await api().get_options();
  if (!options || options.ok === false) {
    setConnection(options?.error || '无法连接安装服务，请检查网络后重试。', true);
    return;
  }
  for (const city of options.cities || []) {
    if (!city.code || !city.timezone) continue;
    cities.set(city.code, city);
    const option = document.createElement('option'); option.value = city.code;
    option.textContent = `${city.name}（${city.code}）`;
    $('cityCode').append(option);
  }
  $('cityCode').value = cities.has(state.cityCode) ? state.cityCode : cities.keys().next().value;
  setConnection(`已连接 ${state.backendUrl || '安装服务'} · 本地实例 ${state.instanceName}`);
  refreshPreview();
}

['deviceNumber', 'storeNumber'].forEach(id => $(id).addEventListener('input', event => {
  event.target.value = number(event.target.value); refreshPreview();
}));
$('serialYear').addEventListener('change', refreshPreview);
$('cityCode').addEventListener('change', refreshPreview);
$('setup-form').addEventListener('submit', async event => {
  event.preventDefault();
  const error = $('error'); error.textContent = '';
  if (!cities.size) { error.textContent = '安装选项尚未加载，请检查网络。'; return; }
  const payload = {
    deviceNumber: $('deviceNumber').value,
    serialYear: $('serialYear').value,
    deviceName: $('deviceName').value,
    cityCode: $('cityCode').value,
    storeNumber: $('storeNumber').value,
    storeName: $('storeName').value,
    storeDescription: $('storeDescription').value,
    activationCode: $('activationCode').value,
  };
  const button = $('submit'); button.disabled = true; button.textContent = '正在安全激活…';
  try {
    const result = await api().complete_setup(payload);
    if (!result?.ok) throw new Error(result?.error || '激活失败');
    button.textContent = '安装完成，请重新启动模拟器';
    setConnection(`设备 ${result.deviceId} 已激活。关闭此窗口后重新启动模拟器。`);
    $('activationCode').value = '';
  } catch (err) {
    error.textContent = err.message || '激活失败，请重试。';
    button.disabled = false; button.textContent = '完成安装并激活';
  }
});
initialize().catch(error => setConnection(`安装界面初始化失败：${error.message}`, true));
