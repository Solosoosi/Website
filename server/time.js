// Date helpers. All booking dates/times are stored as local wall-clock values
// ("YYYY-MM-DD" + "HH:MM") in the practice's time zone, which keeps slot math
// simple and immune to the server's own time zone.

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  return new Date(parseDate(s)).toISOString().slice(0, 10) === s;
}

export function isValidTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function dayIndex(s) {
  return Math.floor(parseDate(s) / DAY_MS);
}

export function addDays(s, n) {
  return new Date(parseDate(s) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(s) {
  return new Date(parseDate(s)).getUTCDay();
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** Current wall-clock date and minute-of-day in the given IANA time zone. */
export function nowInZone(timeZone, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}
