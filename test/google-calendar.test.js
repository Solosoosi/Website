// The Google Calendar script (google-calendar/booking-calendar.gs), run in Node with
// small stand-ins for Google's services: calendar, dates, lock and storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const TZ = 'Asia/Jerusalem';
const parts = (date, tz) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const g = (t) => Number(f.find((p) => p.type === t).value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
};
const pad = (n) => String(n).padStart(2, '0');
const Utilities = {
  formatDate(date, tz, pattern) {
    const p = parts(date, tz);
    return pattern.replace('yyyy', p.y).replace('MM', pad(p.mo)).replace('dd', pad(p.d)).replace('HH', pad(p.h)).replace('mm', pad(p.mi));
  },
  parseDate(str, tz) {
    const [y, mo, d, h, mi] = str.match(/\d+/g).map(Number);
    const want = Date.UTC(y, mo - 1, d, h, mi);
    let guess = want;
    for (let i = 0; i < 4; i++) {
      const p = parts(new Date(guess), tz);
      const diff = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - want;
      if (!diff) break;
      guess -= diff;
    }
    return new Date(guess);
  },
};

function setup() {
  const events = [];
  const props = new Map();
  const event = (o) => ({
    type: 'DEFAULT', status: 'OWNER', allDay: false, color: null, description: '', ...o,
    isAllDayEvent() { return this.allDay; },
    getStartTime() { return this.start; },
    getEndTime() { return this.end; },
    getAllDayStartDate() { return this.start; },
    getAllDayEndDate() { return this.end; },
    getEventType() { return this.type; },
    getMyStatus() { return this.status; },
    setColor(c) { this.color = c; },
  });
  const calendar = {
    getEvents: (s, e) => events.filter((x) => x.start < e && x.end > s),
    createEvent(title, start, end, opts) { const x = event({ title, start, end, description: opts.description }); events.push(x); return x; },
  };
  const ctx = vm.createContext({
    console,
    Utilities,
    Session: { getScriptTimeZone: () => TZ },
    CalendarApp: {
      EventType: { BIRTHDAY: 'BIRTHDAY', WORKING_LOCATION: 'WORKING_LOCATION' },
      GuestStatus: { NO: 'NO' },
      EventColor: { YELLOW: '5' },
      getDefaultCalendar: () => calendar,
      getCalendarById: () => calendar,
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), getKeys: () => [...props.keys()], deleteProperty: (k) => props.delete(k) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType() { return this; }, s }) },
  });
  const code = fs.readFileSync(new URL('../google-calendar/booking-calendar.gs', import.meta.url), 'utf8');
  vm.runInContext(`${code}\n;this.gs = { doGet, doPost, addDays, at, fmt };`, ctx);
  const { gs } = ctx;
  const today = gs.fmt(new Date(), 'yyyy-MM-dd');
  return {
    gs,
    events,
    props,
    day: (n) => gs.addDays(today, n),
    add: (o) => events.push(event(o)),
    allDay: (first, last, o = {}) => events.push(event({ allDay: true, start: gs.at(first, '00:00'), end: gs.at(gs.addDays(last, 1), '00:00'), ...o })),
    get: (parameter) => JSON.parse(gs.doGet({ parameter }).s),
    post: (body) => JSON.parse(gs.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).s),
  };
}

test('busy times: timed, past midnight, all-day and ignored events, no titles', () => {
  const c = setup();
  const { at } = c.gs;
  c.add({ title: 'client', start: at(c.day(1), '10:00'), end: at(c.day(1), '11:15') });
  c.add({ title: 'late', start: at(c.day(2), '22:00'), end: at(c.day(3), '01:00') });
  c.allDay(c.day(4), c.day(6), { title: 'vacation' });
  c.allDay(c.day(7), c.day(7), { title: 'birthday', type: 'BIRTHDAY' });
  c.add({ title: 'declined', start: at(c.day(8), '12:00'), end: at(c.day(8), '13:00'), status: 'NO' });
  const r = c.get({ from: c.day(0), to: c.day(10) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.busy, {
    [c.day(1)]: [['10:00', '11:15']],
    [c.day(2)]: [['22:00', '24:00']],
    [c.day(3)]: [['00:00', '01:00']],
    [c.day(4)]: 'all',
    [c.day(5)]: 'all',
    [c.day(6)]: 'all',
  });
  assert.equal(c.get({ from: c.day(5), to: c.day(1) }).ok, false);
  assert.equal(c.get({ from: c.day(0), to: c.day(90) }).ok, false);
});

test('a request is added once, in yellow, at the right time', () => {
  const c = setup();
  const req = { date: c.day(5), time: '10:00', duration: 60, service: 'דיקור מערבי יבש', name: 'דנה', notes: 'כאב גב' };
  assert.deepEqual(c.post(req), { ok: true });
  const [e] = c.events;
  assert.equal(e.title, 'בקשה מהאתר: דנה – דיקור מערבי יבש');
  assert.equal(e.description, 'סוג טיפול: דיקור מערבי יבש\nהערות: כאב גב');
  assert.equal(e.color, '5');
  assert.equal(Utilities.formatDate(e.start, TZ, 'yyyy-MM-dd HH:mm'), `${c.day(5)} 10:00`);
  assert.equal((e.end - e.start) / 60000, 60);
  assert.equal(c.post(req).error, 'taken');
  assert.equal(c.post({ ...req, time: '10:30' }).error, 'taken');
  assert.equal(c.post({ ...req, time: '11:00' }).ok, true);
});

test('requests: bad input, past, too far ahead, closed days, daily limit', () => {
  const c = setup();
  const req = { date: c.day(3), time: '10:00', duration: 60, service: 'x', name: 'דנה' };
  c.allDay(c.day(2), c.day(2));
  assert.equal(c.post('nope').error, 'format');
  assert.equal(c.post({ ...req, time: '24:00' }).error, 'format');
  assert.equal(c.post({ ...req, date: '2026-02-30' }).error, 'format');
  assert.equal(c.post({ ...req, name: 'א' }).error, 'format');
  assert.equal(c.post({ ...req, duration: 0 }).error, 'format');
  assert.equal(c.post({ ...req, date: c.day(-1) }).error, 'date');
  assert.equal(c.post({ ...req, date: c.day(200) }).error, 'date');
  assert.equal(c.post({ ...req, date: c.day(2) }).error, 'taken');
  let ok = 0;
  for (let i = 0; i < 30; i++) ok += c.post({ ...req, date: c.day(3 + Math.floor(i / 10)), time: `${pad(8 + (i % 10))}:00` }).ok ? 1 : 0;
  assert.equal(ok, 25);
});

test('dates across the summer-time change', () => {
  const { gs } = setup();
  assert.equal(gs.addDays('2027-03-25', 1), '2027-03-26');
  assert.equal(gs.addDays('2027-03-26', 1), '2027-03-27');
  assert.equal(Utilities.formatDate(gs.at('2027-03-26', '10:00'), 'UTC', 'HH:mm'), '07:00');
});
