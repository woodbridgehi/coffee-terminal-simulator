import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = fs.readFileSync(new URL('../coffee-terminal/web/status-sound.js', import.meta.url), 'utf8');
function setup(storage) {
  const root = {}; vm.runInNewContext(source, root);
  let started = 0, stopped = 0, closed = 0;
  const parameter = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const context = { state: 'running', currentTime: 0, resume: async () => {}, close: async () => { closed++; }, createGain: () => ({ gain: parameter, connect() {}, disconnect() {} }), createOscillator: () => ({ frequency: parameter, connect() {}, disconnect() {}, start() { started++; }, stop() { stopped++; } }) };
  const sound = new root.CoffeeStatusSound({ contextFactory: () => context, storage });
  return { sound, context, counts: () => ({ started, stopped, closed }) };
}
const update = (s, status, revision = 1, id = 'task-1') => s.update({ id, status, revision });
test('default mute and enabling does not replay a completed snapshot', async () => {
  const { sound, counts } = setup(); update(sound, 'MAKING'); update(sound, 'READY', 2);
  await sound.enable(); update(sound, 'READY', 2); assert.equal(counts().started, 0);
});
test('live ready plays once; duplicates, stale frames and reconnect do not repeat', async () => {
  const { sound, counts } = setup(); await sound.enable(); update(sound, 'MAKING', 2); update(sound, 'READY', 3);
  update(sound, 'MAKING', 1); update(sound, 'READY', 3); sound.disconnect(); update(sound, 'READY', 3);
  assert.equal(counts().started, 1);
});
test('new tasks have independent acceptance and completion notifications', async () => {
  const { sound, counts } = setup(); await sound.enable();
  for (const id of ['one', 'two']) { update(sound, 'QUEUED', 0, id); update(sound, 'ACCEPTED', 1, id); update(sound, 'READY', 2, id); }
  assert.equal(counts().started, 4);
});
test('pause, mute and page exit stop nodes and close context', async () => {
  const { sound, counts } = setup(); await sound.enable(); update(sound, 'QUEUED'); update(sound, 'ACCEPTED', 2);
  update(sound, 'PAUSED', 3); assert.equal(sound.nodes.size, 0); sound.mute(); update(sound, 'READY', 4);
  assert.equal(counts().started, 1); sound.close(); assert.equal(counts().closed, 1);
});
test('reload dedup and storage unavailable both supported', async () => {
  const map = new Map(); const storage = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v) };
  for (let i = 0; i < 2; i++) { const { sound, counts } = setup(storage); await sound.enable(); update(sound, 'MAKING'); update(sound, 'READY', 2); assert.equal(counts().started, i === 0 ? 1 : 0); }
  const { sound } = setup({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  assert.doesNotThrow(() => update(sound, 'READY'));
});
test('muting during resume prevents late enable, zero volume suppresses audio', async () => {
  const { sound, context, counts } = setup(); let resume;
  context.resume = () => new Promise(resolve => { resume = resolve; });
  const pending = sound.enable(); sound.mute(); resume(); assert.equal(await pending, false);
  context.resume = async () => {}; await sound.enable(); sound.setVolume(0); update(sound, 'MAKING'); update(sound, 'READY', 2);
  assert.equal(counts().started, 0);
});
test('cloud and terminal ship identical sound source and stylesheet', () => {
  assert.equal(source, fs.readFileSync(new URL('../../coffee-cloud-mvp/public/shared/status-sound.js', import.meta.url), 'utf8'));
  assert.equal(fs.readFileSync(new URL('../coffee-terminal/web/status-sound.css', import.meta.url), 'utf8'), fs.readFileSync(new URL('../../coffee-cloud-mvp/public/shared/status-sound.css', import.meta.url), 'utf8'));
});
