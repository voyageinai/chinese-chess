export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS engines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  binary_path TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  status TEXT NOT NULL DEFAULT 'active',
  elo REAL NOT NULL DEFAULT 1500,
  games_played INTEGER NOT NULL DEFAULT 0,
  uploaded_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  time_control_base INTEGER NOT NULL,
  time_control_inc INTEGER NOT NULL,
  rounds INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  engine_id TEXT NOT NULL REFERENCES engines(id),
  final_rank INTEGER,
  score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (tournament_id, engine_id)
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  red_engine_id TEXT NOT NULL REFERENCES engines(id),
  black_engine_id TEXT NOT NULL REFERENCES engines(id),
  result TEXT,
  result_reason TEXT,
  moves TEXT NOT NULL DEFAULT '[]',
  red_time_left INTEGER,
  black_time_left INTEGER,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  used_by TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`;
