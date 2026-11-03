import { api, el, loadConfig, locale, onLangChange, pick, t, toast } from './site.js';
import { svg } from './icons.js';

const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  tab: 'bookings',
  scope: 'upcoming',
  bookings: [],
  schedule: null,
  blocked: [],
  messages: [],
  // On Cloudflare the panel sits behind Cloudflare Access, which asks for a one-time code
  // sent by email before this page loads: no password form, and logging out ends that session.
  access: false,
  enabled: false,
};

function fmtDate(dateStr, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** SQLite timestamps are UTC ("YYYY-MM-DD HH:MM:SS"); show them in the practice's time zone. */
function fmtStamp(stamp) {
  const at = new Date(`${stamp.replace(' ', 'T')}Z`);
  const timeZone = state.config?.timezone;
  return {
    time: new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(at),
    date: new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(at),
  };
}

function dayName(i) {
  return new Intl.DateTimeFormat(locale(), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + i)));
}

function alertIn(id, kind, message) {
  $(id).replaceChildren(message ? el('p', { class: `alert alert-${kind}` }, message) : '');
}

async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 401) return showLogin();
    toast(t('common.error'));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function showLogin() {
  $('dashboard').hidden = true;
  $('login-view').hidden = false;
  if (state.access) {
    // Signed in to Access with an email that isn't allowed in, or the sign-in has expired.
    const notice = $('admin-disabled');
    notice.dataset.i18n = state.enabled ? 'admin.noAccess' : 'admin.accessOff';
    notice.textContent = t(notice.dataset.i18n);
    notice.hidden = false;
    $('login-form').hidden = true;
    $('access-logout').hidden = !state.enabled;
    return;
  }
  $('password').focus();
}

async function showDashboard() {
  $('login-view').hidden = true;
  $('dashboard').hidden = false;
  await Promise.all([loadBookings(), loadSchedule(), loadMessages()]);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  alertIn('login-alert');
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('password').value } });
    $('password').value = '';
    showDashboard();
  } catch (err) {
    const key = err.status === 401 ? 'admin.wrongPassword' : err.status === 429 ? 'errors.rate' : err.status === 503 ? 'admin.disabled' : 'common.error';
    alertIn('login-alert', 'error', t(key));
  }
});

$('logout').addEventListener('click', async () => {
  const res = await api('/api/admin/logout', { method: 'POST', body: {} }).catch(() => ({}));
  if (res.redirect) return location.assign(res.redirect);
  showLogin();
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => {
    state.tab = tab.dataset.tab;
    for (const t2 of document.querySelectorAll('[data-tab]')) {
      const on = t2 === tab;
      t2.setAttribute('aria-selected', String(on));
      $(`panel-${t2.dataset.tab}`).hidden = !on;
    }
  });
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

for (const b of document.querySelectorAll('[data-scope]')) {
  b.addEventListener('click', () => {
    state.scope = b.dataset.scope;
    for (const o of document.querySelectorAll('[data-scope]')) o.setAttribute('aria-pressed', String(o === b));
    loadBookings();
  });
}

async function loadBookings() {
  const { bookings } = await guarded(() => api(`/api/admin/bookings?scope=${state.scope}`));
  state.bookings = bookings;
  renderBookings();
}

function serviceName(id) {
  const s = state.config?.services.find((x) => x.id === id);
  return s ? pick(s.name) : id;
}

function renderBookings() {
  const list = $('bookings-list');
  if (!state.bookings.length) {
    list.replaceChildren(el('p', { class: 'empty-state' }, t('admin.noBookings')));
    return;
  }
  list.replaceChildren(
    ...state.bookings.map((b) =>
      el(
        'article',
        { class: 'item' },
        el('div', { class: 'item-when' }, el('strong', {}, b.time), el('small', {}, fmtDate(b.date))),
        el(
          'div',
          { class: 'item-body' },
          el('h3', {}, b.name),
          el('p', {}, `${serviceName(b.service_id)} · ${t('common.minutes', { n: b.duration })} · `, el('span', { class: 'ref' }, b.ref)),
          el(
            'p',
            {},
            el('a', { href: `tel:${b.phone.replace(/[^\d+]/g, '')}` }, el('bdi', {}, b.phone)),
            b.email ? ' · ' : '',
            b.email ? el('a', { href: `mailto:${b.email}` }, el('bdi', {}, b.email)) : '',
          ),
          b.notes ? el('p', { class: 'item-notes' }, b.notes) : '',
        ),
        el(
          'div',
          { class: 'item-actions' },
          b.status === 'confirmed' && state.scope === 'upcoming'
            ? el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => cancelBooking(b) }, t('admin.cancel'))
            : '',
        ),
      ),
    ),
  );
}

async function cancelBooking(b) {
  if (!confirm(t('admin.cancelConfirm', { name: b.name }))) return;
  await guarded(() => api(`/api/admin/bookings/${b.id}/cancel`, { method: 'POST', body: {} }));
  toast(t('admin.cancelledToast'));
  loadBookings();
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

async function loadSchedule() {
  const data = await guarded(() => api('/api/admin/schedule'));
  state.schedule = structuredClone(data.schedule);
  state.blocked = data.blocked;
  const form = $('schedule-form');
  form.elements.slotInterval.value = state.schedule.slotInterval;
  form.elements.bufferMinutes.value = state.schedule.bufferMinutes;
  form.elements.minNoticeHours.value = state.schedule.minNoticeHours;
  form.elements.maxDaysAhead.value = state.schedule.maxDaysAhead;
  renderHours();
  renderBlocked();
}

function renderHours() {
  const hours = state.schedule.weeklyHours;
  $('hours').replaceChildren(
    ...Array.from({ length: 7 }, (_, day) => {
      const ranges = (hours[day] ??= []);
      return el(
        'div',
        { class: 'hours-row' },
        el('strong', {}, dayName(day)),
        el(
          'div',
          { class: 'ranges' },
          ranges.length ? '' : el('span', { class: 'closed' }, t('admin.closed')),
          ranges.map((range, i) =>
            el(
              'div',
              { class: 'range' },
              el('input', { class: 'input', type: 'time', value: range[0], required: true, 'aria-label': `${dayName(day)} – start`, onchange: (e) => (range[0] = e.target.value) }),
              '–',
              el('input', { class: 'input', type: 'time', value: range[1], required: true, 'aria-label': `${dayName(day)} – end`, onchange: (e) => (range[1] = e.target.value) }),
              el('button', {
                type: 'button',
                class: 'icon-btn',
                'aria-label': t('admin.removeRange'),
                title: t('admin.removeRange'),
                html: svg('close'),
                onclick: () => {
                  ranges.splice(i, 1);
                  renderHours();
                },
              }),
            ),
          ),
          el(
            'button',
            {
              type: 'button',
              class: 'btn btn-ghost btn-sm',
              html: svg('plus'),
              onclick: () => {
                const last = ranges.at(-1);
                ranges.push(last ? [last[1] < '20:00' ? last[1] : '16:00', '20:00'] : ['09:00', '14:00']);
                renderHours();
              },
            },
            t('admin.addRange'),
          ),
        ),
      );
    }),
  );
}

$('schedule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  alertIn('schedule-alert');
  const f = e.target.elements;
  const body = {
    weeklyHours: state.schedule.weeklyHours,
    slotInterval: Number(f.slotInterval.value),
    bufferMinutes: Number(f.bufferMinutes.value),
    minNoticeHours: Number(f.minNoticeHours.value),
    maxDaysAhead: Number(f.maxDaysAhead.value),
  };
  try {
    const { schedule } = await api('/api/admin/schedule', { method: 'PUT', body });
    state.schedule = structuredClone(schedule);
    renderHours();
    toast(t('admin.saved'));
  } catch (err) {
    if (err.status === 401) return showLogin();
    alertIn('schedule-alert', 'error', t(err.status === 400 ? 'admin.invalid' : 'common.error'));
  }
});

function renderBlocked() {
  const list = $('blocked-list');
  if (!state.blocked.length) {
    list.replaceChildren(el('p', { class: 'empty-state' }, t('admin.noBlocked')));
    return;
  }
  list.replaceChildren(
    ...state.blocked.map((b) =>
      el(
        'div',
        { class: 'item' },
        el('div', { class: 'item-when' }, el('small', {}, fmtDate(b.date, { weekday: 'long' })), el('strong', {}, fmtDate(b.date, { day: 'numeric', month: 'short' }))),
        el('div', { class: 'item-body' }, el('p', {}, b.note || '')),
        el(
          'div',
          { class: 'item-actions' },
          el('button', {
            type: 'button',
            class: 'btn btn-danger btn-sm',
            onclick: async () => {
              const data = await guarded(() => api(`/api/admin/blocked/${b.date}`, { method: 'DELETE', body: {} }));
              state.blocked = data.blocked;
              renderBlocked();
            },
          }, t('admin.remove')),
        ),
      ),
    ),
  );
}

$('block-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  if (!f.date.value) return f.date.focus();
  const data = await guarded(() => api('/api/admin/blocked', { method: 'POST', body: { date: f.date.value, note: f.note.value } }));
  state.blocked = data.blocked;
  e.target.reset();
  renderBlocked();
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

async function loadMessages() {
  const { messages } = await guarded(() => api('/api/admin/messages'));
  state.messages = messages;
  renderMessages();
}

function renderMessages() {
  const unread = state.messages.filter((m) => !m.is_read).length;
  $('unread-badge').hidden = !unread;
  $('unread-badge').textContent = String(unread);

  const list = $('messages-list');
  if (!state.messages.length) {
    list.replaceChildren(el('p', { class: 'empty-state' }, t('admin.noMessages')));
    return;
  }
  list.replaceChildren(
    ...state.messages.map((m) => {
      const { date, time } = fmtStamp(m.created_at);
      return el(
        'article',
        { class: `item${m.is_read ? '' : ' is-unread'}` },
        el('div', { class: 'item-when' }, el('strong', {}, time), el('small', {}, date)),
        el(
          'div',
          { class: 'item-body' },
          el('h3', {}, m.name),
          el(
            'p',
            {},
            m.phone ? el('a', { href: `tel:${m.phone.replace(/[^\d+]/g, '')}` }, el('bdi', {}, m.phone)) : '',
            m.phone && m.email ? ' · ' : '',
            m.email ? el('a', { href: `mailto:${m.email}` }, el('bdi', {}, m.email)) : '',
          ),
          el('p', { class: 'item-notes' }, m.message),
        ),
        el(
          'div',
          { class: 'item-actions' },
          m.is_read
            ? ''
            : el('button', {
                type: 'button',
                class: 'btn btn-outline btn-sm',
                onclick: async () => {
                  await guarded(() => api(`/api/admin/messages/${m.id}/read`, { method: 'POST', body: {} }));
                  m.is_read = 1;
                  renderMessages();
                },
              }, t('admin.markRead')),
          el('button', {
            type: 'button',
            class: 'btn btn-danger btn-sm',
            onclick: async () => {
              if (!confirm(t('admin.deleteConfirm'))) return;
              await guarded(() => api(`/api/admin/messages/${m.id}`, { method: 'DELETE', body: {} }));
              state.messages = state.messages.filter((x) => x !== m);
              renderMessages();
            },
          }, t('admin.delete')),
        ),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

onLangChange(() => {
  if ($('dashboard').hidden) return;
  renderBookings();
  if (state.schedule) renderHours();
  renderBlocked();
  renderMessages();
});

Promise.all([loadConfig().catch(() => null), api('/api/admin/session')])
  .then(([cfg, { enabled, loggedIn, access }]) => {
    state.config = cfg;
    state.access = Boolean(access);
    state.enabled = Boolean(enabled);
    $('admin-disabled').hidden = enabled;
    $('login-form').hidden = !enabled;
    return loggedIn ? showDashboard() : showLogin();
  })
  .catch(() => showLogin());
