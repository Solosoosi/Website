// Payment at booking (BOOKING_MODE "pay"), against a stand-in for Grow's API that behaves
// like Grow's reference describes it: form fields in, { status, err, data } JSON out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorker } from '../worker/index.js';
import { readNotice } from '../worker/grow.js';
import { fakeD1 } from './support/fake-d1.js';

const config = JSON.parse(fs.readFileSync(new URL('../config/site.json', import.meta.url), 'utf8'));
const silent = { info() {}, error() {}, warn() {} };
const GROW = 'https://grow.test/api/light/server/1.0';
const SITE = 'https://clinic.example';

function fakeGrow() {
  const calls = [];
  const pages = new Map();
  const state = { failCreate: false };
  let next = 734750;
  async function fetchImpl(url, init = {}) {
    const u = String(url);
    if (!u.startsWith(`${GROW}/`)) return new Response('not found', { status: 404 });
    const method = u.slice(GROW.length + 1);
    const fields = Object.fromEntries(await new Request(u, init).formData());
    calls.push({ method, fields });
    const fail = (id, message) => Response.json({ status: 0, err: { id, message }, data: '' });
    if (method === 'createPaymentProcess') {
      if (state.failCreate) return fail(54, 'חסרים שדות חובה: pageCode');
      const processId = String(next++);
      pages.set(processId, { processToken: `pt${processId}`, sum: Number(fields.sum), paid: null });
      return Response.json({ status: 1, err: '', data: { processId, processToken: `pt${processId}`, url: `https://sandbox.grow.test/far?l=${processId}` } });
    }
    if (method === 'getPaymentProcessInfo') {
      const page = pages.get(fields.processId);
      if (!page || page.processToken !== fields.processToken) return fail(716, 'פרמטר קוד עסקה או תוקן אינו תקין');
      const transactions = page.paid
        ? [{
            asmachta: '0289199', cardSuffix: '1177', cardType: 'Local', cardTypeCode: '1', cardBrand: 'Mastercard',
            cardBrandCode: '2', cardExp: '0128', firstPaymentSum: '0', periodicalPaymentSum: '0', status: 'שולם',
            statusCode: '2', transactionTypeId: '1', paymentType: '2', sum: String(page.paid), paymentsNum: '0',
            allPaymentsNum: '1', paymentDate: '1/10/26', description: 'דיקור מערבי יבש', fullName: 'Dana Levi',
            payerPhone: '0501234567', payerEmail: 'dana@example.com', transactionId: `t${fields.processId}`,
            transactionToken: `tt${fields.processId}`,
          }]
        : [];
      return Response.json({ status: 1, err: '', data: { processId: fields.processId, processToken: fields.processToken, transactions } });
    }
    if (method === 'approveTransaction') return Response.json({ status: 1, err: '', data: {} });
    return fail(1, 'unknown method');
  }
  return { fetchImpl, calls, pages, state, pay: (id, sum) => (pages.get(id).paid = sum) };
}

function setup(vars = {}) {
  const grow = fakeGrow();
  const time = { now: Date.parse('2026-10-01T05:00:00Z') }; // Thursday 08:00 in Israel
  const env = {
    DB: fakeD1(),
    BOOKING_MODE: 'pay',
    GROW_USER_ID: 'user-1',
    GROW_PAGE_CODE: 'page-1',
    GROW_API_BASE: GROW,
    ...vars,
  };
  const worker = createWorker({ config, clock: () => new Date(time.now), fetch: grow.fetchImpl, log: silent });
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await worker.fetch(
      new Request(`${SITE}${path}`, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  // Grow's server notice: form fields named data[…], as Grow sends them.
  const notify = async (fields) => {
    const form = new FormData();
    form.append('err', '');
    form.append('status', '1');
    for (const [k, v] of Object.entries(fields)) form.append(`data[${k}]`, v);
    const res = await worker.fetch(new Request(`${SITE}/api/payments/grow/notify`, { method: 'POST', body: form }), env);
    return res.status;
  };
  const free = async (date = '2026-10-04') =>
    (await call(`/api/availability?service=dry-needling&from=${date}&to=${date}`)).body.days[date];
  return { env, grow, time, worker, call, notify, free };
}

const booking = {
  serviceId: 'dry-needling', date: '2026-10-04', time: '12:30',
  name: 'Dana Levi', phone: '050-123 4567', email: 'dana@example.com', consent: true, lang: 'he',
};
const book = (call, b = booking) => call('/api/bookings', { method: 'POST', body: b });

test('pay mode: the site says payments are on; messages still go to WhatsApp', async () => {
  const { call } = setup();
  const { body } = await call('/api/config');
  assert.equal(body.payments, true);
  assert.equal(body.handoff, 'whatsapp');
  assert.equal((await call('/api/contact', { method: 'POST', body: { name: 'Avi', phone: '0521234567', message: 'Hi' } })).status, 404);
});

test('without Grow settings nothing is booked unpaid', async () => {
  const { call } = setup({ GROW_PAGE_CODE: '' });
  assert.equal((await book(call)).status, 503);
});

test('paying needs a full name and an Israeli mobile number', async () => {
  const { call } = setup();
  const r = await book(call, { ...booking, name: 'Dana', phone: '03-1234567' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.fields.sort(), ['name', 'phone']);
  assert.equal((await book(call, { ...booking, phone: '+972 50-123-4567' })).status, 201);
});

test("booking holds the time and opens Grow's page for exactly this booking", async () => {
  const { call, grow, free } = setup();
  const r = await book(call);
  assert.equal(r.status, 201);
  assert.match(r.body.payUrl, /^https:\/\/sandbox\.grow\.test\//);
  assert.match(r.body.token, /^[0-9a-f]{32}$/);
  assert.equal(r.body.booking.price, 350);

  const [created] = grow.calls;
  assert.equal(created.method, 'createPaymentProcess');
  assert.equal(created.fields.pageCode, 'page-1');
  assert.equal(created.fields.userId, 'user-1');
  assert.equal(created.fields.sum, '350');
  assert.equal(created.fields['pageField[fullName]'], 'Dana Levi');
  assert.equal(created.fields['pageField[phone]'], '0501234567');
  assert.equal(created.fields.cField1, r.body.booking.ref);
  assert.equal(created.fields.successUrl, `${SITE}/book?paid=${r.body.booking.ref}`);
  assert.equal(created.fields.cancelUrl, `${SITE}/book?cancelled=${r.body.booking.ref}`);
  assert.equal(created.fields.notifyUrl, `${SITE}/api/payments/grow/notify`);
  assert.equal(created.fields.description, 'דיקור מערבי יבש');

  // Held: nobody else can take it while she pays.
  assert.ok(!(await free()).includes('12:30'));
  assert.equal((await book(call, { ...booking, name: 'Other Person' })).status, 409);
  assert.equal((await call(`/api/bookings/status?ref=${r.body.booking.ref}`)).body.status, 'pending');
});

test('only a payment Grow itself confirms, for the full price, confirms the booking', async () => {
  const { call, grow, notify } = setup();
  const { body } = await book(call);
  const ref = body.booking.ref;
  const [processId] = [...grow.pages.keys()];
  const status = async () => (await call(`/api/bookings/status?ref=${ref}`)).body.status;

  // A made-up notice, or one with the wrong token: ignored without asking Grow.
  assert.equal(await notify({ processId, processToken: 'guess', statusCode: '2', sum: '350' }), 200);
  assert.equal(await notify({ processId: '999', processToken: 'x', statusCode: '2', sum: '350' }), 200);
  assert.equal(grow.calls.filter((c) => c.method === 'getPaymentProcessInfo').length, 0);
  // The notice says "paid", but Grow doesn't: still waiting.
  assert.equal(await notify({ processId, processToken: `pt${processId}`, statusCode: '2', sum: '350' }), 200);
  assert.equal(await status(), 'pending');
  // Paid, but not the full price: still waiting.
  grow.pay(processId, 35);
  await notify({ processId, processToken: `pt${processId}` });
  assert.equal(await status(), 'pending');
  // Paid in full: confirmed, and Grow is told the notice arrived.
  grow.pay(processId, 350);
  await notify({ processId, processToken: `pt${processId}` });
  assert.equal(await status(), 'confirmed');
  const approvals = grow.calls.filter((c) => c.method === 'approveTransaction');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].fields.transactionId, `t${processId}`);
  assert.equal(approvals[0].fields.transactionToken, `tt${processId}`);
  assert.equal(approvals[0].fields.processToken, `pt${processId}`);
  assert.equal(approvals[0].fields.sum, '350');
  // Grow repeats its notice until it hears back: handled once.
  await notify({ processId, processToken: `pt${processId}` });
  assert.equal(grow.calls.filter((c) => c.method === 'approveTransaction').length, 1);
});

test("cancelling on Grow's page frees the time, and only that browser can do it", async () => {
  const { call, free } = setup();
  const { body } = await book(call);
  const release = (token) => call('/api/bookings/release', { method: 'POST', body: { ref: body.booking.ref, token } });
  assert.equal((await release('0'.repeat(32))).body.released, false);
  assert.ok(!(await free()).includes('12:30'));
  assert.equal((await release(body.token)).body.released, true);
  assert.ok((await free()).includes('12:30'));
  assert.equal((await call(`/api/bookings/status?ref=${body.booking.ref}`)).body.status, 'expired');
});

test("a hold lasts 20 minutes; a late payment still counts if the time is free, else it's flagged for a refund", async () => {
  const { call, grow, notify, time, free, env } = setup();
  const first = await book(call);
  const [p1] = [...grow.pages.keys()];
  time.now += 21 * 60_000;
  assert.ok((await free()).includes('12:30'), 'the time is free again');
  grow.pay(p1, 350);
  await notify({ processId: p1, processToken: `pt${p1}` });
  assert.equal((await call(`/api/bookings/status?ref=${first.body.booking.ref}`)).body.status, 'confirmed');

  // The same, but someone else booked the time first.
  const late = await book(call, { ...booking, time: '15:00' });
  const p2 = [...grow.pages.keys()][1];
  time.now += 21 * 60_000;
  const other = await book(call, { ...booking, time: '15:00', name: 'Noa Bar' });
  assert.equal(other.status, 201);
  grow.pay(p2, 350);
  await notify({ processId: p2, processToken: `pt${p2}` });
  assert.equal((await call(`/api/bookings/status?ref=${late.body.booking.ref}`)).body.status, 'pending');
  const row = env.DB.raw.prepare('SELECT status, asmachta FROM payments WHERE process_id = ?').get(p2);
  assert.deepEqual({ ...row }, { status: 'conflict', asmachta: '0289199' });
});

test("the scheduled check confirms payments Grow didn't report, and marks old holds", async () => {
  const { call, grow, worker, env, time } = setup();
  const paid = await book(call);
  const abandoned = await book(call, { ...booking, time: '15:00' });
  grow.pay([...grow.pages.keys()][0], 350);
  time.now += 25 * 60_000;
  await worker.scheduled({}, env);
  assert.equal((await call(`/api/bookings/status?ref=${paid.body.booking.ref}`)).body.status, 'confirmed');
  assert.equal((await call(`/api/bookings/status?ref=${abandoned.body.booking.ref}`)).body.status, 'expired');
  assert.equal(grow.calls.filter((c) => c.method === 'approveTransaction').length, 1);
});

test("if Grow can't open a payment page, the time is freed at once", async () => {
  const { call, grow, free } = setup();
  grow.state.failCreate = true;
  const r = await book(call);
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'payment_unavailable');
  assert.ok((await free()).includes('12:30'));
});

test("Grow's notice is read from its form fields, safely", () => {
  const form = new FormData();
  form.append('status', '1');
  form.append('data[processId]', ' 512895');
  form.append('data[customFields][cField1]', 'ABC123');
  form.append('data[__proto__][polluted]', 'yes');
  form.append('data[constructor][prototype][polluted]', 'yes');
  const notice = readNotice(form);
  assert.equal(notice.processId, '512895');
  assert.equal(notice.customFields.cField1, 'ABC123');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  const plain = new URLSearchParams('data%5BprocessId%5D=77&data%5BprocessToken%5D=pt77');
  assert.equal(readNotice(plain).processToken, 'pt77');
});
