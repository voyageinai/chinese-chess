import { nanoid } from "nanoid";
import { getDb } from "./index";
import type {
  User,
  Engine,
  EngineVisibility,
  Tournament,
  TournamentEntry,
  Game,
  ResultCode,
  AuditLog,
  InviteCode,
} from "@/lib/types";
import type { Color } from "@/lib/types";
import type { EngineOutcome } from "@/lib/results";
import { getEnginePerspective } from "@/lib/results";
import { SANDBOX_USER_ID, SYSTEM_USER_ID } from "@/lib/service-users";

// ── Users ──────────────────────────────────────────────────────────────

/** Internal row includes the password hash (not exposed by the User type). */
interface UserRow extends User {
  password: string;
}

export type ResearchJobKind = "policy" | "balanced";
export type ResearchJobStatus =
  | "pending"
  | "running"
  | "finalizing"
  | "completed"
  | "failed";
export type ResearchShardStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface ResearchJobRow {
  id: string;
  kind: ResearchJobKind;
  status: ResearchJobStatus;
  output_path: string;
  params_json: string;
  shard_count: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error_text: string | null;
}

export interface ResearchShardRow {
  id: string;
  job_id: string;
  shard_index: number;
  status: ResearchShardStatus;
  worker_id: string | null;
  lease_id: string | null;
  seed: number;
  positions: number;
  params_json: string;
  claimed_at: number | null;
  last_heartbeat_at: number | null;
  uploaded_path: string | null;
  stats_json: string | null;
  error_text: string | null;
  finished_at: number | null;
}

export interface ResearchShardClaimRow extends ResearchShardRow {
  job_kind: ResearchJobKind;
  job_status: ResearchJobStatus;
  job_output_path: string;
  job_params_json: string;
}

interface CreateResearchJobOptions {
  kind: ResearchJobKind;
  outputPath: string;
  positions: number;
  shardCount: number;
  seed: number;
  params: Record<string, unknown>;
}

function splitTotal(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, idx) => base + (idx < extra ? 1 : 0));
}

export function createUser(username: string, passwordHash: string): User {
  const db = getDb();
  const id = nanoid();

  // Wrap in transaction to prevent race condition on first-user admin assignment
  const insertUser = db.transaction(() => {
    const count = db
      .prepare("SELECT COUNT(*) as cnt FROM users WHERE id NOT IN (?, ?)")
      .get(SYSTEM_USER_ID, SANDBOX_USER_ID) as { cnt: number };
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

export function getEnginesByUser(
  userId: string,
  status?: Engine["status"],
): Engine[] {
  const db = getDb();
  if (status) {
    return db
      .prepare(
        "SELECT * FROM engines WHERE user_id = ? AND status = ? ORDER BY uploaded_at DESC",
      )
      .all(userId, status) as Engine[];
  }

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
      "SELECT * FROM engines WHERE visibility = 'public' AND status = 'active' ORDER BY user_id = '__system__' DESC, uploaded_at DESC",
    )
    .all() as Engine[];
}

export function getEngineById(id: string): Engine | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM engines WHERE id = ?")
    .get(id) as Engine | undefined;
}

export function getEngineByName(name: string): Engine | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM engines WHERE lower(name) = lower(?) ORDER BY uploaded_at DESC LIMIT 1")
    .get(name) as Engine | undefined;
}

export function isEngineInRunningTournament(id: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT EXISTS(
          SELECT 1 FROM tournament_entries te
          JOIN tournaments t ON te.tournament_id = t.id
          WHERE te.engine_id = ? AND t.status = 'running'
        ) as in_use
      `,
    )
    .get(id) as { in_use: number };
  return row.in_use === 1;
}

export function softDeleteEngine(id: string): void {
  const db = getDb();
  db.prepare("UPDATE engines SET status = 'disabled' WHERE id = ?").run(id);
}

export function hardDeleteEngine(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM engines WHERE id = ?").run(id);
}

export function updateEngineElo(
  id: string,
  newElo: number,
  gamesPlayed: number,
  resultDelta?: { wins: number; losses: number; draws: number },
): void {
  const db = getDb();
  if (resultDelta) {
    db.prepare(
      "UPDATE engines SET elo = ?, games_played = ?, wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE id = ?",
    ).run(
      newElo,
      gamesPlayed,
      resultDelta.wins,
      resultDelta.losses,
      resultDelta.draws,
      id,
    );
  } else {
    db.prepare(
      "UPDATE engines SET elo = ?, games_played = ? WHERE id = ?",
    ).run(newElo, gamesPlayed, id);
  }
}

export function getLeaderboard(): (Engine & { owner: string })[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT e.*, u.username as owner FROM engines e JOIN users u ON e.user_id = u.id WHERE e.status = 'active' AND e.user_id != ? ORDER BY e.elo DESC",
    )
    .all(SANDBOX_USER_ID) as (Engine & { owner: string })[];
}

// ── Elo History ────────────────────────────────────────────────────────

export function recordEloSnapshot(engineId: string, elo: number, gameId: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO elo_history (id, engine_id, elo, game_id) VALUES (?, ?, ?, ?)",
  ).run(nanoid(), engineId, elo, gameId);
}

export function getEloHistory(engineId: string, limit = 50): { elo: number; recorded_at: number }[] {
  const db = getDb();
  return db.prepare(
    "SELECT elo, recorded_at FROM elo_history WHERE engine_id = ? ORDER BY recorded_at DESC LIMIT ?",
  ).all(engineId, limit) as { elo: number; recorded_at: number }[];
}

export function getEloDelta(engineId: string): number | null {
  const db = getDb();
  const rows = db.prepare(
    "SELECT elo FROM elo_history WHERE engine_id = ? ORDER BY recorded_at DESC LIMIT 2",
  ).all(engineId) as { elo: number }[];
  if (rows.length < 2) return null;
  return Math.round(rows[0].elo - rows[1].elo);
}

export function getLeaderboardWithDelta(): (Engine & { owner: string; elo_delta: number | null })[] {
  const db = getDb();
  // For each engine, compute delta as (latest elo_history entry) - (second latest entry).
  // Using a correlated subquery per engine is correct and readable for typical engine counts.
  const engines = db.prepare(
    `SELECT e.*, u.username as owner,
      (SELECT ROUND(h1.elo - h2.elo)
       FROM elo_history h1
       JOIN elo_history h2 ON h2.engine_id = h1.engine_id
         AND h2.recorded_at = (
           SELECT MAX(recorded_at) FROM elo_history
           WHERE engine_id = h1.engine_id AND recorded_at < h1.recorded_at
         )
       WHERE h1.engine_id = e.id
         AND h1.recorded_at = (SELECT MAX(recorded_at) FROM elo_history WHERE engine_id = e.id)
       LIMIT 1) as elo_delta
     FROM engines e
     JOIN users u ON e.user_id = u.id
     WHERE e.status = 'active' AND e.user_id != ?
     ORDER BY e.elo DESC`,
  ).all(SANDBOX_USER_ID) as (Engine & { owner: string; elo_delta: number | null })[];
  return engines;
}

// ── Tournaments ────────────────────────────────────────────────────────

export function createTournament(
  ownerId: string,
  name: string,
  timeControlBase: number,
  timeControlInc: number,
  rounds: number = 1,
  type: "tournament" | "quick_match" = "tournament",
  format: "round_robin" | "knockout" | "gauntlet" | "swiss" = "round_robin",
  sandbox: boolean = false,
): Tournament {
  const db = getDb();
  const id = nanoid();

  db.prepare(
    "INSERT INTO tournaments (id, owner_id, name, time_control_base, time_control_inc, rounds, type, format, sandbox) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, ownerId, name, timeControlBase, timeControlInc, rounds, type, format, sandbox ? 1 : 0);

  return getTournamentById(id)!;
}

export function getTournaments(): Tournament[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM tournaments WHERE sandbox = 0 ORDER BY created_at DESC")
    .all() as Tournament[];
}

/** Delete a sandbox tournament and all its games, entries, and elo_history. */
export function deleteSandboxTournament(tournamentId: string): void {
  const db = getDb();
  db.transaction(() => {
    // Delete elo history for games in this tournament
    db.prepare(
      "DELETE FROM elo_history WHERE game_id IN (SELECT id FROM games WHERE tournament_id = ?)",
    ).run(tournamentId);
    // Delete games
    db.prepare("DELETE FROM games WHERE tournament_id = ?").run(tournamentId);
    // Delete entries
    db.prepare("DELETE FROM tournament_entries WHERE tournament_id = ?").run(tournamentId);
    // Delete tournament
    db.prepare("DELETE FROM tournaments WHERE id = ?").run(tournamentId);
  })();
}

export function getTournamentById(id: string): Tournament | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM tournaments WHERE id = ?")
    .get(id) as Tournament | undefined;
}

export function updateTournamentBracket(
  id: string,
  bracketData: string,
): void {
  const db = getDb();
  db.prepare(
    "UPDATE tournaments SET bracket_data = ? WHERE id = ?",
  ).run(bracketData, id);
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

export function getFirstTournamentEngine(tournamentId: string): string | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT engine_id FROM tournament_entries WHERE tournament_id = ? ORDER BY ROWID ASC LIMIT 1",
    )
    .get(tournamentId) as { engine_id: string } | undefined;
  return row?.engine_id ?? null;
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
  openingFen?: string,
  round?: number,
): Game {
  const db = getDb();
  const id = nanoid();

  db.prepare(
    "INSERT INTO games (id, tournament_id, red_engine_id, black_engine_id, opening_fen, round) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, tournamentId, redEngineId, blackEngineId, openingFen ?? null, round ?? null);

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
  resultCode: ResultCode,
  reason: string,
  detail: string | null,
  moves: string,
  redTimeLeft: number | null,
  blackTimeLeft: number | null,
): void {
  const db = getDb();
  db.prepare(
    "UPDATE games SET result = ?, result_code = ?, result_reason = ?, result_detail = ?, moves = ?, red_time_left = ?, black_time_left = ?, finished_at = unixepoch() WHERE id = ?",
  ).run(result, resultCode, reason, detail, moves, redTimeLeft, blackTimeLeft, id);
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

/** Find one unstarted game from a running tournament for worker dispatch. */
export function pollUnstartedGame(
  excludeGameIds: string[],
): Game | undefined {
  const db = getDb();
  const placeholders = excludeGameIds.length
    ? `AND g.id NOT IN (${excludeGameIds.map(() => "?").join(",")})`
    : "";
  return db
    .prepare(
      `SELECT g.* FROM games g
       JOIN tournaments t ON g.tournament_id = t.id
       WHERE g.started_at IS NULL AND g.result IS NULL
         AND t.status = 'running'
         ${placeholders}
       ORDER BY g.ROWID ASC LIMIT 1`,
    )
    .get(...excludeGameIds) as Game | undefined;
}

// ── User Management ───────────────────────────────────────────────────

export function getAllUsers(): User[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT id, username, role, status, created_at FROM users WHERE id NOT IN (?, ?) ORDER BY created_at DESC",
    )
    .all(SYSTEM_USER_ID, SANDBOX_USER_ID) as User[];
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
      "SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND status = 'active' AND id NOT IN (?, ?)",
    )
    .get(SYSTEM_USER_ID, SANDBOX_USER_ID) as { cnt: number };
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

// ── Game Search ──────────────────────────────────────────────────────

export interface SearchGameRow extends Game {
  red_engine_name: string;
  black_engine_name: string;
  engine_side: Color | null;
  engine_outcome: EngineOutcome | null;
}

export function searchGames(opts: {
  engineId?: string;
  result?: "red" | "black" | "draw";
  outcome?: EngineOutcome;
  resultCode?: ResultCode;
  limit?: number;
  offset?: number;
}): { games: SearchGameRow[]; total: number } {
  const db = getDb();
  const conditions: string[] = ["g.result IS NOT NULL"]; // only finished games
  const params: unknown[] = [];

  if (opts.outcome && !opts.engineId) {
    throw new Error("searchGames outcome filter requires engineId");
  }

  if (opts.engineId) {
    conditions.push("(g.red_engine_id = ? OR g.black_engine_id = ?)");
    params.push(opts.engineId, opts.engineId);
  }
  if (opts.result) {
    conditions.push("g.result = ?");
    params.push(opts.result);
  }
  if (opts.outcome) {
    if (opts.outcome === "draw") {
      conditions.push("g.result = 'draw'");
    } else if (opts.outcome === "win") {
      conditions.push(
        "((g.red_engine_id = ? AND g.result = 'red') OR (g.black_engine_id = ? AND g.result = 'black'))",
      );
      params.push(opts.engineId, opts.engineId);
    } else if (opts.outcome === "loss") {
      conditions.push(
        "((g.red_engine_id = ? AND g.result = 'black') OR (g.black_engine_id = ? AND g.result = 'red'))",
      );
      params.push(opts.engineId, opts.engineId);
    }
  }
  if (opts.resultCode) {
    conditions.push("g.result_code = ?");
    params.push(opts.resultCode);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const countRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM games g ${where}`
  ).get(...params) as { cnt: number };

  const rawGames = db.prepare(
    `SELECT g.*, re.name as red_engine_name, be.name as black_engine_name
     FROM games g
     JOIN engines re ON g.red_engine_id = re.id
     JOIN engines be ON g.black_engine_id = be.id
     ${where}
     ORDER BY g.finished_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as (Game & {
    red_engine_name: string;
    black_engine_name: string;
  })[];

  const games = rawGames.map((game) => {
    const perspective = getEnginePerspective(
      opts.engineId,
      game.red_engine_id,
      game.black_engine_id,
      game.result,
    );
    return {
      ...game,
      engine_side: perspective?.side ?? null,
      engine_outcome: perspective?.outcome ?? null,
    };
  });

  return { games, total: countRow.cnt };
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

// ── Distributed Research Jobs ────────────────────────────────────────

export function createResearchJob(opts: CreateResearchJobOptions): ResearchJobRow {
  const db = getDb();
  const jobId = nanoid();
  const shardPositions = splitTotal(opts.positions, opts.shardCount);

  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO research_jobs (id, kind, status, output_path, params_json, shard_count)
       VALUES (?, ?, 'pending', ?, ?, ?)`,
    ).run(
      jobId,
      opts.kind,
      opts.outputPath,
      JSON.stringify({
        ...opts.params,
        positions: opts.positions,
        seed: opts.seed,
      }),
      opts.shardCount,
    );

    const insertShard = db.prepare(
      `INSERT INTO research_shards (id, job_id, shard_index, status, seed, positions, params_json)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    );

    for (let idx = 0; idx < shardPositions.length; idx++) {
      insertShard.run(
        nanoid(),
        jobId,
        idx,
        opts.seed + idx * 9973,
        shardPositions[idx],
        JSON.stringify(opts.params),
      );
    }
  });

  create();
  return getResearchJobById(jobId)!;
}

export function getResearchJobById(id: string): ResearchJobRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM research_jobs WHERE id = ?")
    .get(id) as ResearchJobRow | undefined;
}

export function listResearchJobs(limit = 20): ResearchJobRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM research_jobs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as ResearchJobRow[];
}

export function getResearchShardById(id: string): ResearchShardRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM research_shards WHERE id = ?")
    .get(id) as ResearchShardRow | undefined;
}

export function getResearchShardsByJob(jobId: string): ResearchShardRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM research_shards WHERE job_id = ? ORDER BY shard_index ASC")
    .all(jobId) as ResearchShardRow[];
}

export function pollResearchShard(
  workerId: string,
  heartbeatTimeoutSec = 90,
): ResearchShardClaimRow | undefined {
  const db = getDb();
  const staleBefore = Math.floor(Date.now() / 1000) - heartbeatTimeoutSec;

  const claim = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT
           rs.*,
           rj.kind as job_kind,
           rj.status as job_status,
           rj.output_path as job_output_path,
           rj.params_json as job_params_json
         FROM research_shards rs
         JOIN research_jobs rj ON rj.id = rs.job_id
         WHERE rj.status IN ('pending', 'running')
           AND (
             rs.status = 'pending'
             OR (rs.status = 'running' AND COALESCE(rs.last_heartbeat_at, 0) < ?)
           )
         ORDER BY rj.created_at ASC, rs.shard_index ASC
         LIMIT 1`,
      )
      .get(staleBefore) as ResearchShardClaimRow | undefined;

    if (!row) return undefined;

    const leaseId = nanoid();
    db.prepare(
      `UPDATE research_shards
       SET status = 'running',
           worker_id = ?,
           lease_id = ?,
           claimed_at = unixepoch(),
           last_heartbeat_at = unixepoch(),
           uploaded_path = NULL,
           stats_json = NULL,
           error_text = NULL,
           finished_at = NULL
       WHERE id = ?`,
    ).run(workerId, leaseId, row.id);

    db.prepare(
      `UPDATE research_jobs
       SET status = 'running',
           started_at = COALESCE(started_at, unixepoch()),
           error_text = NULL
       WHERE id = ? AND status IN ('pending', 'running')`,
    ).run(row.job_id);

    return {
      ...row,
      status: "running" as ResearchShardStatus,
      worker_id: workerId,
      lease_id: leaseId,
      claimed_at: Math.floor(Date.now() / 1000),
      last_heartbeat_at: Math.floor(Date.now() / 1000),
      uploaded_path: null,
      stats_json: null,
      error_text: null,
      finished_at: null,
      job_status: "running" as ResearchJobStatus,
    };
  });

  return claim();
}

export function renewResearchShardLease(
  shardId: string,
  leaseId: string,
  workerId: string,
): boolean {
  const db = getDb();
  const result = db.prepare(
    `UPDATE research_shards
     SET last_heartbeat_at = unixepoch()
     WHERE id = ?
       AND lease_id = ?
       AND worker_id = ?
       AND status = 'running'`,
  ).run(shardId, leaseId, workerId);
  return result.changes > 0;
}

export function recordResearchShardUpload(
  shardId: string,
  leaseId: string,
  uploadedPath: string,
): boolean {
  const db = getDb();
  const result = db.prepare(
    `UPDATE research_shards
     SET uploaded_path = ?, last_heartbeat_at = unixepoch()
     WHERE id = ? AND lease_id = ? AND status = 'running'`,
  ).run(uploadedPath, shardId, leaseId);
  return result.changes > 0;
}

export function completeResearchShard(
  shardId: string,
  leaseId: string,
  statsJson: string | null,
): ResearchShardRow | undefined {
  const db = getDb();
  const finish = db.transaction(() => {
    const row = getResearchShardById(shardId);
    if (!row || row.lease_id !== leaseId || row.status !== "running") {
      return undefined;
    }

    db.prepare(
      `UPDATE research_shards
       SET status = 'completed',
           stats_json = ?,
           finished_at = unixepoch(),
           last_heartbeat_at = unixepoch()
       WHERE id = ? AND lease_id = ?`,
    ).run(statsJson, shardId, leaseId);

    return getResearchShardById(shardId);
  });

  return finish();
}

export function failResearchShard(
  shardId: string,
  leaseId: string | null,
  errorText: string,
): ResearchShardRow | undefined {
  const db = getDb();
  const fail = db.transaction(() => {
    const row = getResearchShardById(shardId);
    if (!row) return undefined;
    if (leaseId && row.lease_id !== leaseId) return undefined;

    db.prepare(
      `UPDATE research_shards
       SET status = 'failed',
           error_text = ?,
           finished_at = unixepoch(),
           last_heartbeat_at = unixepoch()
       WHERE id = ?`,
    ).run(errorText, shardId);

    db.prepare(
      `UPDATE research_jobs
       SET status = 'failed',
           error_text = ?,
           finished_at = COALESCE(finished_at, unixepoch())
       WHERE id = ? AND status != 'completed'`,
    ).run(errorText, row.job_id);

    return getResearchShardById(shardId);
  });

  return fail();
}

export function tryStartResearchJobFinalization(jobId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    `UPDATE research_jobs
     SET status = 'finalizing'
     WHERE id = ? AND status IN ('pending', 'running')`,
  ).run(jobId);
  return result.changes > 0;
}

export function markResearchJobCompleted(jobId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE research_jobs
     SET status = 'completed', finished_at = unixepoch(), error_text = NULL
     WHERE id = ?`,
  ).run(jobId);
}

export function markResearchJobFailed(jobId: string, errorText: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE research_jobs
     SET status = 'failed', finished_at = COALESCE(finished_at, unixepoch()), error_text = ?
     WHERE id = ? AND status != 'completed'`,
  ).run(errorText, jobId);
}
