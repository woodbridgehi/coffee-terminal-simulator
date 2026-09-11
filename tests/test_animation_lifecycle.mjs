import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../coffee-terminal/web/drink-visual.js', import.meta.url), 'utf8');

function buildHarness() {
  const anime = {
    animateCalls: [],
    removeCalls: [],
    animate(targets, parameters) {
      this.animateCalls.push({ targets, parameters });
      return { pause() {}, play() {}, restart() {}, remove() {} };
    },
    stagger(value) { return value; },
    remove(element) { this.removeCalls.push(element); },
  };

  function makeEl(tag) {
    return {
      tag,
      attributes: {},
      dataset: {},
      classList: {
        _classes: new Set(),
        add(...names) { names.forEach((n) => this._classes.add(n)); },
        remove(...names) { names.forEach((n) => this._classes.delete(n)); },
        toggle(name, force) { if (force) this._classes.add(name); else this._classes.delete(name); },
        contains(name) { return this._classes.has(name); },
      },
      style: {
        removeProperty(property) { delete this[property]; },
        setProperty(property, value) { this[property] = value; },
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      getTotalLength() { return 100; },
      querySelector() { return makeEl('el'); },
      querySelectorAll(selector) {
        const count = String(selector).includes('ice-drop') ? 3 : 4;
        return Array.from({ length: count }, () => makeEl('el'));
      },
    };
  }

  const stage = makeEl('stage');
  const svg = makeEl('svg');
  const contents = makeEl('g');
  const body = makeEl('g');
  stage.querySelector = (selector) => {
    if (selector === '.drink-visual') return svg;
    if (selector === '.drink-contents') return contents;
    if (selector === '.liquid-body') return body;
    return makeEl('el');
  };

  const document = { querySelector: (selector) => (selector === '#coffeeStage' ? stage : null) };
  const window = { anime, matchMedia: (query) => ({ matches: false, media: query }) };

  const context = { window, document };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { visual: context.window.DrinkVisual, anime, body, stage };
}

const baseTask = () => ({
  taskId: 't1',
  stepIndex: 0,
  stepProgress: 0,
  recipe: {
    recipeId: 'iced-latte-v1',
    name: '冰拿铁',
    visual: { profile: 'iced-latte' },
    steps: [
      { id: 'prepare-cup', animationCue: 'cup-arrive' },
      { id: 'add-ice', animationCue: 'ice-drop' },
      { id: 'extract-coffee', animationCue: 'brew-stream' },
      { id: 'add-milk', animationCue: 'milk-pour' },
    ],
  },
});

test('render starts cue animations', () => {
  const { visual, anime } = buildHarness();
  visual.render(baseTask());
  assert.ok(anime.animateCalls.length > 0, 'expected cue animations to start');
});

test('render dedups on the same step key (no restart on repeated polls)', () => {
  const { visual, anime } = buildHarness();
  const task = baseTask();
  visual.render(task);
  const count = anime.animateCalls.length;
  visual.render(task); // same task/step — key unchanged
  assert.equal(anime.animateCalls.length, count, 'same key must not restart animations');
});

test('step change purges stale looping tweens via anime.remove (B1)', () => {
  const { visual, anime } = buildHarness();
  const task = baseTask();
  visual.render(task);
  const before = anime.removeCalls.length;
  task.stepIndex = 2;
  task.stepProgress = 0;
  visual.render(task);
  assert.ok(anime.removeCalls.length > before, 'step change should call anime.remove to purge engine entries');
});

test('reset purges animations and allows a fresh render afterwards', () => {
  const { visual, anime } = buildHarness();
  const task = baseTask();
  visual.render(task);
  const before = anime.removeCalls.length;
  visual.reset();
  assert.ok(anime.removeCalls.length > before, 'reset should purge via anime.remove');
  const countAfterReset = anime.animateCalls.length;
  visual.render(task); // activeKey was cleared, so a fresh render animates again
  assert.ok(anime.animateCalls.length > countAfterReset, 'render after reset should animate again');
});

test('updateProgress maps pour-step progress to liquid fill level (T1)', () => {
  const { visual, body } = buildHarness();
  const task = baseTask(); // steps: cup-arrive, ice-drop, brew, milk -> pour cues: brew + milk = 2 total
  task.stepIndex = 0; task.stepProgress = 0.5; // cup-arrive is not a pour step -> still empty
  visual.updateProgress(task);
  assert.equal(body.style.transform, 'scaleY(0)');
  task.stepIndex = 2; task.stepProgress = 0.5; // brew halfway -> 0.5 / 2
  visual.updateProgress(task);
  assert.equal(body.style.transform, 'scaleY(0.25)');
  task.stepIndex = 3; task.stepProgress = 1; // milk done -> (1 + 1) / 2
  visual.updateProgress(task);
  assert.equal(body.style.transform, 'scaleY(1)');
});

test('updateProgress with no task empties the cup', () => {
  const { visual, body } = buildHarness();
  visual.updateProgress(null);
  assert.equal(body.style.transform, 'scaleY(0)');
});

test('customized 2D view hides removed ingredients and keeps reduced liquid volume', () => {
  const { visual, body, stage } = buildHarness(), task = baseTask();
  task.recipe.customization = {milk:'NONE',ice:'NONE',sugar:'NONE'};
  task.recipe.optionSchema = {temperature:'ICED'};
  task.recipe.liquidReferenceMl = 225;
  task.recipe.steps = [{id:'brew',animationCue:'brew-stream',consumes:[{unit:'ml',amount:45}]}];
  task.stepProgress = 1;
  visual.render(task); visual.updateProgress(task);
  assert.equal(body.style.transform,'scaleY(0.2)');
  for (const name of ['custom-no-milk','custom-no-ice','custom-no-syrup','custom-no-steam']) assert.ok(stage.classList.contains(name));
});
