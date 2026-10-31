import {
  api,
  clearFieldErrors,
  el,
  formatPrice,
  getLang,
  loadConfig,
  locale,
  onLangChange,
  pick,
  showFieldErrors,
  t,
} from './site.js';
import { svg } from './icons.js';

const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  step: 1,
  service: null,
  month: null, // "YYYY-MM"
  date: null,
  time: null,
  loading: false,
  autoAdvanced: false,
};
const cache = new Map(); // `${serviceId}|${month}` → { "YYYY-MM-DD": ["HH:MM"] }

// ---------------------------------------------------------------------------
// Date helpers (plain strings, no time-zone surprises)
// ---------------------------------------------------------------------------

const utc = (s) => {
  const [y, m, d = 1] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (date) => date.toISOString().slice(0, 10);
const monthOf = (dateStr) => dateStr.slice(0, 7);
function shiftMonth(month, n) {
  const d = utc(month);
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d).slice(0, 7);
}
function lastDay(month) {
  const d = utc(month);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}
function maxDate() {
  const d = utc(state.config.today);
  d.setUTCDate(d.getUTCDate() + state.config.maxDaysAhead);
  return iso(d);
}
function fmtDate(dateStr, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat(locale(), { ...opts, timeZone: 'UTC' }).format(utc(dateStr));
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function goTo(step, { focus = true } = {}) {
  state.step = step;
  for (let i = 1; i <= 3; i++) $(`step-${i}`).hidden = i !== step;
  for (const li of $('stepper').children) {
    const n = Number(li.dataset.step);
    li.classList.toggle('is-active', n === step);
    li.classList.toggle('is-done', n < step);
    if (n === step) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
  if (step === 2) loadMonth();
  if (focus) {
    $(`step-${step}-title`).focus({ preventScroll: true });
    $('stepper').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ---------------------------------------------------------------------------
// Step 1 – service
// ---------------------------------------------------------------------------

function renderServices() {
  $('service-options').replaceChildren(
    ...state.config.services.map((s) =>
      el(
        'button',
        {
          type: 'button',
          class: 'service-option',
          'aria-pressed': String(state.service?.id === s.id),
          onclick: () => selectService(s),
        },
        s.image
          ? el('span', { class: 'service-thumb' }, el('img', { src: s.image, alt: '', width: 700, height: 700 }))
          : el('span', { class: 'card-icon', html: svg(s.icon) }),
        el(
          'span',
          {},
          el('strong', {}, pick(s.name)),
          s.price == null
            ? null
            : el('span', { class: 'service-meta' }, el('span', { class: 'chip chip-accent' }, formatPrice(s.price))),
        ),
        el('span', { class: 'check-mark', 'aria-hidden': 'true' }),
      ),
    ),
  );
  $('to-step-2').disabled = !state.service;
}

function selectService(service) {
  if (state.service?.id !== service.id) {
    state.service = service;
    state.date = null;
    state.time = null;
  }
  renderServices();
  renderSummary();
}

// ---------------------------------------------------------------------------
// Step 2 – calendar & slots
// ---------------------------------------------------------------------------

async function loadMonth() {
  const key = `${state.service.id}|${state.month}`;
  renderCalendar();
  if (!cache.has(key)) {
    state.loading = true;
    renderCalendar();
    try {
      const params = new URLSearchParams({ service: state.service.id, from: `${state.month}-01`, to: lastDay(state.month) });
      const { days } = await api(`/api/availability?${params}`);
      cache.set(key, days);
    } catch {
      setAlert('time-alert', 'error', t('common.error'));
    } finally {
      state.loading = false;
    }
  }
  // Pre-select the first open day of the month for a quicker flow.
  const days = cache.get(key) || {};
  const anyOpen = Object.values(days).some((s) => s.length);
  // Near the end of a month there may be no open days left: start on next month instead.
  if (!anyOpen && !state.autoAdvanced && cache.has(key) && state.month === monthOf(state.config.today) && shiftMonth(state.month, 1) <= monthOf(maxDate())) {
    state.autoAdvanced = true;
    state.month = shiftMonth(state.month, 1);
    return loadMonth();
  }
  if (!state.date || monthOf(state.date) !== state.month || !days[state.date]?.length) {
    const first = Object.keys(days).sort().find((d) => days[d].length);
    if (first) {
      state.date = first;
      state.time = null;
    }
  }
  renderCalendar();
  renderSlots();
  renderSummary();
}

function renderCalendar() {
  const cal = $('calendar');
  const days = cache.get(`${state.service?.id}|${state.month}`) || {};
  const start = utc(state.month);
  const offset = start.getUTCDay(); // weeks start on Sunday (Israeli calendar)
  const count = utc(lastDay(state.month)).getUTCDate();

  $('month-label').textContent = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);
  $('prev-month').disabled = state.month <= monthOf(state.config.today);
  $('next-month').disabled = shiftMonth(state.month, 1) > monthOf(maxDate());
  cal.classList.toggle('is-loading', state.loading);

  const dowFmt = new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' });
  const cells = [];
  for (let i = 0; i < 7; i++) {
    cells.push(el('span', { class: 'dow', 'aria-hidden': 'true' }, dowFmt.format(new Date(Date.UTC(2023, 0, 1 + i)))));
  }
  for (let i = 0; i < offset; i++) cells.push(el('span'));
  for (let d = 1; d <= count; d++) {
    const date = `${state.month}-${String(d).padStart(2, '0')}`;
    const open = (days[date] || []).length > 0;
    cells.push(
      el(
        'button',
        {
          type: 'button',
          class: ['day', open && 'is-available', date === state.config.today && 'is-today'].filter(Boolean).join(' '),
          disabled: !open,
          'aria-pressed': String(date === state.date),
          'aria-label': fmtDate(date),
          onclick: () => {
            state.date = date;
            state.time = null;
            renderCalendar();
            renderSlots();
            renderSummary();
          },
        },
        String(d),
      ),
    );
  }
  cal.replaceChildren(...cells);
}

function renderSlots() {
  const wrap = $('slots');
  const days = cache.get(`${state.service.id}|${state.month}`);
  const anyOpen = days && Object.values(days).some((s) => s.length);

  if (!state.date || monthOf(state.date) !== state.month) {
    $('slots-title').textContent = '';
    wrap.replaceChildren(
      el('p', { class: 'empty-state' }, state.loading ? t('common.loading') : t(days && !anyOpen ? 'book.noSlotsMonth' : 'book.pickDay')),
    );
  } else {
    const slots = days?.[state.date] || [];
    $('slots-title').textContent = t('book.slotsFor', { date: fmtDate(state.date) });
    wrap.replaceChildren(
      slots.length
        ? el(
            'div',
            { class: 'slots' },
            slots.map((time) =>
              el(
                'button',
                {
                  type: 'button',
                  class: 'slot',
                  'aria-pressed': String(time === state.time),
                  onclick: () => {
                    state.time = time;
                    renderSlots();
                    renderSummary();
                  },
                },
                time,
              ),
            ),
          )
        : el('p', { class: 'empty-state' }, t('book.noSlots')),
    );
  }
  $('to-step-3').disabled = !(state.date && state.time);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function renderSummary() {
  const s = state.service;
  const rows = [
    ['book.service', s && pick(s.name)],
    ['book.date', state.date && fmtDate(state.date)],
    ['book.time', state.time],
    s?.price != null && ['book.price', formatPrice(s.price)],
  ].filter(Boolean);
  $('summary').replaceChildren(
    ...rows.flatMap(([label, value]) => [
      el('dt', {}, t(label)),
      el('dd', {}, value ? el('bdi', {}, value) : el('span', { class: 'placeholder' }, t('book.notChosen'))),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Step 3 – details & submit
// ---------------------------------------------------------------------------

function setAlert(id, kind, message) {
  $(id).replaceChildren(message ? el('p', { class: `alert alert-${kind}` }, message) : '');
}

// On a static host (GitHub Pages) there's no server: the request is sent to the
// practitioner on WhatsApp instead, and they confirm the time with the client.
const viaWhatsApp = () => state.config?.handoff === 'whatsapp';

function whatsappMessage(data) {
  const lines = [
    t('book.waIntro', { name: data.name.trim() }),
    `${t('book.service')}: ${pick(state.service.name)}`,
    `${t('book.date')}: ${fmtDate(state.date)}`,
    `${t('book.time')}: ${state.time}`,
  ];
  if (data.notes?.trim()) lines.push(`${t('book.waNotes')}: ${data.notes.trim()}`);
  return lines.join('\n');
}

function handOffToWhatsApp(data) {
  const href = `https://wa.me/${state.config.business.whatsapp}?text=${encodeURIComponent(whatsappMessage(data))}`;
  window.open(href, '_blank', 'noopener');
  const booking = { date: state.date, time: state.time, duration: state.service.duration, name: data.name.trim() };
  showConfirmation(booking, false, href);
}

const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function submit(e) {
  e.preventDefault();
  const form = $('details-form');
  const data = Object.fromEntries(new FormData(form));
  clearFieldErrors(form);
  setAlert('details-alert');

  const bad = [];
  if ((data.name || '').trim().length < 2) bad.push('name');
  if (!viaWhatsApp()) {
    if (!PHONE_RE.test((data.phone || '').trim())) bad.push('phone');
    if (data.email && !EMAIL_RE.test(data.email.trim())) bad.push('email');
  }
  if (!data.consent) bad.push('consent');
  if (bad.length) return showFieldErrors(form, bad);
  if (viaWhatsApp()) return handOffToWhatsApp(data);

  const button = $('confirm-btn');
  button.disabled = true;
  button.textContent = t('book.confirming');
  try {
    const { booking } = await api('/api/bookings', {
      method: 'POST',
      body: {
        serviceId: state.service.id,
        date: state.date,
        time: state.time,
        name: data.name,
        phone: data.phone,
        email: data.email,
        notes: data.notes,
        consent: true,
        lang: getLang(),
      },
    });
    showConfirmation(booking, Boolean(data.email));
  } catch (err) {
    if (err.status === 409 || err.data?.fields?.some((f) => ['date', 'time', 'serviceId'].includes(f))) {
      cache.clear();
      state.time = null;
      goTo(2);
      setAlert('time-alert', 'error', t('book.slotTaken'));
    } else if (err.status === 400) {
      showFieldErrors(form, err.data.fields);
    } else {
      setAlert('details-alert', 'error', t(err.status === 429 ? 'errors.rate' : 'common.error'));
    }
  } finally {
    button.disabled = false;
    button.textContent = t(button.dataset.i18n);
  }
}

let confirmed = null;

function renderConfirmation() {
  if (!confirmed) return;
  const { booking, whatsappHref } = confirmed;
  const title = $('confirm-title');
  title.dataset.i18n = whatsappHref ? 'book.waTitle' : 'book.successTitle';
  title.textContent = t(title.dataset.i18n);
  $('confirm-text').textContent = whatsappHref ? t('book.waText') : t('book.successText', { name: booking.name });
  $('confirm-whatsapp').hidden = !whatsappHref;
  if (whatsappHref) $('confirm-whatsapp').href = whatsappHref;
  const rows = [
    booking.ref && ['book.ref', el('span', { class: 'ref' }, booking.ref)],
    ['book.service', pick(state.service.name)],
    ['book.date', fmtDate(booking.date)],
    ['book.time', el('bdi', {}, booking.time)],
  ].filter(Boolean);
  $('confirm-details').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, t(k)), el('dd', {}, v)]));
}

function showConfirmation(booking, emailed, whatsappHref = null) {
  confirmed = { booking, whatsappHref };
  $('booking-flow').hidden = true;
  document.querySelector('.page-hero').hidden = true;
  $('confirmation').hidden = false;
  $('confirm-email').hidden = !emailed;
  renderConfirmation();
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('confirm-title').focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function renderAll() {
  if (!state.config) return;
  renderServices();
  if (state.service) {
    renderCalendar();
    renderSlots();
  }
  renderSummary();
  renderConfirmation();
}

$('to-step-2').addEventListener('click', () => {
  setAlert('time-alert');
  goTo(2);
});
$('to-step-3').addEventListener('click', () => goTo(3));
for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => goTo(Number(b.dataset.go)));
$('prev-month').addEventListener('click', () => {
  state.month = shiftMonth(state.month, -1);
  loadMonth();
});
$('next-month').addEventListener('click', () => {
  state.month = shiftMonth(state.month, 1);
  loadMonth();
});
$('details-form').addEventListener('submit', submit);
onLangChange(renderAll);

loadConfig()
  .then((config) => {
    state.config = config;
    state.month = monthOf(config.today);
    if (viaWhatsApp()) {
      // The request is sent from the client's own WhatsApp, so the practitioner
      // already sees their number: no phone or email fields.
      $('b-phone').closest('.form-row').hidden = true;
      $('confirm-btn').dataset.i18n = 'book.confirmWhatsapp';
      $('confirm-btn').textContent = t('book.confirmWhatsapp');
    }
    const preset = config.services.find((s) => s.id === new URLSearchParams(location.search).get('service'));
    if (preset) state.service = preset;
    renderAll();
    goTo(preset ? 2 : 1, { focus: false });
  })
  .catch(() => {
    $('service-options').replaceChildren(el('p', { class: 'alert alert-error' }, t('common.error')));
  });
