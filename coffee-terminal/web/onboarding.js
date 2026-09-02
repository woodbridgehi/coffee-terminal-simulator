'use strict';
const $ = id => document.getElementById(id);
let setupState = {};
let pairing = null;
let pollTimer = null;
let completing = false;

const previewApi = {
  get_setup_state: async () => ({ backendUrl: '浏览器预览服务', instanceName: 'coffee-bot-preview' }),
  get_pairing_state: async () => ({ ok: true, serialNumber: 'SIM-8E0A12F4B76C', deviceId: 'coffee-bot-582901', pairingCode: '7K4M-92QP', expiresAt: new Date(Date.now() + 900000).toISOString(), status: 'PENDING' }),
  get_pairing_status: async () => ({ ok: true, status: 'PENDING' }),
  complete_pairing: async () => ({ ok: true, deviceId: 'coffee-bot-582901', serialNumber: 'SIM-8E0A12F4B76C', deviceName: '大堂 1 号机', storeName: '演示门店' }),
};
function api() { return window.pywebview?.api || previewApi; }
async function ready() { if (window.pywebview?.api) return; if (location.protocol !== 'file:') return; await new Promise(resolve => window.addEventListener('pywebviewready', resolve, { once: true })); }
function setConnection(message, type = '') { const el = $('connection'); el.lastChild.textContent = message; el.className = `connection ${type}`; }
function setStep(next) {
  document.querySelectorAll('.step').forEach(el => {
    const number = Number(el.dataset.step); el.classList.toggle('current', number === next); el.classList.toggle('done', number < next);
    el.querySelector('.step-dot').textContent = number < next ? '✓' : number;
  });
  const copy = next === 1 ? ['STEP 1 / 3 · 软件身份', '已创建本机身份', '设备 SN 与云端设备 ID 已自动生成。']
    : next === 2 ? ['STEP 2 / 3 · 商户配对', '等待商户确认', '请在商户后台输入此设备显示的配对码。']
      : ['STEP 3 / 3 · 自动接入', '正在领取正式凭证', '商户配对已确认，正在保存 HTTP 和 MQTT 连接信息。'];
  $('stepEyebrow').textContent = copy[0]; $('stepTitle').textContent = copy[1]; $('stepDesc').textContent = copy[2];
}
function fmtExpiry(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '短时有效' : `有效至 ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; }
function renderPairing(result) {
  pairing = result; $('pairingPanel').hidden = false;
  $('serialNumber').textContent = result.serialNumber || '—'; $('deviceId').textContent = result.deviceId || '—';
  $('pairingCode').textContent = result.pairingCode || '—'; $('expiresAt').textContent = fmtExpiry(result.expiresAt);
  $('refreshBtn').disabled = false; $('retryBtn').hidden = false;
  $('footNote').textContent = '配对码已生成 · 商户确认后本机将自动完成接入';
  setStep(2); setConnection(`已连接 ${setupState.backendUrl || '云端服务'} · 等待商户配对`, 'ok');
}
function statusCopy(status) {
  if (status === 'CLAIMED') return ['商户已确认，正在自动接入', '正在领取设备 HTTP Token 与 MQTT 凭证…'];
  if (status === 'PROVISIONED') return ['配对已完成', '正式凭证已签发。'];
  if (status === 'EXPIRED') return ['配对码已过期', '请重新生成配对码后再让商户确认。'];
  return ['等待商户确认', '商户确认门店和设备名称后，本机将自动领取正式凭证。'];
}
function setStatus(status) { const [title, desc] = statusCopy(status); $('pairingStatus').querySelector('b').textContent = title; $('pairingStatus').querySelector('p').textContent = desc; $('pairingStatus').dataset.status = status || 'PENDING'; }
async function complete() {
  if (completing) return; completing = true; setStep(3); $('refreshBtn').disabled = true; $('retryBtn').hidden = true; $('error').textContent = '';
  try {
    const result = await api().complete_pairing(); if (!result?.ok) throw new Error(result?.error || '正式凭证领取失败');
    clearInterval(pollTimer); $('pairingPanel').hidden = true; $('successPanel').hidden = false;
    $('sumDeviceId').textContent = result.deviceId || pairing.deviceId || '—'; $('sumSerial').textContent = result.serialNumber || pairing.serialNumber || '—';
    $('sumDeviceName').textContent = result.deviceName || '—'; $('sumStoreName').textContent = result.storeName || '—';
    document.querySelectorAll('.step').forEach(el => { el.classList.remove('current'); el.classList.add('done'); el.querySelector('.step-dot').textContent = '✓'; });
    $('refreshBtn').hidden = true; $('retryBtn').hidden = true; $('footNote').textContent = '自动接入完成 · 请关闭并重新启动模拟器';
    setConnection(`设备 ${result.deviceId} 已完成配对并激活`, 'ok');
  } catch (error) { completing = false; setStatus('CLAIMED'); $('refreshBtn').disabled = false; $('error').textContent = error.message || '正式凭证领取失败，请重试。'; }
}
async function refreshStatus() {
  if (!pairing || completing) return;
  const result = await api().get_pairing_status();
  if (!result?.ok) throw new Error(result?.error || '无法读取配对状态');
  setStatus(result.status);
  if (result.status === 'CLAIMED' || result.status === 'PROVISIONED') await complete();
}
async function createPairing() {
  clearInterval(pollTimer); $('refreshBtn').disabled = true; $('retryBtn').hidden = true; $('pairingPanel').hidden = true; $('error').textContent = '';
  setConnection('正在创建安全配对会话…');
  const result = await api().get_pairing_state(); if (!result?.ok) throw new Error(result?.error || '无法创建配对会话');
  renderPairing(result); setStatus(result.status || 'PENDING');
  pollTimer = setInterval(() => refreshStatus().catch(error => { $('error').textContent = error.message || '配对状态刷新失败'; }), 2500);
}
async function initialize() { await ready(); setupState = await api().get_setup_state(); await createPairing(); }
$('refreshBtn').addEventListener('click', () => refreshStatus().catch(error => { $('error').textContent = error.message || '配对状态刷新失败'; }));
$('retryBtn').addEventListener('click', () => createPairing().catch(error => { setConnection(`无法创建配对会话：${error.message}`, 'error'); $('error').textContent = error.message; }));
initialize().catch(error => { setConnection(`配对界面初始化失败：${error.message}`, 'error'); $('error').textContent = error.message; });
