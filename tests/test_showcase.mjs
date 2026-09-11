import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../coffee-terminal/web/showcase.js', import.meta.url), 'utf8'), context);
const { duration } = context.ShowcaseTiming;
test('showcase images and products remain within 3–4 seconds', () => {
  for (const type of ['image', 'product']) assert.equal(duration({ type, title: '咖啡'.repeat(100) }), 3500);
});
test('showcase reading time grows with Chinese and English copy and never exceeds 24 seconds', () => {
  assert.equal(duration({ type: 'text', title: '品牌理念' }), 7000);
  for (const body of ['咖啡'.repeat(30), 'Coffee ritual '.repeat(20)]) {
    assert.ok(duration({ type: 'text', body }) > 7000);
    assert.equal(duration({ type: 'text', body: body.repeat(100) }), 24000);
    assert.equal(duration({ type: 'review', body }), duration({ type: 'text', body }));
  }
});
