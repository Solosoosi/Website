import { dictionaries } from './i18n.js';
import { hydrateIcons, svg } from './icons.js';

const root = document.documentElement;
const listeners = new Set();

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode – ignore */
  }
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

export function getLang() {
  return root.lang === 'en' ? 'en' : 'he';
}

export function locale() {
  return getLang() === 'he' ? 'he-IL' : 'en-GB';
}

/** Look up "section.key" in the current language; `{name}` placeholders are filled from vars. */
export function t(path, vars) {
  const lookup = (lang) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), dictionaries[lang]);
  let str = lookup(getLang()) ?? lookup('he') ?? path;
  if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
  return str;
}

/** Pick the current language out of a { he, en } object from the config. */
export function pick(obj) {
  if (obj == null || typeof obj === 'string') return obj ?? '';
  return obj[getLang()] ?? obj.he ?? '';
}

export function onLangChange(fn) {
  listeners.add(fn);
}

export function setLang(lang) {
  root.lang = lang;
  root.dir = lang === 'he' ? 'rtl' : 'ltr';
  storageSet('lang', lang);
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.delete('lang');
    history.replaceState(null, '', url);
  }
  applyTranslations();
  listeners.forEach((fn) => fn(lang));
}

/**
 * Fill text from the dictionary:
 *   data-i18n="section.key"                     → textContent
 *   data-i18n-attr="placeholder:key;aria-label:key" → attributes
 */
export function applyTranslations(scope = document) {
  for (const el of scope.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of scope.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
  const titleKey = document.body.dataset.titleKey;
  if (titleKey && siteConfig) document.title = `${t(titleKey)} | ${pick(siteConfig.business.name)}`;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.content = t('meta.description');
  updateToggles();
  renderBusiness();
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function getTheme() {
  return root.dataset.theme === 'dark' ? 'dark' : 'light';
}

function setTheme(theme) {
  root.dataset.theme = theme;
  storageSet('theme', theme);
  updateToggles();
}

function updateToggles() {
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    const dark = getTheme() === 'dark';
    themeBtn.innerHTML = svg(dark ? 'sun' : 'moon');
    themeBtn.setAttribute('aria-label', t(dark ? 'a11y.toLight' : 'a11y.toDark'));
    themeBtn.title = themeBtn.getAttribute('aria-label');
  }
  const langBtn = document.getElementById('lang-toggle');
  if (langBtn) {
    langBtn.textContent = t('nav.switchLang');
    langBtn.lang = getLang() === 'he' ? 'en' : 'he';
  }
}

// ---------------------------------------------------------------------------
// Config (business details + services from the server)
// ---------------------------------------------------------------------------

let siteConfig = null;
let configPromise = null;

export function loadConfig() {
  configPromise ??= fetch('/api/config')
    .then((r) => {
      if (!r.ok) throw new Error(`config ${r.status}`);
      return r.json();
    })
    .then((cfg) => {
      siteConfig = cfg;
      applyTranslations();
      return cfg;
    });
  return configPromise;
}

export function formatPrice(price) {
  if (!price) return t('common.free');
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: siteConfig?.currency || 'ILS',
    maximumFractionDigits: 0,
  }).format(price);
}

function telHref(phone) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function renderBusiness() {
  if (!siteConfig) return;
  const b = siteConfig.business;
  const values = {
    name: pick(b.name),
    tagline: pick(b.tagline),
    phone: b.phone,
    email: b.email,
    address: pick(b.address),
    year: String(new Date().getFullYear()),
  };
  for (const el of document.querySelectorAll('[data-biz]')) {
    const v = values[el.dataset.biz];
    if (v != null) el.textContent = v;
  }
  for (const el of document.querySelectorAll('[data-biz-href]')) {
    const kind = el.dataset.bizHref;
    const href =
      kind === 'phone' ? b.phone && telHref(b.phone)
      : kind === 'email' ? b.email && `mailto:${b.email}`
      : kind === 'whatsapp' ? b.whatsapp && `https://wa.me/${b.whatsapp}`
      : kind === 'instagram' ? b.instagram
      : kind === 'facebook' ? b.facebook
      : kind === 'maps' ? values.address && `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(values.address)}`
      : '';
    const item = el.closest('[data-biz-item]') || el;
    item.hidden = !href;
    if (href) el.href = href;
  }
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v; // only ever used with trusted icon markup
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

export async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Mark invalid fields in a form. `fields` are server field names. */
export function showFieldErrors(form, fields = []) {
  for (const f of form.querySelectorAll('.has-error')) f.classList.remove('has-error');
  for (const e of form.querySelectorAll('.field-error')) e.remove();
  let first = null;
  for (const name of new Set(fields)) {
    const input = form.elements[name];
    if (!input) continue;
    const wrap = input.closest('.field, .checkbox');
    wrap?.classList.add('has-error');
    input.setAttribute('aria-invalid', 'true');
    if (wrap?.classList.contains('field')) {
      const id = `${input.id}-error`;
      wrap.append(el('span', { class: 'field-error', id, role: 'alert' }, t(`errors.${name}`)));
      input.setAttribute('aria-describedby', id);
    }
    first ??= input;
  }
  first?.focus();
}

export function clearFieldErrors(form) {
  showFieldErrors(form, []);
  for (const i of form.querySelectorAll('[aria-invalid]')) {
    i.removeAttribute('aria-invalid');
    i.removeAttribute('aria-describedby');
  }
}

export function toast(message) {
  const node = el('div', { class: 'toast', role: 'status' }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initHeader() {
  const header = document.querySelector('.site-header');
  const nav = document.getElementById('main-nav');
  const toggle = document.getElementById('nav-toggle');

  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  if (nav && toggle) {
    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.innerHTML = svg(open ? 'close' : 'menu');
    };
    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
    nav.addEventListener('click', (e) => e.target.closest('a') && setOpen(false));
    document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
  }

  document.getElementById('theme-toggle')?.addEventListener('click', () =>
    setTheme(getTheme() === 'dark' ? 'light' : 'dark'),
  );
  document.getElementById('lang-toggle')?.addEventListener('click', () =>
    setLang(getLang() === 'he' ? 'en' : 'he'),
  );
}

function initReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((i) => i.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  items.forEach((i) => io.observe(i));
}

hydrateIcons();
initHeader();
applyTranslations();
initReveal();
loadConfig().catch(() => {});
