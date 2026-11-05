-- Payment at booking (Grow). While the client pays on Grow's page, the booking waits as
-- 'pending' and holds its time until hold_until (UTC, ISO 8601). It becomes 'confirmed' only
-- once Grow's payment is checked; an abandoned one becomes 'expired'.
ALTER TABLE bookings ADD COLUMN price INTEGER;
ALTER TABLE bookings ADD COLUMN hold_until TEXT;
-- A random secret the client's browser keeps, so only it can release its own held time.
ALTER TABLE bookings ADD COLUMN token TEXT;
-- When the booking was written into the practitioner's calendar (iCloud), if it was.
ALTER TABLE bookings ADD COLUMN calendar_at TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_status_hold ON bookings (status, hold_until);

-- One row per payment page opened at Grow. No card details are ever stored: Grow keeps them.
CREATE TABLE IF NOT EXISTS payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id        INTEGER NOT NULL REFERENCES bookings (id),
  process_id        TEXT NOT NULL UNIQUE,
  process_token     TEXT NOT NULL,
  sum               INTEGER NOT NULL,
  -- created → paid (or 'conflict': paid, but the time had been taken – refund it in Grow)
  status            TEXT NOT NULL DEFAULT 'created',
  transaction_id    TEXT,
  transaction_token TEXT,
  asmachta          TEXT,
  paid_at           TEXT,
  approved_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments (booking_id);
