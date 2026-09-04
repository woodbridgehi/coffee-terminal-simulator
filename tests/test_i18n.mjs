import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({ Intl, console });
context.globalThis = context;
vm.runInContext(readFileSync(new URL('../coffee-terminal/web/i18n.js', import.meta.url), 'utf8'), context);
vm.runInContext(readFileSync(new URL('../coffee-terminal/web/locales.js', import.meta.url), 'utf8'), context);

test('terminal locale normalizes variants and interpolates translated messages', () => {
  assert.equal(context.TerminalI18n.setLocale('en-GB', { translateDocument: false }), 'en-US');
  assert.equal(context.TerminalI18n.t('terminal.step', { current: 2, total: 5 }), 'Step 2 / 5');
  assert.equal(context.TerminalI18n.setLocale('../../bad', { translateDocument: false }), 'zh-CN');
  assert.equal(context.TerminalI18n.t('terminal.step', { current: 2, total: 5 }), '步骤 2 / 5');
});

test('terminal Chinese and English catalogs have the same semantic keys', () => {
  const source = readFileSync(new URL('../coffee-terminal/web/locales.js', import.meta.url), 'utf8');
  const halves = source.split("TerminalI18n.register('en-US'");
  const keys = part => [...part.matchAll(/'([^']+)'\s*:/g)].map(match => match[1]).sort();
  assert.deepEqual(keys(halves[0]), keys(halves[1]));
});
