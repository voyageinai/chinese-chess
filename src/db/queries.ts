import { nanoid } from "nanoid";
import { getDb } from "./index";
import type {
  User,
  Engine,
  EngineVisibility,
  Tournament,
  TournamentEntry,
  Game,
  AuditLog,
  InviteCode,
} from "@/lib/types";

// ── Users ──────────────────────────────────────────────────────────────

/** Internal row includes the password hash (not exposed by the User type). */
interface UserRow extends User {
  password: string;
}

export function createUser(username: string, passwordHash: string): User {
  const db = getDb();
  const id = nanoid();

  // Wrap in transaction to prevent race condition on first-user admin assignment
  const insertUser = db.transaction(() => {
    const count = db
      .prepare("SELECT COUNT(*) as cnt FROM users WHERE id != '__system__'")
      .get() as { cnt: number };
    const role = count.cnt === 0 ? "admin" : "user";

    db.prepare(
      "INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)",
    ).run(id, username, passwordHash, role);
  });
  insertUser();

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
  const { password, ...user } = row;
  void password;
  return user;
}

// ── Engines ────────────────────────────────────────────────────────────

export function createEngine(
  userId: string,
  name: string,
  binaryPath: string,
  visibility: EngineVisibility = "public",
): Engine {
  const db = getDb();
  const id = nanoid();

  db.prepare(
    "INSERT INTO engines (id, user_id, name, binary_path, visibility) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userId, name, binaryPath, visibility);

  return getEngineById(id)!;
}

export function getEnginesByUser(userId: string): Engine[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM engines WHERE user_id = ? ORDER BY uploaded_at DESC",
    )
    .all(userId) as Engine[];
}

export function getVisibleEngines(): Engine[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM engines WHERE visibility = 'public' ORDER BY user_id = '__system__' DESC, uploaded_at DESC",
    )
    .all() as Engine[];
}

export function getEngineById(id: string): Engine | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM engines WHERE id = ?")
    .get(id) as Engine | undefined;
}

export function isEngineReferenced(id: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT EXISTS(
          SELECT 1 FROM tournament_entries WHERE engine_id = ?
          UNION ALL
          SELECT 1 FROM games WHERE red_engine_id = ? OR black_engine_id = ?
        ) as in_use
      `,
    )
    .get(id, id, id) as { in_use: number };
  return row.in_use === 1;
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
  ownerId: string,
  name: string,
  timeControlBase: number,
  timeControlInc: number,
  rounds: number = 1,
): Tournament {
  const db = getDb();
  const id = nanoid();

  db.prepare(
    "INSERT INTO tournaments (id, owner_id, name, time_control_base, time_control_inc, rounds) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, ownerId, name, timeControlBase, timeControlInc, rounds);

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
  if (status === "finished" || status === "cancelled") {
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

export function updateGameMoves(
  id: string,
  moves: string,
  redTimeLeft: number,
  blackTimeLeft: number,
): void {
  const db = getDb();
  db.prepare(
    "UPDATE games SET moves = ?, red_time_left = ?, black_time_left = ? WHERE id = ?",
  ).run(moves, redTimeLeft, blackTimeLeft, id);
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

export function initializeGameStarted(id: string, timeBaseMs: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE games SET started_at = unixepoch(), red_time_left = ?, black_time_left = ? WHERE id = ?",
  ).run(timeBaseMs, timeBaseMs, id);
}

export function resetGameStarted(id: string): void {
  const db = getDb();
  db.prepare("UPDATE games SET started_at = NULL WHERE id = ?").run(id);
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

// ── User Management ───────────────────────────────────────────────────

export function getAllUsers(): User[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT id, username, role, status, created_at FROM users WHERE id != '__system__' ORDER BY created_at DESC",
    )
    .all() as User[];
}

export function updateUserRole(id: string, role: "admin" | "user"): void {
  const db = getDb();
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

export function updateUserStatus(id: string, status: "active" | "banned"): void {
  const db = getDb();
  db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, id);
}

export function countActiveAdmins(): number {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND status = 'active' AND id != '__system__'",
    )
    .get() as { cnt: number };
  return row.cnt;
}

// ── Engine Management ─────────────────────────────────────────────────

export function getAllEngines(): Engine[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM engines ORDER BY uploaded_at DESC")
    .all() as Engine[];
}

export function updateEngineStatus(id: string, status: "active" | "disabled"): void {
  const db = getDb();
  db.prepare("UPDATE engines SET status = ? WHERE id = ?").run(status, id);
}

// ── Tournament Management ─────────────────────────────────────────────

export function deleteTournament(id: string): void {
  const db = getDb();
  const del = db.transaction(() => {
    db.prepare("DELETE FROM games WHERE tournament_id = ?").run(id);
    db.prepare("DELETE FROM tournament_entries WHERE tournament_id = ?").run(id);
    db.prepare("DELETE FROM tournaments WHERE id = ?").run(id);
  });
  del();
}

// ── Audit Logs ────────────────────────────────────────────────────────

export function createAuditLog(
  action: string,
  actorId: string,
  targetType: string | null,
  targetId: string | null,
  details: Record<string, unknown>,
): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO audit_logs (id, action, actor_id, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(nanoid(), action, actorId, targetType, targetId, JSON.stringify(details));
}

export function getAuditLogs(opts?: {
  action?: string;
  actorId?: string;
  limit?: number;
  offset?: number;
}): AuditLog[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.action) {
    conditions.push("action = ?");
    params.push(opts.action);
  }
  if (opts?.actorId) {
    conditions.push("actor_id = ?");
    params.push(opts.actorId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;

  return db
    .prepare(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as AuditLog[];
}

// ── Invite Codes ──────────────────────────────────────────────────────

export function createInviteCode(
  code: string,
  createdBy: string,
  expiresAt: number,
): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO invite_codes (code, created_by, expires_at) VALUES (?, ?, ?)",
  ).run(code, createdBy, expiresAt);
}

export function getInviteCodes(): InviteCode[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM invite_codes ORDER BY created_at DESC")
    .all() as InviteCode[];
}

export function getInviteCodeByCode(code: string): InviteCode | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM invite_codes WHERE code = ?")
    .get(code) as InviteCode | undefined;
}

export function useInviteCode(code: string, userId: string): boolean {
  const db = getDb();
  const result = db
    .prepare(
      "UPDATE invite_codes SET used_by = ? WHERE code = ? AND used_by IS NULL AND expires_at > unixepoch()",
    )
    .run(userId, code);
  return result.changes > 0;
}

export function deleteInviteCode(code: string): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM invite_codes WHERE code = ? AND used_by IS NULL")
    .run(code);
  return result.changes > 0;
}

// ── System Stats ──────────────────────────────────────────────────────

export function getSystemStats(): {
  userCount: number;
  engineCount: number;
  tournamentCount: number;
  activeGameCount: number;
} {
  const db = getDb();
  const users = db
    .prepare("SELECT COUNT(*) as cnt FROM users WHERE id != '__system__'")
    .get() as { cnt: number };
  const engines = db
    .prepare("SELECT COUNT(*) as cnt FROM engines")
    .get() as { cnt: number };
  const tournaments = db
    .prepare("SELECT COUNT(*) as cnt FROM tournaments")
    .get() as { cnt: number };
  const activeGames = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM games WHERE started_at IS NOT NULL AND finished_at IS NULL",
    )
    .get() as { cnt: number };
  return {
    userCount: users.cnt,
    engineCount: engines.cnt,
    tournamentCount: tournaments.cnt,
    activeGameCount: activeGames.cnt,
  };
}
