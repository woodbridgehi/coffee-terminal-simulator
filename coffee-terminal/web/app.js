const $ = (selector) => document.querySelector(selector);
const terminalI18n = globalThis.TerminalI18n || {
  t: key => key,
  setLocale: value => String(value || '').toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN',
  getLocale: () => 'zh-CN',
};
const t = (key, params = {}) => terminalI18n.t(key, params);
let state = null;
let selectedRecipeId = null;
let localeInitialized = false;
const renderCache = { recipes: '', inventory: '', events: '' };

const mockApi = (() => {
  const recipe = { recipeId: 'iced-latte-v1', skuCode: 'ICED_LATTE', version: '1.0.0', name: '冰拿铁', enabled: true, visual: { profile: 'iced-latte' }, steps: [
    { id: 'prepare-cup', name: '准备杯子', animationCue: 'cup-arrive', durationSeconds: 3, consumes: [{ materialId: 'cup-16oz', amount: 1, unit: 'piece' }] },
    { id: 'extract-coffee', name: '萃取咖啡', animationCue: 'brew-stream', durationSeconds: 8, consumes: [{ materialId: 'coffee-beans', amount: 18, unit: 'g' }] },
    { id: 'add-milk', name: '添加牛奶', animationCue: 'milk-pour', durationSeconds: 6, consumes: [{ materialId: 'milk', amount: 180, unit: 'ml' }] },
  ] };
  const materials = [
    { materialId: 'coffee-beans', name: '咖啡豆', unit: 'g', onHand: 1200, reserved: 0, capacity: 2000, status: 'OK' },
    { materialId: 'milk', name: '鲜奶', unit: 'ml', onHand: 2400, reserved: 0, capacity: 4000, status: 'OK' },
    { materialId: 'cup-16oz', name: '16oz 杯', unit: 'piece', onHand: 72, reserved: 0, capacity: 100, status: 'OK' },
  ];
  const previewPlan = recipe.steps.map((step, stepIndex) => ({ stepId: step.id, stepName: step.name, stepIndex, durationSeconds: step.durationSeconds, visual: { version: 1, actions: [['cups'], ['brew'], ['milk']][stepIndex], materials: step.consumes.map(item => ({ ...item, name: materials.find(m => m.materialId === item.materialId)?.name || item.materialId })) } }));
  const runtime = { deviceStatus: 'IDLE', connection: 'ONLINE', qrUrl: 'https://order.example.com/q/demo-coffee-bot-001', qrDataUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https%3A%2F%2Forder.example.com%2Fq%2Fdemo-coffee-bot-001', task: null, override: { globalFailureRate: 0, forceFailNext: false, offline: false }, inventory: { inventoryVersion: 1, materials }, events: [{ type: 'device.online', message: '浏览器预览模式：本地模拟 API 已就绪', occurredAt: new Date().toISOString() }] };
  const event = (type, message) => runtime.events.unshift({ type, message, occurredAt: new Date().toISOString() });
  setInterval(() => {
    const task = runtime.task;
    if (!task || task.state !== 'RUNNING' || runtime.override.offline) return;
    const step = task.recipe.steps[task.stepIndex];
    task.stepProgress += .25 / step.durationSeconds;
    if (task.stepProgress < 1) return;
    if (runtime.override.forceFailNext) { runtime.override.forceFailNext = false; const retryable = (task.stepRetries?.[step.id] || 0) < 1; task.state = retryable ? 'RETRY_WAIT' : 'FAILED'; task.message = `${step.name}故障`; task.failure = { code: 'SIMULATED_FAILURE', retryable }; runtime.deviceStatus = retryable ? 'BUSY' : 'FAILED'; event(retryable ? 'task.retry_wait' : 'task.failed', task.message); return; }
    for (const item of step.consumes || []) { const material = materials.find((entry) => entry.materialId === item.materialId); if (material) material.onHand = Math.max(0, material.onHand - item.amount); }
    event('step.completed', `${step.name}完成`); task.stepIndex += 1; task.stepProgress = 0;
    if (task.stepIndex >= task.recipe.steps.length) { task.stepIndex -= 1; task.stepProgress = 1; task.state = 'SUCCEEDED'; task.message = '咖啡制作完成，请取杯'; runtime.deviceStatus = 'READY'; event('task.succeeded', task.message); }
    else task.message = task.recipe.steps[task.stepIndex].name;
  }, 250);
  return {
    get_state: async () => ({ config: { deviceId: 'coffee-bot-001', deviceName: 'COFFEE BOT 001', ui: { locale: 'zh-CN' } }, recipes: [recipe], capabilities: { products: [{ recipeId: recipe.recipeId, available: true, maxServings: 13 }] }, runtime }),
    set_ui_locale: async (locale) => ({ ok: true, locale }),
    confirm_pickup: async (taskId) => {
      if (runtime.task?.taskId !== taskId || runtime.task?.state !== 'SUCCEEDED') return { ok: false, error: '没有对应的待取杯任务' };
      runtime.task = null; runtime.deviceStatus = 'IDLE'; event('pickup.collected', '顾客已取杯'); return { ok: true };
    },
    start_demo_order: async () => { if (runtime.task && ['ACKNOWLEDGED', 'RUNNING', 'PAUSED', 'RETRY_WAIT', 'SUCCEEDED'].includes(runtime.task.state)) return { ok: false, error: '设备已有执行中的任务' }; runtime.task = { taskId: `task-browser-preview-${Date.now()}`, revision: 1, stepPlan: previewPlan, orderId: 'order-1024', recipe, state: 'RUNNING', stepIndex: 0, stepProgress: 0, message: '开始制作', attempt: 1 }; runtime.deviceStatus = 'BUSY'; event('task.started', '开始模拟制作'); return { ok: true }; },
    command: async (action) => {
      if (action === 'toggle-offline') { runtime.override.offline = !runtime.override.offline; runtime.connection = runtime.override.offline ? 'OFFLINE' : 'ONLINE'; event('device.connection', runtime.override.offline ? '网络已断开' : '网络已恢复'); return { ok: true }; }
      if (action === 'force-fail') { runtime.override.forceFailNext = true; event('debug.failure-armed', '下一执行步骤将强制失败'); return { ok: true }; }
      const task = runtime.task; if (!task) return { ok: false, error: '没有当前任务' };
      if (task.recoveryHold && ['resume', 'retry', 'skip'].includes(action)) return { ok: false, error: '请先核对重启前的制作结果' };
      if (action === 'pause' && task.state === 'RUNNING') task.state = 'PAUSED'; else if (action === 'resume' && task.state === 'PAUSED') task.state = 'RUNNING'; else if (action === 'skip' && ['RUNNING', 'PAUSED'].includes(task.state)) task.stepProgress = 1; else if (action === 'retry' && task.state === 'RETRY_WAIT' && task.failure?.retryable) { const stepId = task.recipe.steps[task.stepIndex].id; task.stepRetries ||= {}; task.stepRetries[stepId] = (task.stepRetries[stepId] || 0) + 1; task.attempt += 1; task.state = 'RUNNING'; task.stepProgress = 0; runtime.deviceStatus = 'BUSY'; } else if (action === 'clear' && ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.state)) { runtime.task = null; runtime.deviceStatus = 'IDLE'; } else return { ok: false, error: '当前状态不支持该操作' };
      task.revision = (task.revision || 0) + 1;
      event(`task.${action}`, `执行调试命令：${action}`); return { ok: true };
    },
    update_override: async (payload) => { Object.assign(runtime.override, payload); return { ok: true }; }, save_recipe: async () => ({ ok: true }), reload_config: async () => ({ ok: true }),
    adjust_inventory: async ({ materialId, mode, amount }) => { const item = materials.find((entry) => entry.materialId === materialId); if (!item) return { ok: false, error: '未知物料' }; item.onHand = mode === 'SET' ? amount : item.onHand + amount; event('inventory.adjusted', `${item.name}库存已调整`); return { ok: true }; },
  };
})();

const api = () => window.pywebview?.api || mockApi;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const setVisible = (selector, visible) => $(selector).classList.toggle('is-hidden', !visible);
const fmtTime = (value) => new Date(value).toLocaleTimeString(terminalI18n.getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.remove('is-hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.add('is-hidden'), 2600); }

function renderRecipes(recipes, capabilities) {
  const products = new Map((capabilities?.products || []).map((item) => [item.recipeId, item]));
  const select = $('#recipeSelect'); const current = selectedRecipeId || select.value || recipes[0]?.recipeId;
  const html = recipes.map((recipe) => { const capability = products.get(recipe.recipeId); const suffix = capability && !capability.available ? ' · 缺料' : capability ? ` · 可做 ${capability.maxServings} 杯` : ''; return `<option value="${escapeHtml(recipe.recipeId)}">${escapeHtml(recipe.name)} · ${escapeHtml(recipe.version)}${suffix}</option>`; }).join('');
  if (html !== renderCache.recipes) { renderCache.recipes = html; select.innerHTML = html; }
  selectedRecipeId = recipes.some((item) => item.recipeId === current) ? current : recipes[0]?.recipeId;
  if (selectedRecipeId) select.value = selectedRecipeId;
}

function renderInventory(snapshot) {
  const materials = snapshot?.materials || [];
  const html = materials.length ? materials.map((item) => { const ratio = item.capacity ? Math.min(100, Math.max(0, item.onHand / item.capacity * 100)) : 0; const status = String(item.status || 'OK').toLowerCase(); return `<div class="inventory-item ${status}"><div><div class="inventory-name">${escapeHtml(item.name)}</div><div class="inventory-amount">${item.onHand} / ${item.capacity} ${escapeHtml(item.unit)} · 预占 ${item.reserved || 0}</div></div><span class="inventory-status ${status}">${escapeHtml(item.status)}</span><div class="inventory-bar"><span style="width:${ratio}%"></span></div><div class="inventory-actions"><button data-refill="${escapeHtml(item.materialId)}" data-capacity="${item.capacity}">补满</button></div></div>`; }).join('') : '<p class="empty-note">当前实例没有物料配置</p>';
  if (html !== renderCache.inventory) { renderCache.inventory = html; $('#inventoryList').innerHTML = html; }
}

let cancelledTimer = null;
let cancelledDeadline = 0;
let lastQrUrl = '';

function formatPickupCode(orderNo, orderId, taskId) {
  // 优先匹配业务单号（如 C0903-8E1A0F -> 8E1A），与手机端保持绝对一致
  const raw = String(orderNo || orderId || taskId || '').trim();
  if (!raw) return '—';
  const hyphenParts = raw.split('-');
  if (hyphenParts.length >= 2) {
    const last = hyphenParts[hyphenParts.length - 1];
    if (last.length >= 4) return last.slice(0, 4).toUpperCase();
    return last.toUpperCase();
  }
  const digits = raw.match(/\d{3,4}$/);
  if (digits) return digits[0];
  return raw.slice(-4).toUpperCase();
}


function startCancelledCountdown(durationSeconds = 10) {
  if (cancelledTimer) return;
  cancelledDeadline = Date.now() + durationSeconds * 1000;
  const updateNote = () => {
    const remaining = Math.max(0, Math.ceil((cancelledDeadline - Date.now()) / 1000));
    const el = $('#cancelledCountdown');
    if (el) el.textContent = t('terminal.returnCountdown', { seconds: remaining });
    if (remaining <= 0) {
      stopCancelledCountdown();
      invoke('command', 'clear');
    }
  };
  updateNote();
  cancelledTimer = setInterval(updateNote, 250);
}

function stopCancelledCountdown() {
  if (cancelledTimer) { clearInterval(cancelledTimer); cancelledTimer = null; }
  cancelledDeadline = 0;
}

function render(data) {
  window.CoffeeRobotIntegration?.terminal(data);
  state = data; const { config, runtime, recipes, capabilities } = data; const task = runtime.task;
  if (!localeInitialized) {
    localeInitialized = true;
    const locale = terminalI18n.setLocale(config.ui?.locale || 'zh-CN');
    $('#localeSelect').value = locale;
  }
  $('#idleQuote').textContent = t(`terminal.quote.${BARISTA_QUOTES[quoteIndex]}`);
  $('#deviceName').textContent = config.deviceName; $('#deviceTag').textContent = config.deviceId;
  $('#connectionText').textContent = runtime.connection === 'ONLINE' ? t('terminal.connection.online') : runtime.connection === 'CONNECTING' ? t('terminal.connection.connecting') : t('terminal.connection.offline');
  $('#consoleConnectionText').textContent = runtime.connection === 'ONLINE' ? 'DEVICE ONLINE' : runtime.connection === 'CONNECTING' ? 'CONNECTING' : 'DEVICE OFFLINE';
  $('.connection').classList.toggle('offline', runtime.connection !== 'ONLINE');
  if (runtime.qrDataUrl && runtime.qrDataUrl !== lastQrUrl) {
    lastQrUrl = runtime.qrDataUrl;
    $('#qrImage').src = runtime.qrDataUrl;
  }
  $('.qr-frame').style.visibility = runtime.connection === 'ONLINE' ? 'visible' : 'hidden';
  $('#qrNote').textContent = runtime.connection === 'ONLINE' ? t('terminal.qr.online') : t('terminal.qr.offline');
  renderRecipes(recipes, capabilities); renderInventory(runtime.inventory);
  if (!$('#recipeEditor').matches(':focus')) { const selected = recipes.find((item) => item.recipeId === selectedRecipeId); if (selected && $('#recipeEditor').dataset.recipeId !== selected.recipeId) { $('#recipeEditor').value = JSON.stringify(selected, null, 2); $('#recipeEditor').dataset.recipeId = selected.recipeId; } }

  const isReady = task?.state === 'SUCCEEDED';
  const isCancelled = task?.state === 'CANCELLED';
  const isFailed = task?.state === 'FAILED';
  const isHold = !!task?.recoveryHold || task?.state === 'HOLD' || runtime.deviceStatus === 'RECOVERING';
  const isMaking = task && ['RECEIVED', 'VALIDATING', 'ACKNOWLEDGED', 'RUNNING', 'PAUSED', 'RETRY_WAIT'].includes(task.state) && !isHold;
  const isIdle = !task;

  $('#retryTask').disabled = task?.state !== 'RETRY_WAIT' || !task?.failure?.retryable || !!task?.recoveryHold;
  $('#pauseResume').disabled = !['RUNNING', 'PAUSED'].includes(task?.state) || !!task?.recoveryHold;
  $('#skipStep').disabled = !['RUNNING', 'PAUSED'].includes(task?.state) || !!task?.recoveryHold;
  $('#clearButton').disabled = !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task?.state);
  $('#errorClearBtn').disabled = !['FAILED', 'CANCELLED'].includes(task?.state) && !isHold;

  setVisible('#idleView', isIdle);
  setVisible('#makingView', isMaking);
  setVisible('#readyView', isReady);
  setVisible('#cancelledView', isCancelled);
  setVisible('#errorView', isFailed || isHold);

  if (isReady) {
    $('#readyCountdown').textContent = t(runtime.pickupSlot?.state === 'NEEDS_CHECK' ? 'terminal.pickupOverdue' : 'terminal.pickupWaiting');
  }

  if (isCancelled) {
    startCancelledCountdown();
  } else {
    stopCancelledCountdown();
  }

  if (isMaking) { window.DrinkVisual?.render(task); window.DrinkVisual?.updateProgress(task); } else window.DrinkVisual?.reset();
  $('#taskState').className = `state ${String(task?.state || 'idle').toLowerCase()}`;
  if (task) {
    const pickupCode = formatPickupCode(task.orderNo, task.orderId, task.taskId);
    const total = task.recipe?.steps?.length || 1;
    const planned = task.plannedDurationSeconds || (task.recipe?.steps || []).reduce((sum, step) => sum + Number(step.durationSeconds || 0), 0);
    const elapsed = (task.recipe?.steps || []).slice(0, task.stepIndex).reduce((sum, step) => sum + Number(step.durationSeconds || 0), 0) + Number(task.recipe?.steps?.[task.stepIndex]?.durationSeconds || 0) * Number(task.stepProgress || 0);
    const overall = Number.isFinite(task.overallProgress) ? task.overallProgress : (planned > 0 ? elapsed / planned : 0);
    const displayOrderNo = task.orderNo || task.orderId || task.taskId;
    $('#taskState').textContent = task.state;
    $('#taskTitle').textContent = task.recipe?.name || t('terminal.task.coffee');
    $('#taskMeta').textContent = `${displayOrderNo} · ${task.message || ''}`;
    $('#recipeName').textContent = task.recipe?.name || t('terminal.task.specialty');
function enrichStepName(name) {
  if (!name) return t('terminal.step.default');
  if (name.includes('准备') || name.includes('落杯') || name.includes('cup')) return t('terminal.step.cup');
  if (name.includes('萃取') || name.includes('brew')) return t('terminal.step.brew');
  if (name.includes('牛奶') || name.includes('鲜奶') || name.includes('milk')) return t('terminal.step.milk');
  if (name.includes('水') || name.includes('water')) return t('terminal.step.water');
  if (name.includes('冰') || name.includes('ice')) return t('terminal.step.ice');
  if (name.includes('糖浆') || name.includes('榛果') || name.includes('syrup')) return t('terminal.step.syrup');
  if (name.includes('封杯') || name.includes('出杯') || name.includes('serve')) return t('terminal.step.serve');
  return name;
}

    $('#orderId').textContent = `${t('terminal.order.processing')} · ${displayOrderNo}`;
    $('#makingPickupCode').textContent = pickupCode;
    $('#readyPickupCode').textContent = pickupCode;
    $('#currentStep').textContent = enrichStepName(task.message);
    $('#stepCount').textContent = t('terminal.step', { current: task.stepIndex + 1, total });
    $('#displayProgress').style.width = `${Math.round(Math.max(0, Math.min(1, overall)) * 100)}%`;
    const seconds = Math.max(0, Math.ceil(Number.isFinite(task.remainingSeconds) ? task.remainingSeconds : planned - elapsed));
    $('#remainingTime').textContent = t('terminal.remaining', { seconds });
    $('#readyOrder').textContent = t('terminal.ready.order', { code: pickupCode, orderNo: displayOrderNo });
    if (isHold) {
      $('#errorLabel').textContent = t('terminal.hold.kicker');
      $('#errorTitle').textContent = t('terminal.hold.title');
      $('#errorMessage').textContent = t('terminal.hold.desc');
      setVisible('#errorClearBtn', false);
    } else if (isFailed) {
      $('#errorLabel').textContent = t('terminal.error.kicker');
      $('#errorTitle').textContent = t('terminal.error.title');
      $('#errorMessage').textContent = task.failure ? `${task.failure.code} · ${task.message}` : t('terminal.error.desc');
      setVisible('#errorClearBtn', true);
    }
    $('#pauseResume').textContent = task.state === 'PAUSED' ? t('terminal.action.resume') : t('terminal.action.pause');
  } else {
    $('#taskState').textContent = 'IDLE';
    $('#taskTitle').textContent = t('terminal.task.none');
    $('#taskMeta').textContent = t('terminal.task.waiting');
  }
  if (document.activeElement !== $('#failureRate')) $('#failureRate').value = Math.round((runtime.override.globalFailureRate || 0) * 100);
  $('#failureValue').textContent = `${$('#failureRate').value}%`;
  $('#toggleOffline').textContent = runtime.override.offline ? t('terminal.action.online') : t('terminal.action.offline');
  const eventSig = `${runtime.events.length}:${runtime.events[0]?.occurredAt || ''}`;
  if (eventSig !== renderCache.events) {
    renderCache.events = eventSig;
    $('#eventLog').innerHTML = runtime.events.map((entry) => `<div class="event"><time>${fmtTime(entry.occurredAt)}</time><div>${escapeHtml(entry.message)}<span class="event-type">${escapeHtml(entry.type)}</span></div></div>`).join('');
  }
}

async function refresh() { try { render(await api().get_state()); } catch (error) { window.CoffeeRobotIntegration?.disconnected(); toast(t('terminal.error.connect', { message: error.message })); } }
async function invoke(method, ...args) { try { const result = await api()[method](...args); if (!result?.ok) toast(result?.error || t('terminal.error.operationGeneric')); await refresh(); return result; } catch (error) { toast(t('terminal.error.operation', { message: error.message })); return null; } }

const setConsole = (open) => $('.app-shell').classList.toggle('console-open', open);

// Kiosk / Debug mode handling
const debugQuery = typeof URLSearchParams === 'function' && typeof location !== 'undefined'
  ? new URLSearchParams(location.search || '')
  : null;
const isDebugMode = debugQuery?.get('debug') === '1';
if (isDebugMode) {
  $('#consoleTrigger').classList.remove('kiosk-hidden');
}

$('#localeSelect').onchange = async event => {
  const locale = terminalI18n.setLocale(event.target.value);
  event.target.value = locale;
  if (state) {
    state.config.ui ||= {};
    state.config.ui.locale = locale;
    renderCache.recipes = ''; renderCache.inventory = ''; renderCache.events = '';
    render(state);
  }
  try { await api().set_ui_locale(locale); } catch (error) { toast(t('terminal.error.operation', { message: error.message })); }
};

// Secret technician gesture: 5 clicks on logo within 2.5s
let secretClicks = 0;
let secretTimer = null;
const secretArea = $('#brandSecretArea');
if (secretArea) {
  secretArea.onclick = () => {
    secretClicks += 1;
    clearTimeout(secretTimer);
    if (secretClicks >= 5) {
      secretClicks = 0;
      setConsole(!$('.app-shell').classList.contains('console-open'));
      toast('已通过技术人员手势切换控制台');
    } else {
      secretTimer = setTimeout(() => { secretClicks = 0; }, 2500);
    }
  };
}

$('#consoleTrigger').onclick = () => setConsole(true);
$('#closeConsole').onclick = () => setConsole(false);
$('#demoOrder').onclick = () => invoke('start_demo_order', $('#recipeSelect').value);
$('#forceFail').onclick = () => invoke('command', 'force-fail');
$('#toggleOffline').onclick = () => invoke('command', 'toggle-offline');
$('#pauseResume').onclick = () => invoke('command', state?.runtime.task?.state === 'PAUSED' ? 'resume' : 'pause');
$('#skipStep').onclick = () => invoke('command', 'skip');
$('#retryTask').onclick = () => invoke('command', 'retry');
$('#clearButton').onclick = () => invoke('confirm_pickup', state?.runtime?.task?.taskId);
$('#cancelledClearBtn').onclick = () => { stopCancelledCountdown(); invoke('command', 'clear'); };
$('#errorClearBtn').onclick = () => invoke('command', 'clear');

document.addEventListener?.('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setConsole(!$('.app-shell').classList.contains('console-open')); }
  if (event.key === 'Escape') setConsole(false);
});
$('#reloadConfig').onclick = async () => { const result = await invoke('reload_config'); if (result?.ok) toast('本地配置已刷新'); };
$('#failureRate').oninput = (event) => { $('#failureValue').textContent = `${event.target.value}%`; };
$('#failureRate').onchange = (event) => invoke('update_override', { globalFailureRate: Number(event.target.value) / 100 });
$('#recipeSelect').onchange = (event) => { selectedRecipeId = event.target.value; const recipe = state.recipes.find((item) => item.recipeId === selectedRecipeId); $('#recipeEditor').value = JSON.stringify(recipe, null, 2); $('#recipeEditor').dataset.recipeId = selectedRecipeId; };
$('#saveRecipe').onclick = async () => { const result = await invoke('save_recipe', $('#recipeEditor').value); if (result?.ok) toast('配方已保存并刷新能力'); };
$('#inventoryList').onclick = (event) => { const button = event.target.closest('[data-refill]'); if (button) invoke('adjust_inventory', { materialId: button.dataset.refill, mode: 'SET', amount: Number(button.dataset.capacity), reason: 'OPERATOR_REFILL' }); };
const BARISTA_QUOTES = [0, 1, 2, 3, 4];
let quoteIndex = 0;
setInterval(() => {
  const quoteEl = $('#idleQuote');
  if (!quoteEl || $('#idleView')?.classList.contains('is-hidden')) return;
  quoteEl.classList.add('fade-out');
  setTimeout(() => {
    quoteIndex = (quoteIndex + 1) % BARISTA_QUOTES.length;
    quoteEl.textContent = t(`terminal.quote.${BARISTA_QUOTES[quoteIndex]}`);
    quoteEl.classList.remove('fade-out');
  }, 600);
}, 7500);

refresh(); setInterval(refresh, 700);
