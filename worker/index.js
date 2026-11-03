// The website on Cloudflare: the pages are static files (dist/, built from public/ by
// scripts/build-cloudflare.mjs) that Cloudflare serves by itself, and this Worker answers
// /api/* – the same API as the Node server (server/app.js), with the data in Cloudflare D1.
//
// BOOKING_MODE (wrangler.jsonc → vars):
//   "whatsapp" (the default) – as on the site today: a booking request or a message opens
//              WhatsApp, and nothing is stored. The booking page shows the free times from
//              the opening hours, minus the days closed in the admin panel.
//   "online"   – bookings and messages are taken here and stored in D1.
//
// Setup and deployment: worker/README.md.

import siteConfig from '../config/site.json' with { type: 'json' };
import { addDays, dayIndex, isValidDate, isValidTime, nowInZone } from '../server/time.js';
import { accessSettings, verifyAccess } from './access.js';
import { HttpError, json, readJson } from './http.js';
import { SlotTakenError, openD1Store } from './store.js';

const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ACCESS_LOGOUT = '/cdn-cgi/access/logout';

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

const invalid = (fields) => new HttpError(400, 'invalid', { fields });
const notFound = () => new HttpError(404, 'not_found');

/** True when this visitor has gone over the limit (the limiter is a binding in wrangler.jsonc). */
async function overLimit(limiter, key) {
  if (!limiter) return false;
  try {
    return !(await limiter.limit({ key })).success;
  } catch {
    return false; // a hiccup in the limiter never blocks a real visitor
  }
}

export function createWorker({ config = siteConfig, clock = () => new Date(), fetch: fetchImpl = fetch, log = console } = {}) {
  const tz = config.timezone;
  const services = new Map(config.services.map((s) => [s.id, s]));
  const now = () => nowInZone(tz, clock());

  // Emails aren't connected on Cloudflare yet: they come with the online payments, once the
  // practice's email address and domain are set. Until then nothing is sent, and the log only
  // notes that an email would have gone out, without anyone's details.
  const noMail = (kind) => log.info(`[mail not connected] ${kind} email not sent`);

  async function requireAdmin(request, env) {
    const settings = accessSettings(env);
    const admin = settings && (await verifyAccess(request, settings, { fetch: fetchImpl, now: clock().getTime() }));
    if (!admin) throw new HttpError(401, 'unauthorized');
    return admin;
  }

  async function api(request, env, url) {
    const { method } = request;
    const path = url.pathname;
    const route = `${method} ${path}`;
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const online = env.BOOKING_MODE === 'online';
    const store = openD1Store(env.DB, config.defaultSchedule);

    if (await overLimit(env.API_LIMIT, ip)) throw new HttpError(429, 'too_many_requests', {}, { 'Retry-After': '60' });

    // Anything that changes data must come from this site's own pages, as JSON.
    let body = null;
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) throw new HttpError(403, 'bad_origin');
      body = await readJson(request);
      if (body === null || typeof body !== 'object' || Array.isArray(body)) body = {};
    }

    // ---------- Public API ----------

    if (route === 'GET /api/config') {
      const schedule = await store.getSchedule();
      return json({
        business: config.business,
        services: config.services,
        prices: config.prices,
        currency: config.currency,
        timezone: tz,
        today: now().date,
        maxDaysAhead: schedule.maxDaysAhead,
        hours: schedule.weeklyHours,
        handoff: online ? undefined : 'whatsapp',
      });
    }

    if (route === 'GET /api/availability') {
      const q = url.searchParams;
      const service = services.get(q.get('service'));
      let from = q.get('from');
      let to = q.get('to');
      if (!service || !isValidDate(from) || !isValidDate(to) || from > to) throw invalid(['service', 'from', 'to']);
      const schedule = await store.getSchedule();
      const n = now();
      const last = addDays(n.date, schedule.maxDaysAhead);
      if (from < n.date) from = n.date;
      if (to > last) to = last;
      if (from > to) return json({ days: {} });
      if (dayIndex(to) - dayIndex(from) > 62) throw invalid(['to']);
      return json({ days: await store.availability({ from, to, duration: service.duration, now: n, schedule }) });
    }

    if (route === 'POST /api/bookings') {
      if (!online) throw notFound();
      if (await overLimit(env.FORMS_LIMIT, `${ip} bookings`)) throw new HttpError(429, 'too_many_requests', {}, { 'Retry-After': '60' });
      const b = body;
      const service = services.get(b.serviceId);
      const input = {
        serviceId: b.serviceId,
        date: b.date,
        time: b.time,
        name: str(b.name, 80),
        phone: str(b.phone, 30),
        email: str(b.email, 120),
        notes: str(b.notes, 1000),
        lang: b.lang === 'en' ? 'en' : 'he',
      };
      const bad = [];
      if (!service) bad.push('serviceId');
      if (!isValidDate(input.date)) bad.push('date');
      if (!isValidTime(input.time)) bad.push('time');
      if (input.name.length < 2) bad.push('name');
      if (!PHONE_RE.test(input.phone)) bad.push('phone');
      if (input.email && !EMAIL_RE.test(input.email)) bad.push('email');
      if (b.consent !== true) bad.push('consent');
      if (bad.length) throw invalid(bad);

      let booking;
      try {
        booking = await store.createBooking({ ...input, duration: service.duration }, now());
      } catch (err) {
        if (err instanceof SlotTakenError) throw new HttpError(409, 'slot_taken');
        throw err;
      }

      if (booking.email) noMail('booking confirmation');
      noMail('new booking');

      return json(
        {
          booking: {
            ref: booking.ref,
            serviceId: booking.service_id,
            date: booking.date,
            time: booking.time,
            duration: booking.duration,
            name: booking.name,
          },
        },
        201,
      );
    }

    if (route === 'POST /api/contact') {
      if (!online) throw notFound();
      if (await overLimit(env.FORMS_LIMIT, `${ip} contact`)) throw new HttpError(429, 'too_many_requests', {}, { 'Retry-After': '60' });
      const b = body;
      const msg = { name: str(b.name, 80), phone: str(b.phone, 30), email: str(b.email, 120), message: str(b.message, 2000) };
      const bad = [];
      if (msg.name.length < 2) bad.push('name');
      if (msg.phone && !PHONE_RE.test(msg.phone)) bad.push('phone');
      if (msg.email && !EMAIL_RE.test(msg.email)) bad.push('email');
      if (!msg.phone && !msg.email) bad.push('phone', 'email');
      if (msg.message.length < 2) bad.push('message');
      // Honeypot field: real visitors never fill it in.
      if (b.website) return json({ ok: true }, 201);
      if (bad.length) throw invalid(bad);
      await store.addMessage(msg);
      noMail('new message');
      return json({ ok: true }, 201);
    }

    // ---------- Admin API (behind Cloudflare Access) ----------

    if (route === 'GET /api/admin/session') {
      const settings = accessSettings(env);
      const admin = settings && (await verifyAccess(request, settings, { fetch: fetchImpl, now: clock().getTime() }));
      return json({ enabled: Boolean(settings), loggedIn: Boolean(admin), access: true });
    }

    if (route === 'POST /api/admin/logout') return json({ ok: true, redirect: ACCESS_LOGOUT });

    if (path.startsWith('/api/admin/')) {
      await requireAdmin(request, env);
      const today = now().date;

      if (route === 'GET /api/admin/bookings') {
        return json({ bookings: await store.listBookings(url.searchParams.get('scope'), today) });
      }

      const cancel = /^\/api\/admin\/bookings\/(\d{1,12})\/cancel$/.exec(path);
      if (method === 'POST' && cancel) {
        const booking = await store.cancelBooking(Number(cancel[1]));
        if (!booking) throw notFound();
        return json({ booking });
      }

      if (route === 'GET /api/admin/schedule') {
        return json({ schedule: await store.getSchedule(), blocked: await store.listBlocked(today) });
      }

      if (route === 'PUT /api/admin/schedule') {
        const s = body;
        const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
        const bad = [];
        if (!int(s.slotInterval, 5, 240)) bad.push('slotInterval');
        if (!int(s.bufferMinutes, 0, 240)) bad.push('bufferMinutes');
        if (!int(s.minNoticeHours, 0, 24 * 14)) bad.push('minNoticeHours');
        if (!int(s.maxDaysAhead, 1, 365)) bad.push('maxDaysAhead');

        const weeklyHours = {};
        for (let d = 0; d < 7; d++) {
          const ranges = s.weeklyHours?.[d] ?? s.weeklyHours?.[String(d)] ?? [];
          const ok =
            Array.isArray(ranges) &&
            ranges.length <= 6 &&
            ranges.every((r) => Array.isArray(r) && isValidTime(r[0]) && isValidTime(r[1]) && r[0] < r[1]);
          if (!ok) bad.push(`weeklyHours.${d}`);
          else weeklyHours[d] = [...ranges].sort((a, b) => a[0].localeCompare(b[0]));
        }
        if (bad.length) throw invalid(bad);

        const schedule = {
          weeklyHours,
          slotInterval: s.slotInterval,
          bufferMinutes: s.bufferMinutes,
          minNoticeHours: s.minNoticeHours,
          maxDaysAhead: s.maxDaysAhead,
        };
        await store.setSchedule(schedule);
        return json({ schedule });
      }

      if (route === 'POST /api/admin/blocked') {
        if (!isValidDate(body.date)) throw invalid(['date']);
        await store.addBlocked(body.date, str(body.note, 120));
        return json({ blocked: await store.listBlocked(today) }, 201);
      }

      const unblock = /^\/api\/admin\/blocked\/(\d{4}-\d{2}-\d{2})$/.exec(path);
      if (method === 'DELETE' && unblock) {
        if (!(await store.removeBlocked(unblock[1]))) throw notFound();
        return json({ blocked: await store.listBlocked(today) });
      }

      if (route === 'GET /api/admin/messages') return json({ messages: await store.listMessages() });

      const read = /^\/api\/admin\/messages\/(\d{1,12})\/read$/.exec(path);
      if (method === 'POST' && read) {
        if (!(await store.markMessageRead(Number(read[1])))) throw notFound();
        return json({ ok: true });
      }

      const remove = /^\/api\/admin\/messages\/(\d{1,12})$/.exec(path);
      if (method === 'DELETE' && remove) {
        if (!(await store.deleteMessage(Number(remove[1])))) throw notFound();
        return json({ ok: true });
      }
    }

    throw notFound();
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      try {
        if (url.pathname === '/healthz') return json({ ok: true });
        if (url.pathname.startsWith('/api/')) return await api(request, env, url);
        // Pages and files: Cloudflare serves them without the Worker (wrangler.jsonc →
        // assets.run_worker_first), so this is only a fallback.
        return env.ASSETS.fetch(request);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.code, ...err.more }, err.status, err.headers);
        log.error('API error:', err?.stack || String(err));
        return json({ error: 'server_error' }, 500);
      }
    },
  };
}

export default createWorker();
