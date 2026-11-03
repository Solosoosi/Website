import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { SlotTakenError } from './store.js';
import { bookingEmails } from './mailer.js';
import { createAdminAuth, rateLimit, securityHeaders } from './security.js';
import { addDays, dayIndex, isValidDate, isValidTime, nowInZone } from './time.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function badRequest(res, fields) {
  return res.status(400).json({ error: 'invalid', fields });
}

export function createApp({ config, store, mailer, env = {}, clock = () => new Date(), log = console }) {
  const app = express();
  const tz = config.timezone;
  const services = new Map(config.services.map((s) => [s.id, s]));
  const now = () => nowInZone(tz, clock());
  const auth = createAdminAuth({
    password: env.ADMIN_PASSWORD,
    secret: env.SESSION_SECRET,
    secureCookies: env.NODE_ENV === 'production',
  });

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(express.json({ limit: '20kb' }));

  // ---------- Public API ----------

  app.get('/api/config', (req, res) => {
    const schedule = store.getSchedule();
    res.json({
      business: config.business,
      services: config.services,
      prices: config.prices,
      currency: config.currency,
      timezone: tz,
      today: now().date,
      maxDaysAhead: schedule.maxDaysAhead,
      hours: schedule.weeklyHours,
    });
  });

  app.get('/api/availability', (req, res) => {
    const service = services.get(req.query.service);
    let { from, to } = req.query;
    if (!service || !isValidDate(from) || !isValidDate(to) || from > to) {
      return badRequest(res, ['service', 'from', 'to']);
    }
    const n = now();
    const last = addDays(n.date, store.getSchedule().maxDaysAhead);
    if (from < n.date) from = n.date;
    if (to > last) to = last;
    if (from > to) return res.json({ days: {} });
    if (dayIndex(to) - dayIndex(from) > 62) return badRequest(res, ['to']);

    res.json({ days: store.availability({ from, to, duration: service.duration, now: n }) });
  });

  app.post('/api/bookings', rateLimit({ windowMs: 15 * 60_000, max: 10 }), (req, res) => {
    const b = req.body || {};
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
    if (bad.length) return badRequest(res, bad);

    let booking;
    try {
      booking = store.createBooking({ ...input, duration: service.duration }, now());
    } catch (err) {
      if (err instanceof SlotTakenError) return res.status(409).json({ error: 'slot_taken' });
      throw err;
    }

    const mails = bookingEmails({ booking, service, config });
    if (booking.email) mailer.send({ to: booking.email, ...mails.client });
    if (env.NOTIFY_EMAIL) mailer.send({ to: env.NOTIFY_EMAIL, replyTo: booking.email || undefined, ...mails.owner });

    res.status(201).json({
      booking: {
        ref: booking.ref,
        serviceId: booking.service_id,
        date: booking.date,
        time: booking.time,
        duration: booking.duration,
        name: booking.name,
      },
    });
  });

  app.post('/api/contact', rateLimit({ windowMs: 15 * 60_000, max: 5 }), (req, res) => {
    const b = req.body || {};
    const msg = {
      name: str(b.name, 80),
      phone: str(b.phone, 30),
      email: str(b.email, 120),
      message: str(b.message, 2000),
    };
    const bad = [];
    if (msg.name.length < 2) bad.push('name');
    if (msg.phone && !PHONE_RE.test(msg.phone)) bad.push('phone');
    if (msg.email && !EMAIL_RE.test(msg.email)) bad.push('email');
    if (!msg.phone && !msg.email) bad.push('phone', 'email');
    if (msg.message.length < 2) bad.push('message');
    // Honeypot field: real visitors never fill it in.
    if (b.website) return res.status(201).json({ ok: true });
    if (bad.length) return badRequest(res, bad);

    store.addMessage(msg);
    if (env.NOTIFY_EMAIL) {
      mailer.send({
        to: env.NOTIFY_EMAIL,
        replyTo: msg.email || undefined,
        subject: `New message from ${msg.name}`,
        text: `Name: ${msg.name}\nPhone: ${msg.phone || '-'}\nEmail: ${msg.email || '-'}\n\n${msg.message}`,
      });
    }
    res.status(201).json({ ok: true });
  });

  // ---------- Admin API ----------

  const admin = express.Router();

  admin.get('/session', (req, res) => {
    res.json({ enabled: auth.enabled, loggedIn: auth.isValid(req) });
  });

  admin.post('/login', rateLimit({ windowMs: 15 * 60_000, max: 10 }), (req, res) => {
    if (!auth.enabled) return res.status(503).json({ error: 'admin_disabled' });
    if (!auth.checkPassword(req.body?.password ?? '')) return res.status(401).json({ error: 'wrong_password' });
    auth.login(res);
    res.json({ ok: true });
  });

  admin.post('/logout', (req, res) => {
    auth.logout(res);
    res.json({ ok: true });
  });

  admin.use(auth.require);

  admin.get('/bookings', (req, res) => {
    res.json({ bookings: store.listBookings(req.query.scope, now().date) });
  });

  admin.post('/bookings/:id/cancel', (req, res) => {
    const booking = store.cancelBooking(Number(req.params.id));
    if (!booking) return res.status(404).json({ error: 'not_found' });
    res.json({ booking });
  });

  admin.get('/schedule', (req, res) => {
    res.json({ schedule: store.getSchedule(), blocked: store.listBlocked(now().date) });
  });

  admin.put('/schedule', (req, res) => {
    const s = req.body || {};
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
    if (bad.length) return badRequest(res, bad);

    const schedule = {
      weeklyHours,
      slotInterval: s.slotInterval,
      bufferMinutes: s.bufferMinutes,
      minNoticeHours: s.minNoticeHours,
      maxDaysAhead: s.maxDaysAhead,
    };
    store.setSchedule(schedule);
    res.json({ schedule });
  });

  admin.post('/blocked', (req, res) => {
    const { date, note } = req.body || {};
    if (!isValidDate(date)) return badRequest(res, ['date']);
    store.addBlocked(date, str(note, 120));
    res.status(201).json({ blocked: store.listBlocked(now().date) });
  });

  admin.delete('/blocked/:date', (req, res) => {
    if (!store.removeBlocked(req.params.date)) return res.status(404).json({ error: 'not_found' });
    res.json({ blocked: store.listBlocked(now().date) });
  });

  admin.get('/messages', (req, res) => {
    res.json({ messages: store.listMessages() });
  });

  admin.post('/messages/:id/read', (req, res) => {
    if (!store.markMessageRead(Number(req.params.id))) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  admin.delete('/messages/:id', (req, res) => {
    if (!store.deleteMessage(Number(req.params.id))) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  app.use('/api/admin', admin);

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  // ---------- Static site ----------

  app.use(
    express.static(PUBLIC_DIR, {
      extensions: ['html'],
      setHeaders(res, file) {
        if (/\.(css|js|svg|woff2?)$/.test(file)) res.set('Cache-Control', 'public, max-age=3600');
      },
    }),
  );

  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    log.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return app;
}
