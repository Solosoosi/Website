import { api, clearFieldErrors, el, formatPrice, loadConfig, onLangChange, pick, showFieldErrors, t } from './site.js';
import { svg } from './icons.js';

const list = document.getElementById('services-list');
let config = null;

function renderServices() {
  if (!config) return;
  list.replaceChildren(
    ...config.services.map((s) =>
      el(
        'article',
        { class: 'card service-card' },
        el('span', { class: 'card-icon', html: svg(s.icon) }),
        el('h3', {}, pick(s.name)),
        el(
          'div',
          { class: 'service-meta' },
          el('span', { class: 'chip', html: svg('clock') }, t('common.minutes', { n: s.duration })),
          el('span', { class: 'chip chip-accent' }, formatPrice(s.price)),
        ),
        el('p', {}, pick(s.description)),
        el(
          'a',
          { class: 'btn btn-outline btn-sm', href: `/book?service=${encodeURIComponent(s.id)}` },
          t('treatments.book'),
        ),
      ),
    ),
  );
}

loadConfig()
  .then((cfg) => {
    config = cfg;
    renderServices();
  })
  .catch(() => {
    list.replaceChildren(el('p', { class: 'alert alert-error' }, t('common.error')));
  });

onLangChange(renderServices);

// ---------------------------------------------------------------------------
// Contact form
// ---------------------------------------------------------------------------

const form = document.getElementById('contact-form');
const status = document.getElementById('contact-status');

function setStatus(kind, message) {
  status.replaceChildren(message ? el('p', { class: `alert alert-${kind}` }, message) : '');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  clearFieldErrors(form);
  setStatus();

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
    await api('/api/contact', { method: 'POST', body: data });
    form.reset();
    setStatus('success', t('contact.success'));
  } catch (err) {
    if (err.status === 400) showFieldErrors(form, err.data.fields);
    else setStatus('error', t(err.status === 429 ? 'errors.rate' : 'common.error'));
  } finally {
    button.disabled = false;
    button.textContent = t('contact.send');
  }
});
