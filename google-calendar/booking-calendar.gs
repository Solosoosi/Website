/**
 * Booking requests from the website, in David's Google Calendar.
 *
 * The website (the GitHub Pages version) talks to this script in two ways:
 *  - It asks which times are taken (doGet), so those times don't show on the
 *    booking page. It only gets busy times, never the events' titles or details.
 *  - It sends each booking request (doPost). The request is added to the
 *    calendar as a yellow event; the conversation and the confirmation stay on
 *    WhatsApp, as before.
 *
 * Anything in the calendar blocks that time on the website, and an all-day
 * event (a vacation, a holiday) closes the whole day.
 *
 * How to set it up: google-calendar/README.md in the website's repository.
 */

// ---- Settings ------------------------------------------------------------------

// Which calendar to use: '' = the account's main calendar. To use another one,
// paste its ID from Google Calendar → Settings → the calendar → "Calendar ID".
const CALENDAR_ID = '';

// The clinic's time zone (the website sends Israeli dates and times).
const TIME_ZONE = 'Asia/Jerusalem';

// At most this many requests a day: a guard against a flood of fake requests.
const MAX_REQUESTS_PER_DAY = 25;

// Requests further ahead than this are refused.
const MAX_DAYS_AHEAD = 120;

// ---- Which times are taken -----------------------------------------------------

/**
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
 * → { ok: true, busy: { "YYYY-MM-DD": [["HH:MM", "HH:MM"], ...] or "all" } }
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const from = validDate(p.from);
    const to = validDate(p.to);
    if (!from || !to || to < from || to > addDays(from, 62)) return json({ ok: false, error: 'range' });
    const start = at(from, '00:00');
    const end = at(addDays(to, 1), '00:00');
    const busy = {};
    for (const ev of calendar().getEvents(start, end)) {
      if (ignored(ev)) continue;
      if (ev.isAllDayEvent()) {
        // Both dates are midnight in the script's time zone; the end is the day after the last day.
        const zone = Session.getScriptTimeZone();
        const first = Utilities.formatDate(ev.getAllDayStartDate(), zone, 'yyyy-MM-dd');
        let stop = Utilities.formatDate(ev.getAllDayEndDate(), zone, 'yyyy-MM-dd');
        if (stop <= first) stop = addDays(first, 1);
        for (let d = first; d < stop; d = addDays(d, 1)) {
          if (d >= from && d <= to) busy[d] = 'all';
        }
      } else {
        addTimes(busy, ev.getStartTime(), ev.getEndTime(), from, to);
      }
    }
    return json({ ok: true, busy: busy });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'server' });
  }
}

// An event's time on each day it covers (an event past midnight continues the next day).
function addTimes(busy, start, end, from, to) {
  const firstDay = fmt(start, 'yyyy-MM-dd');
  const endDay = fmt(end, 'yyyy-MM-dd');
  const lastDay = fmt(new Date(end.getTime() - 1), 'yyyy-MM-dd');
  for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
    if (d < from || d > to || busy[d] === 'all') continue;
    const s = d === firstDay ? fmt(start, 'HH:mm') : '00:00';
    const e = d === endDay ? fmt(end, 'HH:mm') : '24:00';
    if (s >= e && e !== '24:00') continue;
    if (s === '00:00' && e === '24:00') busy[d] = 'all';
    else (busy[d] = busy[d] || []).push([s, e]);
  }
}

// Birthdays, "working location" markers and invitations he declined don't block anything.
function ignored(ev) {
  try {
    const type = ev.getEventType();
    if (type === CalendarApp.EventType.BIRTHDAY || type === CalendarApp.EventType.WORKING_LOCATION) return true;
  } catch (err) {}
  try {
    if (ev.getMyStatus() === CalendarApp.GuestStatus.NO) return true;
  } catch (err) {}
  return false;
}

// ---- A new booking request -----------------------------------------------------

/**
 * POST {"date":"YYYY-MM-DD","time":"HH:MM","duration":60,"service":"…","name":"…","notes":"…"}
 * → { ok: true } or { ok: false, error: "format" | "date" | "taken" | "limit" | "busy" | "server" }
 */
function doPost(e) {
  let r;
  try {
    r = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'format' });
  }
  const date = validDate(r.date);
  const time = validTime(r.time);
  const duration = Math.round(Number(r.duration));
  const name = clean(r.name, 60);
  const service = clean(r.service, 80);
  const notes = clean(r.notes, 500);
  if (!date || !time || !(duration >= 10 && duration <= 240) || name.length < 2 || !service) {
    return json({ ok: false, error: 'format' });
  }
  const today = fmt(new Date(), 'yyyy-MM-dd');
  const start = at(date, time);
  if (date > addDays(today, MAX_DAYS_AHEAD) || start.getTime() < Date.now() - 5 * 60 * 1000) {
    return json({ ok: false, error: 'date' });
  }
  const end = new Date(start.getTime() + duration * 60 * 1000);

  // One request at a time, so two people can't take the same time together.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json({ ok: false, error: 'busy' });
  try {
    const cal = calendar();
    if (cal.getEvents(start, end).some((ev) => !ignored(ev))) return json({ ok: false, error: 'taken' });
    if (!countRequest()) return json({ ok: false, error: 'limit' });
    const details = ['סוג טיפול: ' + service];
    if (notes) details.push('הערות: ' + notes);
    const ev = cal.createEvent('בקשה מהאתר: ' + name + ' – ' + service, start, end, { description: details.join('\n') });
    try {
      ev.setColor(CalendarApp.EventColor.YELLOW);
    } catch (err) {}
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

// Counts today's requests; false once today's limit is reached.
function countRequest() {
  const props = PropertiesService.getScriptProperties();
  const key = 'requests-' + fmt(new Date(), 'yyyy-MM-dd');
  const n = Number(props.getProperty(key) || 0);
  if (n >= MAX_REQUESTS_PER_DAY) return false;
  for (const k of props.getKeys()) {
    if (k.indexOf('requests-') === 0 && k !== key) props.deleteProperty(k);
  }
  props.setProperty(key, String(n + 1));
  return true;
}

// ---- Helpers -------------------------------------------------------------------

function calendar() {
  const cal = CALENDAR_ID ? CalendarApp.getCalendarById(CALENDAR_ID) : CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error('Calendar not found: check CALENDAR_ID');
  return cal;
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function fmt(date, pattern) {
  return Utilities.formatDate(date, TIME_ZONE, pattern);
}

// "YYYY-MM-DD" + "HH:MM" in Israel → the moment in time
function at(date, time) {
  return Utilities.parseDate(date + ' ' + time, TIME_ZONE, 'yyyy-MM-dd HH:mm');
}

// Counting from noon keeps clock changes (summer time) out of the way.
function addDays(date, n) {
  return fmt(new Date(at(date, '12:00').getTime() + n * 86400000), 'yyyy-MM-dd');
}

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return fmt(at(s, '12:00'), 'yyyy-MM-dd') === s ? s : null;
}

function validTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
}

function clean(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
