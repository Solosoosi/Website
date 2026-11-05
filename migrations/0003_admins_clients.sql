-- Signing in to the admin panel with a passkey (Face ID or Touch ID on an iPhone, iPad or
-- Mac; a fingerprint elsewhere). There's no password anywhere: each phone keeps a private
-- key that never leaves it, and the site keeps only the matching public key.
CREATE TABLE IF NOT EXISTS admins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  handle     TEXT NOT NULL,              -- random, groups one person's passkeys on their phone
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS passkeys (
  id           TEXT PRIMARY KEY,         -- the passkey's id (base64url)
  admin_id     INTEGER NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  public_key   TEXT NOT NULL,            -- SPKI, base64url
  alg          INTEGER NOT NULL,         -- -7 (ES256) or -257 (RS256)
  sign_count   INTEGER NOT NULL DEFAULT 0,
  rp_id        TEXT NOT NULL,            -- the site's address it was made for
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_passkeys_admin ON passkeys (admin_id);
-- One-time links that let a person add their passkey. Only a hash of each link's code is kept.
CREATE TABLE IF NOT EXISTS invites (
  code_hash  TEXT PRIMARY KEY,
  name       TEXT,
  created_by INTEGER,
  expires_at TEXT NOT NULL,              -- UTC, ISO 8601
  used_at    TEXT
);
-- Who is signed in. Only a hash of each session's cookie is kept.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Each sign-in or new passkey answers a fresh random challenge, used once, within minutes.
CREATE TABLE IF NOT EXISTS challenges (
  id          TEXT PRIMARY KEY,
  challenge   TEXT NOT NULL,
  purpose     TEXT NOT NULL,             -- 'login' or 'register'
  invite_hash TEXT,
  handle      TEXT,
  expires_at  TEXT NOT NULL
);

-- David's clients: one per phone number, from confirmed bookings and the ones he adds.
CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,       -- digits only, e.g. 0501234567
  email      TEXT,
  notes      TEXT,                       -- his own notes: only the admin panel shows them
  card_left  INTEGER NOT NULL DEFAULT 0, -- sessions left on the 4-session card
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE bookings ADD COLUMN client_id INTEGER REFERENCES clients (id);
CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings (client_id);
