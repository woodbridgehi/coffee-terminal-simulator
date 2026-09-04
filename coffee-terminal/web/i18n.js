(function attachTerminalI18n(global) {
  'use strict';
  const catalogs = new Map();
  let locale = 'zh-CN';
  const normalize = value => String(value || '').toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
  const register = (target, messages) => catalogs.set(normalize(target), { ...(catalogs.get(normalize(target)) || {}), ...messages });
  const t = (key, params = {}) => {
    const template = catalogs.get(locale)?.[key] ?? catalogs.get('zh-CN')?.[key] ?? key;
    return String(template).replace(/\{([A-Za-z][\w]*)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
  };
  const translate = (root = global.document) => {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
      const data = `i18n${attr.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')}`;
      root.querySelectorAll(`[data-${data.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}]`).forEach(node => node.setAttribute(attr, t(node.dataset[data])));
    }
  };
  const setLocale = (value, { translateDocument = true } = {}) => {
    locale = normalize(value);
    if (global.document?.documentElement) global.document.documentElement.lang = locale;
    if (translateDocument) translate();
    return locale;
  };
  global.TerminalI18n = Object.freeze({ register, t, translate, setLocale, getLocale: () => locale, normalize });
})(globalThis);
