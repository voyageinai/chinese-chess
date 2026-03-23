import { nanoid } from "nanoid";
import { getDb } from "./index";
import type {
  User,
  Engine,
  Tournament,
  TournamentEntry,
  Game,
} from "@/lib/types";

// ── Users ──────────────────────────────────────────────────────────────

/** Internal row includes the password hash (not exposed by the User type). */
interface UserRow extends User {
  password: string;
}

export function createUser(username: string, passwordHash: string): User {
  const db = getDb();
  const id = nanoid();

  // First user auto-becomes admin
  const count = db.prepare("SELECT COUNT(*) as cnt FROM users").get() as {
    cnt: number;
  };
  const role = count.cnt === 0 ? "admin" : "user";

  db.prepare(
    "INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)",
  ).run(id, username, passwordHash, role);

  return getUserById(id)!;
}

export function getUserByUsername(username: string): UserRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as UserRow | undefined;
}

export function getUserById(id: string): User | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
  if (!row) return undefined;
  // Strip password before returning
  const { password: _, ...user } = row;
  return user;
}

// ── Engines ────────────────────────────────────────────────────────────

export function createEngine(
  userId: string,
  name: string,
  binaryPath: string,
): Engine {
  const db = getDb();
  const id = nanoid();

  db.prepare(
    "INSERT INTO engines (id, user_id, name, binary_path) VALUES (?, ?, ?, ?)",
  ).run(id, userId, name, binaryPath);

  return getEngineById(id)!;
}

export function getEnginesByUser(userId: string): Engine[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM engines WHERE user_id = ? OR user_id = '__system__' ORDER BY user_id = '__system__' DESC, uploaded_at DESC",
    )
    .all(userId) as Engine[];
}

export function getEngineById(id: string): Engine | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM engines WHERE id = ?")
    .get(id) as Engine | undefined;
}

export function deleteEngine(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM engines WHERE id = ?").run(id);
}

export function updateEngineElo(
  id: string,
  newElo: number,
  gamesPlayed: number,
): void {
  const db = getDb();
  db.prepare(
    "UPDATE engines SET elo = ?, games_played = ? WHERE id = ?",
  ).run(newElo, gamesPlayed, id);
}

export function getLeaderboard(): (Engine & { owner: string })[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT e.*, u.username as owner FROM engines e JOIN users u ON e.user_id = u.id ORDER BY e.elo DESC",
    )
    .all() as (Engine & { owner: string })[];
}

// ── Tournaments ────────────────────────────────────────────────────────

export function createTournament(
  name: string,
  timeControlBase: number,
  timeControlInc: number,
  rounds: number = 1,
): Tournament {
  const db = getDb();
  const id = nanoid();

  db.prepare(
    "INSERT INTO tournaments (id, name, time_control_base, time_control_inc, rounds) VALUES (?, ?, ?, ?, ?)",
  ).run(id, name, timeControlBase, timeControlInc, rounds);

  return getTournamentById(id)!;
}

export function getTournaments(): Tournament[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM tournaments ORDER BY created_at DESC")
    .all() as Tournament[];
}

export function getTournamentById(id: string): Tournament | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM tournaments WHERE id = ?")
    .get(id) as Tournament | undefined;
}

export function updateTournamentStatus(
  id: string,
  status: Tournament["status"],
): void {
  const db = getDb();
  if (status === "finished") {
    db.prepare(
      "UPDATE tournaments SET status = ?, finished_at = unixepoch() WHERE id = ?",
    ).run(status, id);
  } else {
    db.prepare("UPDATE tournaments SET status = ? WHERE id = ?").run(
      status,
      id,
    );
  }
}

// ── Tournament Entries ─────────────────────────────────────────────────

export function addEngineToTournament(
  tournamentId: string,
  engineId: string,
): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO tournament_entries (tournament_id, engine_id) VALUES (?, ?)",
  ).run(tournamentId, engineId);
}

export function getTournamentEntries(
  tournamentId: string,
): TournamentEntry[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM tournament_entries WHERE tournament_id = ? ORDER BY score DESC",
    )
    .all(tournamentId) as TournamentEntry[];
}

export function updateTournamentEntry(
  tournamentId: string,
  engineId: string,
  score: number,
  finalRank?: number,
): void {
  const db = getDb();
  if (finalRank !== undefined) {
    db.prepare(
      "UPDATE tournament_entries SET score = ?, final_rank = ? WHERE tournament_id = ? AND engine_id = ?",
    ).run(score, finalRank, tournamentId, engineId);
  } else {
    db.prepare(
      "UPDATE tournament_entries SET score = ? WHERE tournament_id = ? AND engine_id = ?",
    ).run(score, tournamentId, engineId);
  }
}

// ── Games ──────────────────────────────────────────────────────────────

export function createGame(
  tournamentId: string,
  redEngineId: string,
  blackEngineId: string,
): Game {
  const db = getDb();
  const id = nanoid();

  db.prepare(
    "INSERT INTO games (id, tournament_id, red_engine_id, black_engine_id) VALUES (?, ?, ?, ?)",
  ).run(id, tournamentId, redEngineId, blackEngineId);

  return getGameById(id)!;
}

export function updateGameResult(
  id: string,
  result: "red" | "black" | "draw",
  moves: string,
  redTimeLeft: number | null,
  blackTimeLeft: number | null,
): void {
  const db = getDb();
  db.prepare(
    "UPDATE games SET result = ?, moves = ?, red_time_left = ?, black_time_left = ?, finished_at = unixepoch() WHERE id = ?",
  ).run(result, moves, redTimeLeft, blackTimeLeft, id);
}

export function updateGameStarted(id: string): void {
  const db = getDb();
  db.prepare("UPDATE games SET started_at = unixepoch() WHERE id = ?").run(id);
}

export function getGameById(id: string): Game | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM games WHERE id = ?")
    .get(id) as Game | undefined;
}

export function getGamesByTournament(tournamentId: string): Game[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM games WHERE tournament_id = ?")
    .all(tournamentId) as Game[];
}

export function getActiveGames(): Game[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM games WHERE started_at IS NOT NULL AND finished_at IS NULL",
    )
    .all() as Game[];
}
