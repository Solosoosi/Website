import {
  api,
  clearFieldErrors,
  clinicNow,
  dayName,
  el,
  formatPrice,
  getLang,
  loadConfig,
  onLangChange,
  pick,
  showFieldErrors,
  t,
} from './site.js';
import { svg } from './icons.js';

const $ = (id) => document.getElementById(id);
const bookHref = (id) => `/book?service=${encodeURIComponent(id)}`;
const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('a11y-still');
const isRtl = () => document.documentElement.dir === 'rtl';
let config = null;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
let refreshScrollFx = () => {};

const arrow = () => el('span', { class: 'flip-rtl', html: svg('arrow') });

// ---------------------------------------------------------------------------
// Treatments: cards that stack as you scroll
// ---------------------------------------------------------------------------

// Each card's photo opens like a curtain the first time it comes into view.
const cardObserver =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add('is-in');
              cardObserver.unobserve(e.target);
            }
          }
        },
        { rootMargin: '0px 0px -12% 0px' },
      )
    : null;

function renderServices() {
  if (!config) return;
  const list = $('services-list');
  list.replaceChildren(
    ...config.services.map((s, i) => {
      const card = el(
        'li',
        { class: 'stack-card', id: `svc-${s.id}` },
        el(
          'div',
          { class: 'stack-img' },
          s.image ? el('img', { src: s.image, alt: pick(s.name), width: 700, height: 700, loading: 'lazy' }) : null,
        ),
        el(
          'div',
          { class: 'stack-body' },
          el('span', { class: 'stack-num', 'aria-hidden': 'true' }, `0${i + 1}`),
          el('h3', { class: 'stack-name' }, pick(s.name)),
          el('p', { class: 'stack-desc' }, pick(s.description)),
          el(
            'div',
            { class: 'stack-foot' },
            el(
              'a',
              { class: 'btn btn-primary btn-arrow', href: bookHref(s.id), 'data-service': s.id },
              el('span', {}, t('treatments.book')),
              arrow(),
            ),
            s.price == null ? null : el('span', { class: 'duration' }, formatPrice(s.price)),
          ),
        ),
      );
      card.style.setProperty('--i', String(i));
      return card;
    }),
  );
  for (const card of list.children) {
    if (cardObserver && !reducedMotion()) cardObserver.observe(card);
    else card.classList.add('is-in');
  }
  refreshScrollFx();
}

// ---------------------------------------------------------------------------
// His quote: each word lights up as it scrolls through the screen
// ---------------------------------------------------------------------------

function renderWords() {
  for (const node of document.querySelectorAll('[data-words]')) {
    const parts = [];
    t(node.dataset.words)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((word, i) => {
        if (i) parts.push(' ');
        parts.push(el('span', { class: 'w' }, word));
      });
    node.replaceChildren(...parts);
    node.dataset.lit = '-1';
  }
  refreshScrollFx();
}

// ---------------------------------------------------------------------------
// Scroll effects: the hero frame opens to the full width, treatment cards sink
// back as the next one covers them, the quote lights up, gallery columns drift.
// ---------------------------------------------------------------------------

function initScrollFx() {
  const hero = document.querySelector('.hero');
  const media = $('hero-media');
  const list = $('services-list');
  const mosaic = $('mosaic');
  const cols = [...document.querySelectorAll('.mosaic-col')];
  const stacked = window.matchMedia('(min-width: 861px) and (min-height: 700px)');
  const wide = window.matchMedia('(min-width: 761px)');
  let queued = false;

  function update() {
    queued = false;
    const vh = window.innerHeight;
    const still = reducedMotion();

    if (hero && media) {
      const top = media.getBoundingClientRect().top + window.scrollY;
      const p = still ? 0 : clamp01(window.scrollY / Math.max(1, top - 72));
      hero.style.setProperty('--hero-p', p.toFixed(4));
    }

    if (list) {
      const cards = [...list.children];
      cards.forEach((card, i) => {
        let depth = 0;
        const next = cards[i + 1];
        if (next && stacked.matches && !still) {
          const top = card.getBoundingClientRect().top;
          const h = card.offsetHeight;
          depth = clamp01((top + h - next.getBoundingClientRect().top) / Math.max(1, h - 16));
        }
        card.style.setProperty('--depth', depth.toFixed(3));
      });
    }

    for (const node of document.querySelectorAll('.words')) {
      const words = node.children;
      if (!words.length) continue;
      let lit = words.length;
      if (!still) {
        const r = node.getBoundingClientRect();
        lit = Math.round(clamp01((vh * 0.88 - r.top) / (r.height + vh * 0.4)) * words.length);
      }
      if (Number(node.dataset.lit) !== lit) {
        node.dataset.lit = String(lit);
        for (let i = 0; i < words.length; i++) words[i].classList.toggle('is-lit', i < lit);
      }
    }

    if (mosaic && cols.length) {
      const on = wide.matches && !still;
      const r = mosaic.getBoundingClientRect();
      const d = (r.top + r.height / 2 - vh / 2) / vh;
      for (const col of cols) {
        col.style.setProperty('--shift', on ? `${(d * Number(col.dataset.speed) * vh * 1.5).toFixed(1)}px` : '0px');
      }
    }
  }

  const request = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  refreshScrollFx = request;
  update();
}

// ---------------------------------------------------------------------------
// Gallery: full-screen viewer
// ---------------------------------------------------------------------------

function initLightbox(items) {
  let index = 0;
  const img = el('img', { alt: '' });
  const counter = el('span');
  const navButton = (icon, labelKey, step) =>
    el(
      'button',
      { type: 'button', class: 'icon-btn', 'aria-label': t(labelKey), onclick: () => show(index + step) },
      el('span', { class: 'flip-rtl', html: svg(icon) }),
    );
  const dialog = el(
    'dialog',
    { class: 'lightbox', 'aria-label': t('gallery.title') },
    el(
      'div',
      { class: 'lightbox-inner' },
      el(
        'div',
        { class: 'lightbox-top' },
        counter,
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': t('gallery.close'), html: svg('close'), onclick: () => dialog.close() }),
      ),
      el('figure', {}, img),
      el('div', { class: 'lightbox-nav' }, navButton('chevronPrev', 'gallery.prev', -1), navButton('chevronNext', 'gallery.next', 1)),
    ),
  );
  document.body.append(dialog);

  function show(i) {
    index = (i + items.length) % items.length;
    const item = items[index];
    img.src = item.dataset.large;
    img.alt = item.querySelector('img').alt;
    counter.textContent = t('gallery.count', { n: index + 1, total: items.length });
  }

  items.forEach((item, i) =>
    item.addEventListener('click', () => {
      show(i);
      dialog.showModal();
    }),
  );
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index + (isRtl() ? 1 : -1));
    if (e.key === 'ArrowRight') show(index + (isRtl() ? -1 : 1));
  });
  let touchX = null;
  dialog.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
  dialog.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) show(index + ((dx > 0) === isRtl() ? 1 : -1));
  });
}

// ---------------------------------------------------------------------------
// Soft light that follows the mouse across the hero
// ---------------------------------------------------------------------------

function initCursorGlow() {
  const hero = document.querySelector('.hero');
  if (!hero || !window.matchMedia('(pointer: fine)').matches) return;
  let tx = 50;
  let ty = 40;
  let x = 50;
  let y = 40;
  let frame = null;
  const loop = () => {
    x += (tx - x) * 0.1;
    y += (ty - y) * 0.1;
    hero.style.setProperty('--mx', `${x}%`);
    hero.style.setProperty('--my', `${y}%`);
    frame = Math.abs(tx - x) + Math.abs(ty - y) > 0.05 ? requestAnimationFrame(loop) : null;
  };
  hero.addEventListener('pointermove', (e) => {
    if (reducedMotion()) return;
    const r = hero.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width) * 100;
    ty = ((e.clientY - r.top) / r.height) * 100;
    frame ??= requestAnimationFrame(loop);
  });
}

// ---------------------------------------------------------------------------
// Opening hours table
// ---------------------------------------------------------------------------

function renderHours() {
  const body = $('hours-body');
  if (!body || !config?.hours) return;
  const today = clinicNow(config.timezone).day;
  const range = (from, to) => el('span', {}, `${from}–${to}`);
  body.replaceChildren(
    ...[0, 1, 2, 3, 4, 5, 6].map((day) => {
      const ranges = config.hours[day] || [];
      return el(
        'tr',
        { class: day === today ? 'is-today' : null },
        el('th', { scope: 'row' }, dayName(day)),
        el(
          'td',
          { class: ranges.length ? null : 'is-closed' },
          ...(ranges.length
            ? ranges.flatMap(([from, to], i) => (i ? [', ', range(from, to)] : [range(from, to)]))
            : [t('visit.closed')]),
        ),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Contact form
// ---------------------------------------------------------------------------

const form = $('contact-form');
const status = $('contact-status');

function setStatus(kind, message) {
  status.replaceChildren(message ? el('p', { class: `alert alert-${kind}` }, message) : '');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  clearFieldErrors(form);
  setStatus();

  if (config?.handoff === 'whatsapp') {
    const missing = [];
    if (data.name.trim().length < 2) missing.push('name');
    if (data.message.trim().length < 2) missing.push('message');
    if (missing.length) return showFieldErrors(form, missing);
    const text = `${t('contact.waIntro', { name: data.name.trim() })}\n${data.message.trim()}`;
    const href = `https://wa.me/${config.business.whatsapp}?text=${encodeURIComponent(text)}`;
    window.open(href, '_blank', 'noopener');
    status.replaceChildren(
      el(
        'p',
        { class: 'alert alert-success' },
        `${t('contact.waSuccess')} `,
        el('a', { href, target: '_blank', rel: 'noopener' }, t('contact.waLink')),
      ),
    );
    return;
  }

  const bad = [];
  if (data.name.trim().length < 2) bad.push('name');
  if (!data.phone.trim() && !data.email.trim()) {
    bad.push('phone');
    setStatus('error', t('contact.needContact'));
  }
  if (data.message.trim().length < 2) bad.push('message');
  if (bad.length) return showFieldErrors(form, bad);

  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = t('contact.sending');
  try {
    await api('/api/contact', { method: 'POST', body: { ...data, lang: getLang() } });
    form.reset();
    setStatus('success', t('contact.success'));
  } catch (err) {
    if (err.status === 400) showFieldErrors(form, err.data.fields);
    else setStatus('error', t(err.status === 429 ? 'errors.rate' : 'common.error'));
  } finally {
    button.disabled = false;
    button.textContent = t(button.dataset.i18n);
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// The treatments, right under the headline: a small photo and the name,
// each jumping to its card below.
function renderHeroTreatments() {
  const list = $('hero-treatments');
  if (!list || !config) return;
  list.replaceChildren(
    ...config.services.map((s) =>
      el(
        'li',
        {},
        el(
          'a',
          { href: `#svc-${s.id}` },
          s.image ? el('img', { src: s.image, alt: '', width: 76, height: 76 }) : null,
          el('span', {}, pick(s.name)),
        ),
      ),
    ),
  );
}

function renderAll() {
  renderHeroTreatments();
  renderServices();
  renderWords();
  renderHours();
}

// The intro curtain is a one-off: once the hero has settled, take it out so
// it doesn't replay when the page is shown again.
const intro = document.querySelector('.intro');
const media = $('hero-media');
if (intro && media) {
  const settle = () => {
    intro.remove();
    document.documentElement.classList.add('no-intro');
  };
  if (getComputedStyle(intro).display === 'none') settle();
  else media.addEventListener('animationend', settle, { once: true });
}

// Lazy photos load as you scroll; shortly after the page is ready, fetch any
// that are still waiting so none can stay empty (some in-app browsers stall).
window.addEventListener('load', () => {
  setTimeout(() => {
    for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
  }, 2500);
});

const galleryItems = [...document.querySelectorAll('.mosaic-item')];
if (galleryItems.length) initLightbox(galleryItems);
renderWords();
initScrollFx();
initCursorGlow();

loadConfig()
  .then((cfg) => {
    config = cfg;
    renderAll();
    if (cfg.handoff === 'whatsapp') {
      // No server: messages go straight to WhatsApp, so phone/email fields aren't needed.
      form.elements.phone.closest('.form-row').hidden = true;
      const button = form.querySelector('[type="submit"]');
      button.dataset.i18n = 'contact.sendWhatsapp';
      button.textContent = t('contact.sendWhatsapp');
    }
  })
  .catch(() => {
    $('services-list').replaceChildren(el('li', { class: 'alert alert-error' }, t('common.error')));
  });

onLangChange(renderAll);
setInterval(renderHours, 60_000);
