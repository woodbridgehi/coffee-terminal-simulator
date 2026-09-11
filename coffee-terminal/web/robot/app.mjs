import { createLatteArtDemo } from './latte-art-demo.mjs';
import { CoffeeScene } from './scene.mjs';
import { createSequence, sampleSequence } from './sequence.mjs';
import { LIMITS, deg, rad } from './kinematics.mjs';

const $ = (id) => document.getElementById(id);
const formatTime = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const cupIcon = '<path d="M6 7h12l-1.5 14h-9zM5 4h14v3H5z"/>';
const icons = { '取杯': cupIcon, '出杯': cupIcon, '萃取': '<rect x="4" y="3" width="16" height="17" rx="2"/><path d="M4 9h16M9 13v4h6v-4M8 6h2m4 0h2"/>',
  '交接': '<path d="m3 13 5-5 4 3 4-3 5 5-5 6-4-2-4 2zM1 11l4 7m18-7-4 7"/>',
  '加奶': '<path d="M8 3h7v4l3 4v10H5V11l3-4zM5 12h13"/>',
  '加水': '<path d="M12 2C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-13z"/>',
  '糖浆': '<path d="M9 3h6v6l3 3v9H6v-9l3-3zM9 5h9M6 15h12"/>',
  '封盖': '<path d="M3 14h18l-2 5H5zM5 14c0-5 3-7 7-7s7 2 7 7M10 7V4h4v3"/>' };

let scene, sequence = createLatteArtDemo(), elapsed = 0, running = false, manual = false, selected = 'left', frameId, disposed = false;
let state = sampleSequence(sequence, 0);
const sliders = LIMITS.map(([min, max], i) => {
  const row = document.createElement('div'); row.className = 'joint';
  row.innerHTML = `<label for="joint${i}">J${i + 1}</label><input id="joint${i}" type="range" min="${min}" max="${max}" step="1" value="0" aria-label="J${i + 1} 关节角度" disabled><output for="joint${i}" id="angle${i}">0°</output>`;
  $('joints').append(row);
  const input = row.querySelector('input'), output = row.querySelector('output');
  input.addEventListener('input', () => {
    if (!manual || !scene) return;
    const angles = [...scene.arms[selected].angles]; angles[i] = rad(Number(input.value));
    scene.arms[selected].pose(angles); output.value = `${input.value}°`;
  });
  return { input, output };
});

function buildStages() {
  $('stages').replaceChildren();
  sequence.recipe.stages.forEach((name, index) => {
    const button = document.createElement('button'); button.className = 'stage';
    button.setAttribute('aria-label', `跳转到${name}`);
    button.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b><svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || cupIcon}</svg><span>${name}</span>`;
    button.addEventListener('click', () => seek(sequence.segments.find((segment) => segment.stage === name).start));
    $('stages').append(button);
  });
  $('recipeDetail').textContent = sequence.recipe.detail;
}

function updateControls() {
  const active = sequence.recipe.stages.indexOf(state.stage);
  [...$('stages').children].forEach((button, i) => {
    button.classList.toggle('active', i === active && !state.done);
    button.classList.toggle('complete', i < active || state.done);
    button.setAttribute('aria-current', i === active ? 'step' : 'false');
  });
  $('play').querySelector('span').textContent = running ? '暂停演示' : state.done ? '再次演示' : elapsed > 0 ? '继续演示' : '开始演示';
  $('play').querySelector('path').setAttribute('d', running ? 'M5 3h3v14H5zM12 3h3v14h-3z' : 'm6 3 11 7-11 7z');
  $('status').textContent = manual ? '关节调试' : state.done ? '制作完成，请取杯' : running ? `正在${state.stage}` : elapsed > 0 ? '演示已暂停' : '准备就绪';
  $('statusDot').className = `status-dot ${running ? 'running' : state.done ? 'done' : ''}`;
  $('description').textContent = manual ? '可独立调整六个关节；开始演示会恢复初始姿态。' : elapsed === 0 ? '选择配方，观看从取杯到出杯的完整流程。' : state.description;
  $('clock').textContent = `${formatTime(elapsed)} / ${formatTime(sequence.duration)}`;
  $('percent').value = `${Math.round(state.progress * 100)}%`;
  $('seek').value = Math.round(state.progress * 1000);
  $('seek').setAttribute('aria-valuetext', `${formatTime(elapsed)}，${state.stage}`);
  $('manual').checked = manual;
  for (const [i, { input, output }] of sliders.entries()) {
    input.disabled = !manual;
    if (scene && document.activeElement !== input) {
      input.value = Math.round(deg(scene.arms[selected].angles[i]));
      output.value = `${Math.round(deg(scene.arms[selected].angles[i]))}°`;
    }
  }
}

function apply() {
  state = sampleSequence(sequence, elapsed);
  scene.apply(state); updateControls();
}
function seek(time) {
  if (!scene) return;
  running = false; manual = false;
  elapsed = Math.max(0, Math.min(time, sequence.duration)); apply();
}
function reset() {
  running = false; manual = false; elapsed = 0; apply();
}

$('play').addEventListener('click', () => {
  if (manual || state.done) reset();
  running = !running; updateControls();
});
$('reset').addEventListener('click', reset);
$('recipe').addEventListener('change', () => { sequence = $('recipe').value==='spiral'?createLatteArtDemo():createSequence($('recipe').value); buildStages(); reset(); });
$('seek').addEventListener('input', () => seek(Number($('seek').value) / 1000 * sequence.duration));
$('next').addEventListener('click', () => {
  const next = sequence.segments.find((segment) => segment.start > elapsed + 0.01 && segment.stage !== state.stage);
  seek(next ? next.start : sequence.duration);
});
$('manual').addEventListener('change', () => {
  const enabled = $('manual').checked;
  reset(); manual = enabled; updateControls();
});
for (const button of document.querySelectorAll('[data-arm]')) button.addEventListener('click', () => {
  selected = button.dataset.arm;
  document.querySelectorAll('[data-arm]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  updateControls();
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  if (!scene) return;
  scene.setView(button.dataset.view);
  document.querySelectorAll('[data-view]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
});
$('fitView').addEventListener('click', () => { if (scene) scene.setView(scene.view); });
$('showLabels').addEventListener('change', () => { if (scene) scene.showLabels = $('showLabels').checked; });
$('showAxes').addEventListener('change', () => { if (scene) Object.values(scene.arms).forEach((arm) => { arm.axes.visible = $('showAxes').checked; }); });
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.target.closest('input,select,button,a,textarea')) return;
  if (!$('play').disabled) { event.preventDefault(); $('play').click(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) { running = false; updateControls(); }
});

function showError(error) {
  running = false; $('loading').hidden = true; $('sceneError').hidden = false;
  $('errorText').textContent = `请使用支持 WebGL 2 的浏览器并启用图形加速。${error.message || error}`;
  for (const id of ['play', 'reset', 'next', 'seek', 'recipe', 'manual']) $(id).disabled = true;
  console.error('Coffee Robotics:', error);
}

try {
  scene = new CoffeeScene($('canvasHost'), $('labels'));
  buildStages(); apply();
  for (const id of ['play', 'reset', 'next', 'seek']) $(id).disabled = false;
  $('loading').hidden = true;
  let previous = performance.now(), lastUI = 0;
  const animate = (now) => {
    if (disposed) return;
    // Cap tab/OS scheduling gaps; hidden tabs pause rather than silently finish a cup.
    const delta = Math.min(0.1, Math.max(0, (now - previous) / 1000)); previous = now;
    try {
      if (running) {
        elapsed = Math.min(sequence.duration, elapsed + delta * Number($('speed').value));
        state = sampleSequence(sequence, elapsed); scene.apply(state);
        if (state.done) running = false;
      }
      if (now - lastUI > 100) { updateControls(); lastUI = now; }
      if (!document.hidden) scene.render();
      frameId = requestAnimationFrame(animate);
    } catch (error) { showError(error); }
  };
  frameId = requestAnimationFrame(animate);
  scene.renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); cancelAnimationFrame(frameId); showError(new Error('图形上下文已丢失，请重新加载。'));
  });
  window.addEventListener('pagehide', (event) => {
    running = false;
    if (event.persisted) return;
    disposed = true; cancelAnimationFrame(frameId); scene.dispose();
  });
} catch (error) { showError(error); }
