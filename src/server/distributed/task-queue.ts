import * as queries from "@/db/queries";
import { getLeaseManager } from "./lease-manager";
import { getEngineContentHash } from "./engine-server";
import { getRunner } from "../tournament";
import { calculateElo } from "../elo";
import type { WorkerTask, ResultReport } from "./types";

/**
 * Poll for an available game and create a lease for it.
 * Returns a WorkerTask or null if no work is available.
 */
export function pollTask(workerId: string): WorkerTask | null {
  const leaseMgr = getLeaseManager();

  // Exclude games that already have active leases
  const excludeIds: string[] = [];
  // We'll try a few times in case leased games block our query
  for (let attempt = 0; attempt < 3; attempt++) {
    const game = queries.pollUnstartedGame(excludeIds);
    if (!game) return null;

    // Try to create a lease
    const lease = leaseMgr.create(game.id, workerId);
    if (!lease) {
      // Another worker got it, or it already has a lease
      excludeIds.push(game.id);
      continue;
    }

    // Claim the game in DB (set started_at)
    const tournament = queries.getTournamentById(game.tournament_id);
    if (!tournament) {
      leaseMgr.release(game.id, lease.leaseId);
      excludeIds.push(game.id);
      continue;
    }

    const timeBaseMs = tournament.time_control_base * 1000;
    queries.initializeGameStarted(game.id, timeBaseMs);

    // Build engine refs
    const redEngine = queries.getEngineById(game.red_engine_id);
    const blackEngine = queries.getEngineById(game.black_engine_id);
    if (!redEngine || !blackEngine) {
      leaseMgr.release(game.id, lease.leaseId);
      queries.resetGameStarted(game.id);
      excludeIds.push(game.id);
      continue;
    }

    const redHash = getEngineContentHash(game.red_engine_id);
    const blackHash = getEngineContentHash(game.black_engine_id);
    if (!redHash || !blackHash) {
      leaseMgr.release(game.id, lease.leaseId);
      queries.resetGameStarted(game.id);
      excludeIds.push(game.id);
      continue;
    }

    return {
      leaseId: lease.leaseId,
      gameId: game.id,
      tournamentId: game.tournament_id,
      redEngine: {
        id: redEngine.id,
        name: redEngine.name,
        contentHash: redHash,
      },
      blackEngine: {
        id: blackEngine.id,
        name: blackEngine.name,
        contentHash: blackHash,
      },
      timeBase: timeBaseMs,
      timeInc: tournament.time_control_inc * 1000,
      startFen: game.opening_fen ?? null,
      leaseExpiresAt: lease.expiresAt,
    };
  }

  return null;
}

/**
 * Handle a game result reported by a worker.
 * Persists the result, updates Elo/scores via the active TournamentRunner.
 */
export function handleResult(
  gameId: string,
  report: ResultReport,
): { ok: boolean; reason?: string } {
  const leaseMgr = getLeaseManager();

  // Check if game already has a result (idempotent)
  const game = queries.getGameById(gameId);
  if (!game) return { ok: false, reason: "game_not_found" };
  if (game.result) return { ok: true }; // already completed

  // Validate lease (graceful: accept result even if lease expired, as long as game has no result)
  // We intentionally proceed regardless — the game result is more important than lease state.
  leaseMgr.validate(gameId, report.leaseId);

  // Persist game result
  queries.updateGameResult(
    gameId,
    report.result,
    report.code,
    report.reason,
    report.detail,
    report.moves,
    report.redTimeLeft,
    report.blackTimeLeft,
  );

  // Try to update Elo/scores via the active runner
  const runner = getRunner(game.tournament_id);
  if (runner) {
    try {
      runner.applyRemoteResult(gameId, report);
    } catch (err) {
      console.error(`[task-queue] Failed to apply remote result for game ${gameId}:`, err);
      // Result is already in DB; Elo will be reconciled on tournament end or restart
    }
  } else {
    // No runner — do a standalone Elo update
    applyStandaloneElo(game, report);
  }

  // Track completion and release lease
  // Extract workerId from lease before releasing (for stats tracking)
  const lease = leaseMgr.getLease(gameId);
  if (lease) {
    leaseMgr.trackCompletion(lease.workerId, gameId);
  }
  leaseMgr.release(gameId, report.leaseId);

  return { ok: true };
}

/**
 * Fallback: update Elo when no TournamentRunner is active
 * (e.g. master restarted but worker still sent result).
 */
function applyStandaloneElo(
  game: { red_engine_id: string; black_engine_id: string; tournament_id: string },
  report: ResultReport,
): void {
  const redEngine = queries.getEngineById(game.red_engine_id);
  const blackEngine = queries.getEngineById(game.black_engine_id);
  if (!redEngine || !blackEngine) return;

  const scoreA =
    report.result === "red" ? 1 : report.result === "black" ? 0 : 0.5;

  const [newRedElo, newBlackElo] = calculateElo(
    redEngine.elo,
    blackEngine.elo,
    scoreA,
    redEngine.games_played,
    blackEngine.games_played,
  );

  queries.updateEngineElo(game.red_engine_id, Math.round(newRedElo), redEngine.games_played + 1, {
    wins: report.result === "red" ? 1 : 0,
    losses: report.result === "black" ? 1 : 0,
    draws: report.result === "draw" ? 1 : 0,
  });

  queries.updateEngineElo(game.black_engine_id, Math.round(newBlackElo), blackEngine.games_played + 1, {
    wins: report.result === "black" ? 1 : 0,
    losses: report.result === "red" ? 1 : 0,
    draws: report.result === "draw" ? 1 : 0,
  });
}
