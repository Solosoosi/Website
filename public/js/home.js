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
let config = null;

const arrow = () => el('span', { class: 'flip-rtl', html: svg('arrow') });

// ---------------------------------------------------------------------------
// Treatments
// ---------------------------------------------------------------------------

function renderServices() {
  if (!config) return;
  $('services-list').replaceChildren(
    ...config.services.map((s, i) =>
      el(
        'li',
        { class: 'treatment' },
        el('span', { class: 'treatment-num' }, String(i + 1).padStart(2, '0')),
        el(
          'div',
          { class: 'treatment-img' },
          s.image ? el('img', { src: s.image, alt: pick(s.name), width: 700, height: 700, loading: 'lazy' }) : null,
        ),
        el(
          'div',
          { class: 'treatment-body' },
          el('h3', { class: 'treatment-name' }, pick(s.name)),
          el('p', { class: 'treatment-desc' }, pick(s.description)),
          s.tags ? el('ul', { class: 'tags' }, (pick(s.tags) || []).map((tag) => el('li', { class: 'tag' }, tag))) : null,
        ),
        el(
          'div',
          { class: 'treatment-side' },
          s.stat
            ? el('p', { class: 'stat' }, el('span', { class: 'stat-value' }, s.stat.value), el('span', { class: 'stat-label' }, pick(s.stat.label)))
            : null,
          el('span', { class: 'duration', html: svg('clock') }, t('common.minutes', { n: s.duration })),
          s.price == null ? null : el('span', { class: 'duration' }, formatPrice(s.price)),
          el(
            'a',
            { class: 'btn btn-outline btn-sm btn-arrow', href: bookHref(s.id), 'data-service': s.id },
            el('span', {}, t('treatments.book')),
            arrow(),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Body map: pick where it hurts → matching treatment
// ---------------------------------------------------------------------------

const ZONE_SERVICE = {
  neck: 'dry-needling',
  upper: 'dry-needling',
  lower: 'dry-needling',
  hips: 'dry-needling',
  legs: 'dry-needling',
  face: 'cosmetic',
  stress: 'stress',
};
const figure = document.querySelector('.bodymap-figure svg');
let currentZone = 'neck';

function svgEl(tag, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

/** Chart-style annotation: a line from the zone's point out to a label. */
function annotate() {
  if (!figure) return;
  const g = figure.querySelector('.annot');
  const points = [...figure.querySelectorAll(`.pt[data-zone="${currentZone}"]`)];
  if (!points.length) return g.replaceChildren();
  const p = points.reduce((a, b) => (Number(a.dataset.x) >= Number(b.dataset.x) ? a : b));
  const x = Number(p.dataset.x);
  const y = Number(p.dataset.y);
  const end = 412;
  g.replaceChildren(
    svgEl('line', { x1: x + 10, y1: y, x2: end, y2: y }),
    svgEl('circle', { cx: end, cy: y, r: 2.5 }),
    svgEl('text', { x: end, y: y - 9, 'text-anchor': 'end', direction: 'ltr' }, t(`bodymap.zones.${currentZone}.name`)),
  );
}

function renderMatch() {
  if (!config) return;
  const service = config.services.find((s) => s.id === ZONE_SERVICE[currentZone]);
  if (!service) return;
  $('bodymap-match').replaceChildren(
    service.image ? el('img', { class: 'match-img', src: service.image, alt: '', width: 700, height: 700, loading: 'lazy' }) : null,
    el('p', { class: 'match-label' }, t('bodymap.match')),
    el('h3', { class: 'match-name' }, pick(service.name)),
    el('p', { class: 'match-desc' }, t(`bodymap.zones.${currentZone}.desc`)),
    el('p', { class: 'match-note' }, t('bodymap.note')),
    el(
      'a',
      { class: 'btn btn-primary btn-arrow', href: bookHref(service.id), 'data-service': service.id },
      el('span', {}, t('bodymap.cta', { name: pick(service.name) })),
      arrow(),
    ),
  );
}

function selectZone(zone) {
  currentZone = zone;
  for (const b of document.querySelectorAll('.zone')) b.setAttribute('aria-pressed', String(b.dataset.zone === zone));
  for (const p of figure.querySelectorAll('.pt')) p.classList.toggle('is-active', p.dataset.zone === zone);
  annotate();
  renderMatch();
}

if (figure) {
  figure.addEventListener('click', (e) => {
    const p = e.target.closest('.pt');
    if (p) selectZone(p.dataset.zone);
  });
  for (const b of document.querySelectorAll('.zone')) b.addEventListener('click', () => selectZone(b.dataset.zone));
  selectZone(currentZone);
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
// Gallery lightbox
// ---------------------------------------------------------------------------

function initGallery() {
  const items = [...document.querySelectorAll('.gallery-item')];
  if (!items.length) return;
  let index = 0;
  const img = el('img', { alt: '' });
  const caption = el('span');
  const counter = el('span');
  const rtl = () => document.documentElement.dir === 'rtl';
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
        el('span', {}, caption, ' · ', counter),
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
    caption.textContent = item.querySelector('.cap')?.textContent || '';
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
    if (e.key === 'ArrowLeft') show(index + (rtl() ? 1 : -1));
    if (e.key === 'ArrowRight') show(index + (rtl() ? -1 : 1));
  });
  let touchX = null;
  dialog.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
  dialog.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) show(index + ((dx > 0) === rtl() ? 1 : -1));
  });
}

initGallery();

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
  renderMatch();
  annotate();
  renderHours();
}

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
