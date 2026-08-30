import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../coffee-terminal/web/app.js', import.meta.url), 'utf8');

function harness() {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      classList: { add() {}, remove() {}, toggle() {} }, style: {}, dataset: {},
      matches: () => false, value: '',
    });
    return elements.get(selector);
  };
  const context = { document: { querySelector: element }, window: {}, setInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, element };
}

test('controls allow retry only in RETRY_WAIT and never resume recovered tasks', async () => {
  const { context, element } = harness();
  await vm.runInContext('mockApi.start_demo_order()', context);
  const data = await vm.runInContext('mockApi.get_state()', context);
  for (const [state, recoveryHold, retry, resume] of [
    ['RETRY_WAIT', false, true, false], ['FAILED', false, false, false],
    ['PAUSED', false, false, true], ['PAUSED', true, false, false],
    ['SUCCEEDED', false, false, false],
  ]) {
    Object.assign(data.runtime.task, { state, recoveryHold, failure: { retryable: true } });
    context.render(data);
    assert.equal(element('#retryTask').disabled, !retry, state);
    assert.equal(element('#pauseResume').disabled, !resume, state);
    if (recoveryHold) assert.equal(element('#skipStep').disabled, true);
  }
});

test('browser preview honors retry budget and does not replace waiting task', async () => {
  const { context } = harness();
  await vm.runInContext('mockApi.start_demo_order()', context);
  const data = await vm.runInContext('mockApi.get_state()', context);
  const task = data.runtime.task;
  Object.assign(task, { state: 'RETRY_WAIT', failure: { retryable: true } });
  assert.equal((await vm.runInContext('mockApi.start_demo_order()', context)).ok, false);
  assert.equal((await vm.runInContext('mockApi.command("clear")', context)).ok, false);
  assert.equal((await vm.runInContext('mockApi.command("retry")', context)).ok, true);
  assert.equal(task.attempt, 2);
  assert.equal(task.stepRetries[task.recipe.steps[0].id], 1);
  task.state = 'FAILED';
  assert.equal((await vm.runInContext('mockApi.command("retry")', context)).ok, false);
  assert.equal(task.state, 'FAILED');
});
