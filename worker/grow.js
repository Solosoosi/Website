// Payments through Grow (formerly Meshulam).
//
// The client pays on Grow's own secure page, so card details never reach this site. The
// flow, per Grow's API reference (developers.grow.business):
//   1. createPaymentProcess → the address of Grow's payment page for this booking
//   2. the client pays there and comes back to successUrl (or cancelUrl)
//   3. Grow's server tells ours (notifyUrl). That notice isn't signed, so it only says which
//      payment to look at: getPaymentProcessInfo, asked with our own identifiers, says
//      whether it's really paid and how much
//   4. approveTransaction tells Grow the notice was received (otherwise it sends it again)
// Grow's API takes form fields (not JSON), only from a server, and wants no special
// characters in them.

const BASE = {
  sandbox: 'https://sandbox.meshulam.co.il/api/light/server/1.0',
  production: 'https://secure.meshulam.co.il/api/light/server/1.0',
};

export class GrowError extends Error {
  constructor(method, err) {
    super(`Grow ${method}: ${err?.id ?? ''} ${err?.message ?? err ?? ''}`.trim());
    this.id = err?.id;
  }
}

/** Grow's settings from the Worker's secrets, or null while they aren't set. */
export function growSettings(env) {
  const userId = String(env.GROW_USER_ID || '').trim();
  const pageCode = String(env.GROW_PAGE_CODE || '').trim();
  if (!userId || !pageCode) return null;
  // Tests point this at a stand-in; normally it's Grow's sandbox until GROW_ENV says production.
  const base = String(env.GROW_API_BASE || '').trim() || (env.GROW_ENV === 'production' ? BASE.production : BASE.sandbox);
  // Only over HTTPS (plain http only for a test server on this machine).
  if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) return null;
  return { userId, pageCode, apiKey: String(env.GROW_API_KEY || '').trim(), base: base.replace(/\/+$/, '') };
}

/** Letters, digits, spaces and a few name marks only: Grow refuses other characters. */
export function plain(s, max = 120) {
  return String(s ?? '')
    .replace(/'/g, '׳')
    .replace(/"/g, '״')
    .replace(/[^\p{L}\p{M}\p{N} \-׳״.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** An Israeli mobile number as Grow wants it (0501234567), or '' if it isn't one. */
export function israeliMobile(phone) {
  let digits = String(phone ?? '').replace(/\D+/g, '');
  if (digits.startsWith('972')) digits = `0${digits.slice(3)}`;
  return /^05\d{8}$/.test(digits) ? digits : '';
}

/** Grow wants a full name: at least two names. */
export const isFullName = (name) => plain(name).split(' ').filter((w) => w.length >= 2).length >= 2;

async function call(settings, method, fields, fetchImpl) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null && v !== '') body.append(k, String(v));
  if (settings.apiKey) body.append('apiKey', settings.apiKey);
  const res = await fetchImpl(`${settings.base}/${method}`, { method: 'POST', body });
  const text = await res.text();
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    throw new GrowError(method, `HTTP ${res.status}, not JSON`);
  }
  if (!res.ok || Number(answer?.status) !== 1) throw new GrowError(method, answer?.err || `HTTP ${res.status}`);
  return answer.data;
}

/** Opens a payment page at Grow. → { processId, processToken, url } */
export async function createPaymentProcess(settings, p, fetchImpl = fetch) {
  const data = await call(
    settings,
    'createPaymentProcess',
    {
      pageCode: settings.pageCode,
      userId: settings.userId,
      chargeType: 1,
      sum: p.sum,
      description: plain(p.description),
      successUrl: p.successUrl,
      cancelUrl: p.cancelUrl,
      notifyUrl: p.notifyUrl,
      'pageField[fullName]': plain(p.fullName, 80),
      'pageField[phone]': israeliMobile(p.phone),
      'pageField[email]': p.email,
      cField1: p.ref,
    },
    fetchImpl,
  );
  const processId = String(data?.processId ?? '').trim();
  const processToken = String(data?.processToken ?? '').trim();
  const url = String(data?.url ?? '').trim();
  // The client is sent there, so it must be Grow's HTTPS page (http only for a test server on this machine).
  const safe = /^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
  if (!processId || !processToken || !safe) throw new GrowError('createPaymentProcess', 'no payment page in the answer');
  return { processId, processToken, url };
}

/** What Grow itself says about a payment page: its transactions, with their status and sum. */
export function getPaymentProcessInfo(settings, { processId, processToken }, fetchImpl = fetch) {
  return call(settings, 'getPaymentProcessInfo', { pageCode: settings.pageCode, processId, processToken }, fetchImpl);
}

/** The transaction that paid exactly `sum` (statusCode 2 = paid), or null. */
export function paidTransaction(info, sum) {
  const list = Array.isArray(info?.transactions) ? info.transactions : [];
  return (
    list.find((t) => String(t?.statusCode ?? '').trim() === '2' && Number(String(t?.sum ?? '').trim()) === Number(sum)) || null
  );
}

// The fields approveTransaction takes, all from the payment's own details.
const APPROVE_FIELDS = [
  'transactionId', 'transactionToken', 'transactionTypeId', 'paymentType', 'sum', 'firstPaymentSum',
  'periodicalPaymentSum', 'paymentsNum', 'allPaymentsNum', 'paymentDate', 'asmachta', 'description',
  'fullName', 'payerPhone', 'payerEmail', 'cardSuffix', 'cardType', 'cardTypeCode', 'cardBrand',
  'cardBrandCode', 'cardExp',
];

/** Tells Grow that this site received the payment notice. */
export function approveTransaction(settings, { transaction, processId, processToken }, fetchImpl = fetch) {
  const fields = { pageCode: settings.pageCode, processId, processToken };
  for (const k of APPROVE_FIELDS) {
    const v = transaction?.[k];
    if (v != null && typeof v !== 'object') fields[k] = String(v).trim();
  }
  return call(settings, 'approveTransaction', fields, fetchImpl);
}

/**
 * Grow's notice arrives as form fields named like data[processId] or
 * data[customFields][cField1]. → the "data" part as a plain object.
 */
export function readNotice(form) {
  const root = Object.create(null);
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string' || key.length > 100) continue;
    const path = key.replace(/\]/g, '').split('[');
    if (path.some((k) => !k || k === '__proto__' || k === 'constructor' || k === 'prototype')) continue;
    let node = root;
    path.forEach((k, i) => {
      if (i === path.length - 1) node[k] = value.trim();
      else node = node[k] && typeof node[k] === 'object' ? node[k] : (node[k] = Object.create(null));
    });
  }
  return root.data && typeof root.data === 'object' ? root.data : root;
}
