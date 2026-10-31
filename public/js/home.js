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

const arrow = () => el('span', { class: 'flip-rtl', html: svg('arrow') });

// ---------------------------------------------------------------------------
// Treatments: cards that stack as you scroll
// ---------------------------------------------------------------------------

function renderServices() {
  if (!config) return;
  const list = $('services-list');
  list.replaceChildren(
    ...config.services.map((s, i) => {
      const card = el(
        'li',
        { class: 'stack-card' },
        el(
          'div',
          { class: 'stack-img' },
          s.image ? el('img', { src: s.image, alt: pick(s.name), width: 700, height: 700, loading: 'lazy' }) : null,
        ),
        el(
          'div',
          { class: 'stack-body' },
          el('span', { class: 'stack-num' }, `0${i + 1} / 0${config.services.length}`),
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
}

// ---------------------------------------------------------------------------
// Gallery: draggable carousel + full-screen viewer
// ---------------------------------------------------------------------------

function initCarousel() {
  const strip = $('carousel');
  if (!strip) return;
  const items = [...strip.querySelectorAll('.carousel-item')];
  const bar = document.querySelector('.carousel-progress span');
  const prev = $('carousel-prev');
  const next = $('carousel-next');

  const update = () => {
    const max = strip.scrollWidth - strip.clientWidth;
    const pos = Math.abs(strip.scrollLeft);
    bar.style.setProperty('--p', String(max > 0 ? 0.12 + 0.88 * (pos / max) : 1));
    prev.disabled = pos < 4;
    next.disabled = pos > max - 4;
  };
  const stepSize = () => items[0].getBoundingClientRect().width + 18;
  next.addEventListener('click', () => strip.scrollBy({ left: (isRtl() ? -1 : 1) * stepSize(), behavior: 'smooth' }));
  prev.addEventListener('click', () => strip.scrollBy({ left: (isRtl() ? 1 : -1) * stepSize(), behavior: 'smooth' }));
  strip.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });

  // Drag with the mouse (touch screens scroll natively).
  let drag = null;
  let dragged = false;
  strip.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: strip.scrollLeft };
    dragged = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!dragged && Math.abs(dx) > 6) {
      dragged = true;
      strip.classList.add('is-dragging');
    }
    if (dragged) strip.scrollLeft = drag.left - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    if (dragged) {
      strip.classList.remove('is-dragging');
      // Let snapping settle on the nearest photo.
      const center = strip.getBoundingClientRect().left + strip.clientWidth / 2;
      const nearest = items.reduce((a, b) => {
        const da = Math.abs(a.getBoundingClientRect().left + a.offsetWidth / 2 - center);
        const db = Math.abs(b.getBoundingClientRect().left + b.offsetWidth / 2 - center);
        return db < da ? b : a;
      });
      nearest.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  });
  strip.addEventListener(
    'click',
    (e) => {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
      }
    },
    true,
  );
  update();
  initLightbox(items);
}

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

function renderAll() {
  renderServices();
  renderHours();
}

initCarousel();
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
