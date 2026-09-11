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
  const catalogs = {};
  vm.runInNewContext(source, { TerminalI18n: { register(locale, messages) {
    catalogs[locale] = { ...catalogs[locale], ...messages };
  } } });
  assert.deepEqual(Object.keys(catalogs['zh-CN']).sort(), Object.keys(catalogs['en-US']).sort());
  for (const file of ['onboarding.html', 'index.html']) {
    const html = readFileSync(new URL('../coffee-terminal/web/' + file, import.meta.url), 'utf8');
    for (const [, key] of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
      assert.ok(catalogs['en-US'][key], `${file}: missing English message ${key}`);
      assert.ok(catalogs['zh-CN'][key], `${file}: missing Chinese message ${key}`);
    }
  }
});
