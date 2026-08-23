import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../coffee-terminal/web/drink-visual.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);
const visual = context.window.DrinkVisual;

test('maps the four supported drink identities and custom fallback', () => {
  assert.equal(visual.inferProfile({ recipeId: 'iced-latte-v1' }), 'iced-latte');
  assert.equal(visual.inferProfile({ name: '热美式' }), 'americano');
  assert.equal(visual.inferProfile({ name: '双份浓缩' }), 'espresso');
  assert.equal(visual.inferProfile({ name: '信义榛果特调' }), 'hazelnut-special');
  assert.equal(visual.inferProfile({ name: '运营商新品' }), 'generic');
  assert.equal(visual.inferProfile({ visual: { profile: 'americano' }, name: '任意名字' }), 'americano');
});

test('maps recipe steps to reusable animation cues', () => {
  assert.equal(visual.inferCue({ id: 'prepare-cup' }), 'cup-arrive');
  assert.equal(visual.inferCue({ id: 'add-ice' }), 'ice-drop');
  assert.equal(visual.inferCue({ id: 'extract-coffee' }), 'brew-stream');
  assert.equal(visual.inferCue({ id: 'add-hot-water' }), 'water-pour');
  assert.equal(visual.inferCue({ id: 'add-milk' }), 'milk-pour');
  assert.equal(visual.inferCue({ id: 'add-hazelnut' }), 'syrup-swirl');
  assert.equal(visual.inferCue({ id: 'seal-and-serve' }), 'seal');
  assert.equal(visual.inferCue({ id: 'serve' }), 'serve');
  assert.equal(visual.inferCue({ animationCue: 'idle', id: 'custom' }), 'idle');
});
