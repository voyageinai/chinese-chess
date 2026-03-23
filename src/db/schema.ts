export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS engines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  binary_path TEXT NOT NULL,
  elo REAL NOT NULL DEFAULT 1500,
  games_played INTEGER NOT NULL DEFAULT 0,
  uploaded_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
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
  moves TEXT NOT NULL DEFAULT '[]',
  red_time_left INTEGER,
  black_time_left INTEGER,
  started_at INTEGER,
  finished_at INTEGER
);
`;
