import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotsForDay } from '../server/availability.js';
import { addDays, isValidDate, nowInZone, weekday } from '../server/time.js';

const schedule = {
  weeklyHours: { 0: [['09:00', '12:00']], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
  slotInterval: 30,
  bufferMinutes: 15,
  minNoticeHours: 0,
  maxDaysAhead: 30,
};
const SUNDAY = '2026-10-04';
const now = { date: '2026-10-01', minutes: 8 * 60 };

test('time helpers', () => {
  assert.equal(weekday(SUNDAY), 0);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.ok(isValidDate('2028-02-29'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.ok(!isValidDate('2026-2-3'));
  const n = nowInZone('Asia/Jerusalem', new Date('2026-07-01T21:30:00Z'));
  assert.deepEqual(n, { date: '2026-07-02', minutes: 30 }); // UTC+3 in summer
});

test('generates slots that fit inside opening hours', () => {
  const slots = slotsForDay({ date: SUNDAY, duration: 60, schedule, now });
  assert.deepEqual(slots, ['09:00', '09:30', '10:00', '10:30', '11:00']);
});

test('closed days and blocked days have no slots', () => {
  assert.deepEqual(slotsForDay({ date: '2026-10-05', duration: 60, schedule, now }), []);
  assert.deepEqual(slotsForDay({ date: SUNDAY, duration: 60, schedule, now, blocked: true }), []);
});

test('existing bookings plus buffer remove overlapping slots', () => {
  const dayBookings = [{ start: 9 * 60 + 30, end: 10 * 60 + 30 }];
  const slots = slotsForDay({ date: SUNDAY, duration: 60, schedule, now, dayBookings });
  // 09:00 would end 10:00 > 09:30-15; 11:00 starts after 10:30+15.
  assert.deepEqual(slots, ['11:00']);
});

test('respects minimum notice and booking window', () => {
  const soon = { ...schedule, minNoticeHours: 2 };
  const today = { date: SUNDAY, minutes: 8 * 60 };
  assert.deepEqual(slotsForDay({ date: SUNDAY, duration: 60, schedule: soon, now: today }), ['10:00', '10:30', '11:00']);
  assert.deepEqual(slotsForDay({ date: '2026-09-27', duration: 60, schedule, now }), []);
  assert.deepEqual(slotsForDay({ date: addDays(now.date, 31), duration: 20, schedule, now }), []);
});
