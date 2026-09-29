import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { slotsForDay } from './availability.js';
import { addDays, toMinutes } from './time.js';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS bookings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ref         TEXT NOT NULL UNIQUE,
    service_id  TEXT NOT NULL,
    date        TEXT NOT NULL,
    time        TEXT NOT NULL,
    duration    INTEGER NOT NULL,
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    email       TEXT,
    notes       TEXT,
    lang        TEXT NOT NULL DEFAULT 'he',
    status      TEXT NOT NULL DEFAULT 'confirmed',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings (date, status);
  CREATE TABLE IF NOT EXISTS blocked_dates (
    date TEXT PRIMARY KEY,
    note TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    phone      TEXT,
    email      TEXT,
    message    TEXT NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export class SlotTakenError extends Error {}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRef() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

export function openStore(file, defaultSchedule) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  const q = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    putSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ),
    bookingsBetween: db.prepare(
      "SELECT date, time, duration FROM bookings WHERE status = 'confirmed' AND date BETWEEN ? AND ?",
    ),
    blockedBetween: db.prepare('SELECT date FROM blocked_dates WHERE date BETWEEN ? AND ?'),
    insertBooking: db.prepare(`
      INSERT INTO bookings (ref, service_id, date, time, duration, name, phone, email, notes, lang)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    bookingById: db.prepare('SELECT * FROM bookings WHERE id = ?'),
    cancelBooking: db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'"),
    upcoming: db.prepare(
      "SELECT * FROM bookings WHERE status = 'confirmed' AND date >= ? ORDER BY date, time",
    ),
    past: db.prepare(
      "SELECT * FROM bookings WHERE status = 'confirmed' AND date < ? ORDER BY date DESC, time DESC LIMIT 200",
    ),
    cancelled: db.prepare(
      "SELECT * FROM bookings WHERE status = 'cancelled' ORDER BY date DESC, time DESC LIMIT 200",
    ),
    listBlocked: db.prepare('SELECT date, note FROM blocked_dates WHERE date >= ? ORDER BY date'),
    addBlocked: db.prepare(
      'INSERT INTO blocked_dates (date, note) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET note = excluded.note',
    ),
    removeBlocked: db.prepare('DELETE FROM blocked_dates WHERE date = ?'),
    addMessage: db.prepare('INSERT INTO messages (name, phone, email, message) VALUES (?, ?, ?, ?)'),
    listMessages: db.prepare('SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT 200'),
    markRead: db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?'),
    deleteMessage: db.prepare('DELETE FROM messages WHERE id = ?'),
  };

  const plain = (row) => (row ? { ...row } : row);
  const plainAll = (rows) => rows.map(plain);

  function getSchedule() {
    const row = q.getSetting.get('schedule');
    const stored = row ? JSON.parse(row.value) : {};
    return { ...defaultSchedule, ...stored };
  }

  function setSchedule(schedule) {
    q.putSetting.run('schedule', JSON.stringify(schedule));
  }

  /** { "YYYY-MM-DD": ["09:00", …] } for every day in [from, to]. */
  function availability({ from, to, duration, now }) {
    const schedule = getSchedule();
    const byDate = new Map();
    for (const b of q.bookingsBetween.all(from, to)) {
      const start = toMinutes(b.time);
      if (!byDate.has(b.date)) byDate.set(b.date, []);
      byDate.get(b.date).push({ start, end: start + b.duration });
    }
    const blocked = new Set(q.blockedBetween.all(from, to).map((r) => r.date));

    const days = {};
    for (let d = from; d <= to; d = addDays(d, 1)) {
      days[d] = slotsForDay({
        date: d,
        duration,
        schedule,
        dayBookings: byDate.get(d),
        blocked: blocked.has(d),
        now,
      });
    }
    return days;
  }

  /** Re-checks the slot and inserts atomically; throws SlotTakenError on conflict. */
  function createBooking(b, now) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const free = availability({ from: b.date, to: b.date, duration: b.duration, now })[b.date];
      if (!free.includes(b.time)) throw new SlotTakenError('slot not available');
      const ref = newRef();
      const { lastInsertRowid } = q.insertBooking.run(
        ref, b.serviceId, b.date, b.time, b.duration, b.name, b.phone, b.email || null, b.notes || null, b.lang,
      );
      db.exec('COMMIT');
      return plain(q.bookingById.get(lastInsertRowid));
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function listBookings(scope, today) {
    if (scope === 'past') return plainAll(q.past.all(today));
    if (scope === 'cancelled') return plainAll(q.cancelled.all());
    return plainAll(q.upcoming.all(today));
  }

  function cancelBooking(id) {
    const { changes } = q.cancelBooking.run(id);
    return changes > 0 ? plain(q.bookingById.get(id)) : null;
  }

  return {
    db,
    getSchedule,
    setSchedule,
    availability,
    createBooking,
    listBookings,
    cancelBooking,
    listBlocked: (today) => plainAll(q.listBlocked.all(today)),
    addBlocked: (date, note) => q.addBlocked.run(date, note || null),
    removeBlocked: (date) => q.removeBlocked.run(date).changes > 0,
    addMessage: (m) => q.addMessage.run(m.name, m.phone || null, m.email || null, m.message),
    listMessages: () => plainAll(q.listMessages.all()),
    markMessageRead: (id) => q.markRead.run(id).changes > 0,
    deleteMessage: (id) => q.deleteMessage.run(id).changes > 0,
    close: () => db.close(),
  };
}
