PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0));
CREATE TABLE IF NOT EXISTS user_credentials (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_attempts (bucket TEXT PRIMARY KEY, expires INTEGER NOT NULL, attempts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS checkins (user_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL, PRIMARY KEY(user_id, day));
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), prompt TEXT NOT NULL, size TEXT NOT NULL,
  cost INTEGER NOT NULL, status TEXT NOT NULL, provider_id TEXT, image_url TEXT, error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_task ON tasks(user_id) WHERE status IN ('submitting','pending','uncertain');
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id), delta INTEGER NOT NULL,
  reason TEXT NOT NULL, reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS ledger_balance AFTER INSERT ON ledger BEGIN
  UPDATE users SET balance = balance + NEW.delta WHERE id = NEW.user_id;
END;
INSERT OR IGNORE INTO users(id, name) VALUES ('demo', 'Demo 创作者');
