import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store.js';

const config = JSON.parse(fs.readFileSync(new URL('../config/site.json', import.meta.url), 'utf8'));
// Fixed clock: Thursday 1 Oct 2026, 08:00 Israel time.
const clock = () => new Date('2026-10-01T05:00:00Z');
const sent = [];
const silent = { info() {}, error() {}, warn() {} };

let server, base, store;

before(async () => {
  store = openStore(':memory:', config.defaultSchedule);
  const mailer = { enabled: true, send: (m) => sent.push(m) };
  const app = createApp({
    config, store, mailer, clock, log: silent,
    env: { ADMIN_PASSWORD: 'secret', SESSION_SECRET: 'x', NOTIFY_EMAIL: 'owner@example.com' },
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  store.close();
});

const json = (path, opts = {}) =>
  fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && JSON.stringify(opts.body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers }));

const booking = {
  serviceId: 'dry-needling', date: '2026-10-04', time: '12:30',
  name: 'Dana Levi', phone: '050-1234567', email: 'dana@example.com', consent: true, lang: 'he',
};

test('config exposes services and today in Israel time', async () => {
  const { status, body } = await json('/api/config');
  assert.equal(status, 200);
  assert.equal(body.today, '2026-10-01');
  assert.ok(body.services.length > 0);
});

test('availability lists slots per day', async () => {
  const { body } = await json('/api/availability?service=dry-needling&from=2026-10-04&to=2026-10-05');
  assert.equal(body.days['2026-10-04'][0], '12:30');
  assert.ok(body.days['2026-10-05'].length > 0);
});

test('booking a slot works once, then the slot is taken', async () => {
  const first = await json('/api/bookings', { method: 'POST', body: booking });
  assert.equal(first.status, 201);
  assert.match(first.body.booking.ref, /^[A-Z2-9]{6}$/);
  assert.equal(sent.length, 2);
  assert.match(sent[0].subject, /אישור פגישה/);

  const again = await json('/api/bookings', { method: 'POST', body: booking });
  assert.equal(again.status, 409);

  const { body } = await json('/api/availability?service=dry-needling&from=2026-10-04&to=2026-10-04');
  assert.ok(!body.days['2026-10-04'].includes('12:30'));
  assert.ok(!body.days['2026-10-04'].includes('13:30')); // 13:30 is inside the 15-min buffer
  assert.ok(body.days['2026-10-04'].includes('14:00'));
});

test('invalid bookings are rejected with field names', async () => {
  const { status, body } = await json('/api/bookings', {
    method: 'POST',
    body: { ...booking, time: '13:00', phone: 'abc', consent: false },
  });
  assert.equal(status, 400);
  assert.deepEqual(body.fields.sort(), ['consent', 'phone']);
});

test('contact form stores a message', async () => {
  const { status } = await json('/api/contact', { method: 'POST', body: { name: 'Avi', phone: '0521234567', message: 'Hello!' } });
  assert.equal(status, 201);
});

test('admin endpoints require login', async () => {
  assert.equal((await json('/api/admin/bookings')).status, 401);
  assert.equal((await json('/api/admin/login', { method: 'POST', body: { password: 'nope' } })).status, 401);

  const login = await json('/api/admin/login', { method: 'POST', body: { password: 'secret' } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const authed = (path, opts = {}) => json(path, { ...opts, headers: { cookie } });

  const { body } = await authed('/api/admin/bookings?scope=upcoming');
  assert.equal(body.bookings.length, 1);
  assert.equal((await authed('/api/admin/messages')).body.messages.length, 1);

  // Block a day, then it has no availability.
  await authed('/api/admin/blocked', { method: 'POST', body: { date: '2026-10-05', note: 'Holiday' } });
  const av = await json('/api/availability?service=dry-needling&from=2026-10-05&to=2026-10-05');
  assert.deepEqual(av.body.days['2026-10-05'], []);

  // Cancelling frees the slot again.
  const cancel = await authed(`/api/admin/bookings/${body.bookings[0].id}/cancel`, { method: 'POST', body: {} });
  assert.equal(cancel.status, 200);
  const rebook = await json('/api/bookings', { method: 'POST', body: booking });
  assert.equal(rebook.status, 201);

  // Schedule validation.
  const badSchedule = await authed('/api/admin/schedule', { method: 'PUT', body: { weeklyHours: { 0: [['12:00', '09:00']] }, slotInterval: 30, bufferMinutes: 0, minNoticeHours: 0, maxDaysAhead: 30 } });
  assert.equal(badSchedule.status, 400);
});

test('static pages and security headers', async () => {
  const res = await fetch(`${base}/book`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});
