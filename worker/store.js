// The site's data on Cloudflare D1: bookings, blocked days, the opening-hours settings and
// contact messages. The same functions as the Node server's store (server/store.js), made
// async because D1 answers over the network.

import { slotsForDay } from '../server/availability.js';
import { addDays, toMinutes } from '../server/time.js';

export class SlotTakenError extends Error {}

// 32 letters and digits (no 0/O or 1/I), so every random byte maps evenly onto one.
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRef() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

// A booking's start as minutes after midnight, worked out from its "HH:MM" column.
const START_MIN = '(CAST(substr(time, 1, 2) AS INTEGER) * 60 + CAST(substr(time, 4, 2) AS INTEGER))';

export function openD1Store(db, defaultSchedule) {
  async function getSchedule() {
    const value = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('schedule').first('value');
    return { ...defaultSchedule, ...(value ? JSON.parse(value) : {}) };
  }

  async function setSchedule(schedule) {
    await db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind('schedule', JSON.stringify(schedule))
      .run();
  }

  /** { "YYYY-MM-DD": ["09:00", …] } for every day in [from, to]. */
  async function availability({ from, to, duration, now, schedule }) {
    schedule ??= await getSchedule();
    const [bookings, blocked] = await db.batch([
      db.prepare("SELECT date, time, duration FROM bookings WHERE status = 'confirmed' AND date BETWEEN ? AND ?").bind(from, to),
      db.prepare('SELECT date FROM blocked_dates WHERE date BETWEEN ? AND ?').bind(from, to),
    ]);
    const byDate = new Map();
    for (const b of bookings.results) {
      const start = toMinutes(b.time);
      if (!byDate.has(b.date)) byDate.set(b.date, []);
      byDate.get(b.date).push({ start, end: start + b.duration });
    }
    const closed = new Set(blocked.results.map((r) => r.date));

    const days = {};
    for (let d = from; d <= to; d = addDays(d, 1)) {
      days[d] = slotsForDay({ date: d, duration, schedule, dayBookings: byDate.get(d), blocked: closed.has(d), now });
    }
    return days;
  }

  /**
   * Checks the time is free, then adds the booking in one statement that only goes in when no
   * confirmed booking overlaps it (with the break around it), so two people can't take the
   * same time together. Throws SlotTakenError when the time isn't free.
   */
  async function createBooking(b, now) {
    const schedule = await getSchedule();
    const free = (await availability({ from: b.date, to: b.date, duration: b.duration, now, schedule }))[b.date];
    if (!free.includes(b.time)) throw new SlotTakenError('slot not available');

    const insert = db.prepare(`
      INSERT INTO bookings (ref, service_id, date, time, duration, name, phone, email, notes, lang)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
      WHERE NOT EXISTS (
        SELECT 1 FROM bookings
        WHERE status = 'confirmed' AND date = ?3
          AND ?11 < ${START_MIN} + duration + ?12
          AND ${START_MIN} < ?11 + ?5 + ?12
      )
      RETURNING *`);
    for (let attempt = 1; ; attempt++) {
      try {
        const row = await insert
          .bind(
            newRef(), b.serviceId, b.date, b.time, b.duration, b.name, b.phone, b.email || null, b.notes || null, b.lang,
            toMinutes(b.time), schedule.bufferMinutes,
          )
          .first();
        if (!row) throw new SlotTakenError('slot not available');
        return row;
      } catch (err) {
        // The confirmation number is random: on the rare repeat, draw another one.
        if (attempt < 3 && /UNIQUE constraint failed: bookings\.ref/.test(String(err?.message))) continue;
        throw err;
      }
    }
  }

  async function listBookings(scope, today) {
    const sql =
      scope === 'past'
        ? "SELECT * FROM bookings WHERE status = 'confirmed' AND date < ?1 ORDER BY date DESC, time DESC LIMIT 200"
        : scope === 'cancelled'
          ? "SELECT * FROM bookings WHERE status = 'cancelled' ORDER BY date DESC, time DESC LIMIT 200"
          : "SELECT * FROM bookings WHERE status = 'confirmed' AND date >= ?1 ORDER BY date, time";
    const stmt = db.prepare(sql);
    return (await (scope === 'cancelled' ? stmt : stmt.bind(today)).all()).results;
  }

  async function cancelBooking(id) {
    return db
      .prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed' RETURNING *")
      .bind(id)
      .first();
  }

  const changed = (result) => (result.meta?.changes ?? 0) > 0;

  return {
    getSchedule,
    setSchedule,
    availability,
    createBooking,
    listBookings,
    cancelBooking,
    listBlocked: async (today) =>
      (await db.prepare('SELECT date, note FROM blocked_dates WHERE date >= ? ORDER BY date').bind(today).all()).results,
    addBlocked: (date, note) =>
      db
        .prepare('INSERT INTO blocked_dates (date, note) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET note = excluded.note')
        .bind(date, note || null)
        .run(),
    removeBlocked: async (date) => changed(await db.prepare('DELETE FROM blocked_dates WHERE date = ?').bind(date).run()),
    addMessage: (m) =>
      db
        .prepare('INSERT INTO messages (name, phone, email, message) VALUES (?, ?, ?, ?)')
        .bind(m.name, m.phone || null, m.email || null, m.message)
        .run(),
    listMessages: async () =>
      (await db.prepare('SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT 200').all()).results,
    markMessageRead: async (id) => changed(await db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').bind(id).run()),
    deleteMessage: async (id) => changed(await db.prepare('DELETE FROM messages WHERE id = ?').bind(id).run()),
  };
}
