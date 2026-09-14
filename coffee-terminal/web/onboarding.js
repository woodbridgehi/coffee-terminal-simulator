'use strict';
const $ = id => document.getElementById(id);
const t = (key, params = {}) => TerminalI18n.t(key, params);
let setupState = {};
let pairing = null;
let pollTimer = null;
let completing = false;
let completedResult = null;
let currentStep = 1;
let badgeIndex = 0;
function rotateBrandBadge() {
  const badges = [...document.querySelectorAll('#brandBadgeRotator .brand-art')];
  if (badges.length < 2) return;
  badges[badgeIndex].classList.remove('current');
  badgeIndex = (badgeIndex + 1) % badges.length;
  badges[badgeIndex].classList.add('current');
}
function markCompleted() {
  document.querySelectorAll('.step').forEach(el => { el.classList.remove('current'); el.classList.add('done'); el.querySelector('.step-dot').textContent = '✓'; });
  $('stepTitle').textContent = t('onboarding.successTitle');
  $('stepDesc').textContent = t('onboarding.completed');
}
let connectionCopy = null;
function localizedConnection(key, params = {}, type = "") { connectionCopy = {key, params, type}; setConnection(t(key, params), type); }

const previewApi = {
  get_setup_state: async () => ({}),
  set_ui_locale: async locale => ({ ok: true, locale }),
  get_pairing_state: async () => ({ ok: false, error: t('onboarding.nativeRequired') }),
};
function api() { return window.pywebview?.api || previewApi; }
let creating = false;
let statusPending = false;
let generation = 0;
async function ready() { if (window.pywebview?.api) return; if (location.protocol !== 'file:') return; await new Promise(resolve => window.addEventListener('pywebviewready', resolve, { once: true })); }
function setConnection(message, type = '') { const el = $('connection'); el.lastChild.textContent = message; el.className = `connection ${type}`; }
function setStep(next) {
  currentStep = next;
  document.querySelectorAll('.step').forEach(el => {
    const number = Number(el.dataset.step); el.classList.toggle('current', number === next); el.classList.toggle('done', number < next);
    el.querySelector('.step-dot').textContent = number < next ? '✓' : number;
  });
  const copy = [t(`onboarding.step${next}.eyebrow`), t(`onboarding.step${next}.title`), t(`onboarding.step${next}.desc`)];
  $('stepEyebrow').textContent = copy[0]; $('stepTitle').textContent = copy[1]; $('stepDesc').textContent = copy[2];
}
function fmtExpiry(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? t('onboarding.expiresShort') : t('onboarding.expires', { time: date.toLocaleTimeString(TerminalI18n.getLocale(), { hour: '2-digit', minute: '2-digit' }) }); }
function renderPairing(result) {
  pairing = result; $('welcomePanel').hidden = true; $('pairingPanel').hidden = false;
  $('serialNumber').textContent = result.serialNumber || '—'; $('deviceId').textContent = result.deviceId || '—';
  $('pairingCode').textContent = result.pairingCode || '—'; $('expiresAt').textContent = fmtExpiry(result.expiresAt);
  $('refreshBtn').hidden = false; $('refreshBtn').disabled = false; $('retryBtn').hidden = false;
  $('footNote').textContent = t('onboarding.codeReady');
  setStep(2); localizedConnection('onboarding.connected', { backend: setupState.backendUrl || 'Cloud' }, 'ok');
}
function statusCopy(status) {
  if (status === 'CLAIMED') return [t('onboarding.status.claimed'), t('onboarding.status.claimedDesc')];
  if (status === 'PROVISIONED') return [t('onboarding.status.provisioned'), t('onboarding.status.provisionedDesc')];
  if (status === 'EXPIRED') return [t('onboarding.status.expired'), t('onboarding.status.expiredDesc')];
  return [t('onboarding.status.waiting'), t('onboarding.status.waitingDesc')];
}
function setStatus(status) { if (status === 'EXPIRED') { clearInterval(pollTimer); $('pairingCode').textContent = '—'; $('refreshBtn').disabled = true; } if (pairing) pairing.status = status; const [title, desc] = statusCopy(status); $('pairingStatus').querySelector('b').textContent = title; $('pairingStatus').querySelector('p').textContent = desc; $('pairingStatus').dataset.status = status || 'PENDING'; }
async function complete() {
  if (completing) return; completing = true; setStep(3); $('refreshBtn').disabled = true; $('retryBtn').hidden = true; $('error').textContent = '';
  try {
    const result = await api().complete_pairing(); if (!result?.ok) throw new Error(result?.error || t('onboarding.error.credentials'));
    clearInterval(pollTimer); $('pairingPanel').hidden = true; $('successPanel').hidden = false;
    $('sumDeviceId').textContent = result.deviceId || pairing.deviceId || '—'; $('sumSerial').textContent = result.serialNumber || pairing.serialNumber || '—';
    $('sumDeviceName').textContent = result.deviceName || '—'; $('sumStoreName').textContent = result.storeName || '—';
    document.querySelectorAll('.step').forEach(el => { el.classList.remove('current'); el.classList.add('done'); el.querySelector('.step-dot').textContent = '✓'; });
    $('refreshBtn').hidden = true; $('retryBtn').hidden = true; $('footNote').textContent = t('onboarding.completed');
    completedResult = result;
    markCompleted();
    localizedConnection('onboarding.deviceCompleted', { deviceId: result.deviceId }, 'ok');
  } catch (error) { completing = false; setStatus('CLAIMED'); $('refreshBtn').disabled = false; $('error').textContent = error.message || t('onboarding.error.credentials'); }
}
async function refreshStatus() {
  if (!pairing || creating || completing || statusPending || pairing.status === 'EXPIRED') return;
  if (Date.parse(pairing.expiresAt) <= Date.now() && pairing.status === 'PENDING') { setStatus('EXPIRED'); return; }
  const revision = generation;
  statusPending = true;
  try {
    const result = await api().get_pairing_status();
    if (revision !== generation) return;
    if (!result?.ok) throw new Error(result?.error || t('onboarding.error.status'));
    setStatus(result.status);
    if (result.status === 'CLAIMED' || result.status === 'PROVISIONED') await complete();
  } finally { statusPending = false; }
}
async function createPairing() {
  if (creating || completing || completedResult) return;
  creating = true; generation += 1; pairing = null;
  clearInterval(pollTimer); $('refreshBtn').disabled = true; $('retryBtn').disabled = true;
  $('pairingPanel').hidden = true; $('welcomePanel').hidden = false; $('pairingCode').textContent = '—'; $('error').textContent = '';
  localizedConnection('onboarding.connection.creating');
  try {
    const result = await api().get_pairing_state();
    if (!result?.ok) throw new Error(result?.error || t('onboarding.error.create'));
    if (!result.pairingCode || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error(t('onboarding.error.invalidCode'));
    renderPairing(result); setStatus(result.status || 'PENDING');
    pollTimer = setInterval(() => refreshStatus().catch(error => { $('error').textContent = error.message || t('onboarding.error.status'); }), 2500);
  } finally { creating = false; $('retryBtn').disabled = false; $('retryBtn').hidden = false; }
}
async function initialize() {
  await ready();
  setupState = await api().get_setup_state();
  const locale = TerminalI18n.setLocale(setupState.uiLocale || 'zh-CN');
  $('localeSelect').value = locale;
  document.title = t('onboarding.title');
  setStep(1);
  localizedConnection('onboarding.ready');
  $('footNote').textContent = '';
  $('retryBtn').disabled = false;
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.setInterval(rotateBrandBadge, 3000);
  }
}
$('localeSelect').addEventListener('change', async event => {
  const locale = TerminalI18n.setLocale(event.target.value);
  event.target.value = locale;
  document.title = t('onboarding.title');
  setStep(currentStep);
  if (completedResult) markCompleted();
  if (connectionCopy) setConnection(t(connectionCopy.key, connectionCopy.params), connectionCopy.type);
  $('footNote').textContent = t(completedResult ? 'onboarding.completed' : pairing ? 'onboarding.codeReady' : 'onboarding.ready');
  if (pairing) { $('expiresAt').textContent = fmtExpiry(pairing.expiresAt); setStatus(pairing.status); }
  await api().set_ui_locale(locale);
});
$('refreshBtn').addEventListener('click', () => refreshStatus().catch(error => { $('error').textContent = error.message || t('onboarding.error.status'); }));
$('retryBtn').addEventListener('click', () => createPairing().catch(error => { localizedConnection('onboarding.error.retry', { message: error.message }, 'error'); $('error').textContent = error.message; }));
initialize().catch(error => { localizedConnection('onboarding.error.init', { message: error.message }, 'error'); $('error').textContent = error.message; });
