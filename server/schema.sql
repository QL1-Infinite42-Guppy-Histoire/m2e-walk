-- M2E Walk — D1 schema. Apply with:
--   wrangler d1 execute m2e-walk --remote --file=./schema.sql
-- Points are an append-only ledger; balances are always SUM(ledger).

CREATE TABLE IF NOT EXISTS accounts (
  id                TEXT PRIMARY KEY,            -- public account id (uuid)
  token_hash        TEXT NOT NULL UNIQUE,        -- sha256 hex of the device secret
  recovery_code_hash TEXT NOT NULL,              -- sha256 hex of the recovery code
  step_carry        INTEGER NOT NULL DEFAULT 0,  -- sub-100-step remainder
  suspended         INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,            -- unix ms
  last_seen_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS step_reports (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id       TEXT NOT NULL REFERENCES accounts(id),
  client_date      TEXT NOT NULL,                -- device-local date (YYYY-MM-DD)
  delta_steps      INTEGER NOT NULL,             -- as reported
  accepted_steps   INTEGER NOT NULL,             -- after the daily cap
  counter_value    INTEGER,                      -- raw TYPE_STEP_COUNTER value
  prev_counter     INTEGER,
  reboot_detected  INTEGER NOT NULL DEFAULT 0,
  flags            TEXT NOT NULL DEFAULT '[]',   -- JSON array of review flags
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_step_reports_account_day ON step_reports(account_id, client_date);

-- Append-only point ledger. Never UPDATE or DELETE rows here.
CREATE TABLE IF NOT EXISTS ledger (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     TEXT NOT NULL REFERENCES accounts(id),
  type           TEXT NOT NULL CHECK (type IN ('earn','unlock','hold','redeem','refund','adjust')),
  pending_delta  INTEGER NOT NULL DEFAULT 0,
  confirmed_delta INTEGER NOT NULL DEFAULT 0,
  held_delta     INTEGER NOT NULL DEFAULT 0,
  spent_delta    INTEGER NOT NULL DEFAULT 0,
  ref            TEXT,                            -- e.g. SSV transaction_id, exchange id
  memo           TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_id, id);

-- One-time tokens placed into the AdMob SSV custom_data by the app.
CREATE TABLE IF NOT EXISTS unlock_tokens (
  token      TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

-- SSV callbacks that have been processed (transaction_id is unique:
-- a replayed callback can never unlock twice).
CREATE TABLE IF NOT EXISTS ad_unlocks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     TEXT NOT NULL REFERENCES accounts(id),
  transaction_id TEXT NOT NULL UNIQUE,
  points         INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);

-- Gift-card inventory. Codes are stored ENCRYPTED (AES-GCM, key in a Worker
-- secret) — never in plaintext, never in this repo. Empty until the operator
-- registers codes bought through official channels (DESIGN.md §6.4).
CREATE TABLE IF NOT EXISTS gift_inventory (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code_cipher        TEXT NOT NULL,               -- base64(iv || ciphertext)
  amount_yen         INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','assigned','void')),
  assigned_exchange_id INTEGER,
  created_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  points        INTEGER NOT NULL,
  amount_yen    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending_review'
                CHECK (status IN ('pending_review','approved','rejected','no_stock')),
  gift_id       INTEGER REFERENCES gift_inventory(id),
  reject_reason TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exchange_account ON exchange_requests(account_id, id);

CREATE TABLE IF NOT EXISTS admin_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
