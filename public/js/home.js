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

function countUp(node) {
  const target = Number(node.dataset.count);
  if (reducedMotion()) {
    node.textContent = String(target);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - start) / 1400);
    node.textContent = String(Math.round(target * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const counterObserver =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              counterObserver.unobserve(e.target);
              countUp(e.target);
            }
          }
        },
        { threshold: 0.6 },
      )
    : null;

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
          s.stat
            ? el(
                'p',
                { class: 'stat' },
                el('span', { class: 'stat-value', 'data-count': s.stat.value }, s.stat.value),
                el('span', { class: 'stat-label' }, pick(s.stat.label)),
              )
            : null,
          el('p', { class: 'stack-desc' }, pick(s.description)),
          s.tags ? el('ul', { class: 'tags' }, (pick(s.tags) || []).map((tag) => el('li', { class: 'tag' }, tag))) : null,
          el(
            'div',
            { class: 'stack-foot' },
            el(
              'a',
              { class: 'btn btn-primary btn-arrow', href: bookHref(s.id), 'data-service': s.id },
              el('span', {}, t('treatments.book')),
              arrow(),
            ),
            el('span', { class: 'duration', html: svg('clock') }, t('common.minutes', { n: s.duration })),
            s.price == null ? null : el('span', { class: 'duration' }, formatPrice(s.price)),
          ),
        ),
      );
      card.style.setProperty('--i', String(i));
      return card;
    }),
  );
  for (const node of list.querySelectorAll('[data-count]')) {
    const below = node.getBoundingClientRect().top > window.innerHeight;
    if (counterObserver && below && !reducedMotion()) {
      node.textContent = '0';
      counterObserver.observe(node);
    }
  }
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

/** A soft dashed line from the zone's point out to its name. */
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
    svgEl('line', { x1: x + 11, y1: y, x2: end, y2: y }),
    svgEl('circle', { cx: end, cy: y, r: 3 }),
    svgEl('text', { x: end, y: y - 10, 'text-anchor': 'end', direction: 'ltr' }, t(`bodymap.zones.${currentZone}.name`)),
  );
}

function renderMatch() {
  if (!config) return;
  const service = config.services.find((s) => s.id === ZONE_SERVICE[currentZone]);
  if (!service) return;
  const box = $('bodymap-match');
  box.replaceChildren(
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
  // Replay the soft entrance animation on every change.
  box.style.animation = 'none';
  void box.offsetWidth;
  box.style.animation = '';
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
// Breathing exercise: inhale 4s, hold 4s, exhale 6s, four rounds
// ---------------------------------------------------------------------------

function initBreathing() {
  const box = $('breathe-box');
  if (!box) return;
  const circle = $('breathe-circle');
  const phaseEl = $('breathe-phase');
  const countEl = $('breathe-count');
  const button = $('breathe-toggle');
  const label = button.querySelector('[data-i18n]');
  const PHASES = [
    { key: 'inhale', secs: 4, scale: 1 },
    { key: 'hold', secs: 4, scale: 1 },
    { key: 'exhale', secs: 6, scale: 0.62 },
  ];
  const ROUNDS = 4;
  let running = false;
  let timer = null;

  const setText = (node, key, vars) => {
    node.dataset.i18n = key;
    node.textContent = t(key, vars);
  };

  function stop(finished = false) {
    running = false;
    clearTimeout(timer);
    box.classList.remove('is-running');
    circle.style.setProperty('--breath-time', '1.6s');
    circle.style.setProperty('--breath', '0.62');
    setText(phaseEl, finished ? 'breathe.done' : 'breathe.ready');
    countEl.textContent = '';
    setText(label, 'breathe.start');
  }

  function runPhase(round, index) {
    if (!running) return;
    if (index === PHASES.length) {
      round += 1;
      index = 0;
    }
    if (round > ROUNDS) return stop(true);
    const phase = PHASES[index];
    circle.style.setProperty('--breath-time', `${phase.secs}s`);
    circle.style.setProperty('--breath', String(phase.scale));
    setText(phaseEl, `breathe.${phase.key}`);
    let left = phase.secs;
    countEl.textContent = `${left} · ${t('breathe.cycle', { n: round, total: ROUNDS })}`;
    const tick = () => {
      if (!running) return;
      left -= 1;
      if (left <= 0) return runPhase(round, index + 1);
      countEl.textContent = `${left} · ${t('breathe.cycle', { n: round, total: ROUNDS })}`;
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 1000);
  }

  button.addEventListener('click', () => {
    if (running) return stop();
    running = true;
    box.classList.add('is-running');
    setText(label, 'breathe.stop');
    runPhase(1, 0);
  });
}

// ---------------------------------------------------------------------------
// Process: a line that draws itself through the three steps as you scroll
// ---------------------------------------------------------------------------

function initProcess() {
  const flow = $('process-flow');
  if (!flow) return;
  const line = flow.querySelector('.process-line');
  const track = line.querySelector('.track');
  const draw = line.querySelector('.draw');
  const stepList = flow.querySelector('.steps');
  const steps = [...flow.querySelectorAll('.step')];
  let fractions = steps.map((_, i) => i / (steps.length - 1));

  function layout() {
    const box = flow.getBoundingClientRect();
    if (!box.width) return;
    line.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    line.style.height = `${box.height}px`;
    const nodes = steps.map((s) => {
      const r = s.querySelector('.step-node').getBoundingClientRect();
      return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top];
    });
    const startX = isRtl() ? box.width : 0;
    const endX = isRtl() ? 0 : box.width;
    const pts = [[startX, nodes[0][1]], ...nodes, [endX, nodes.at(-1)[1]]];
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const mid = (x0 + x1) / 2;
      // Gentle waves between the steps; straight lead-in and lead-out at the edges.
      const wave = i === 1 || i === pts.length - 1 ? 0 : (i % 2 ? -1 : 1) * 36;
      d += ` C${mid},${y0 + wave} ${mid},${y1 + wave} ${x1},${y1}`;
    }
    track.setAttribute('d', d);
    draw.setAttribute('d', d);
    fractions = nodes.map(([x]) => Math.abs(x - startX) / box.width);
    update();
  }

  function update() {
    const r = flow.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.25)));
    const shown = reducedMotion() ? 1 : p;
    draw.setAttribute('stroke-dashoffset', String(1 - shown));
    stepList.style.setProperty('--p', String(shown));
    const vertical = getComputedStyle(line).display === 'none';
    steps.forEach((s, i) => {
      const at = vertical ? i / (steps.length - 1) : fractions[i];
      s.classList.toggle('is-lit', shown >= at - 0.02);
    });
  }

  let queued = false;
  window.addEventListener(
    'scroll',
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        update();
      });
    },
    { passive: true },
  );
  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(flow);
  document.fonts?.ready.then(layout);
  layout();
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
  const caption = el('span');
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
  renderMatch();
  annotate();
  renderHours();
}

initBreathing();
initProcess();
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
