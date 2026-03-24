import { EventEmitter } from "events";
import { Match, type MatchConfig, type MatchResult } from "./match";
import { calculateElo } from "./elo";
import * as queries from "@/db/queries";
import { getTournaments } from "@/db/queries";
import type { Engine, Tournament, TournamentEntry } from "@/lib/types";
import type { WsHub } from "./ws";

// ---------------------------------------------------------------------------
// Pairing generation
// ---------------------------------------------------------------------------

export interface Pairing {
  red: string; // engine ID
  black: string; // engine ID
}

/**
 * Generate round-robin pairings for a set of engines.
 * Each pair plays `rounds` games, alternating colors on even/odd rounds.
 */
export function generateRoundRobinPairings(
  engineIds: string[],
  rounds: number,
): Pairing[] {
  const pairings: Pairing[] = [];
  for (let i = 0; i < engineIds.length; i++) {
    for (let j = i + 1; j < engineIds.length; j++) {
      for (let r = 0; r < rounds; r++) {
        if (r % 2 === 0) {
          pairings.push({ red: engineIds[i], black: engineIds[j] });
        } else {
          pairings.push({ red: engineIds[j], black: engineIds[i] });
        }
      }
    }
  }
  return pairings;
}

// ---------------------------------------------------------------------------
// Tournament runner
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_MATCHES = 1;

// ── Runner Registry (module-level singleton) ──────────────────────────

const runnerRegistry = new Map<string, TournamentRunner>();

export function getRunner(tournamentId: string): TournamentRunner | undefined {
  return runnerRegistry.get(tournamentId);
}

export function registerRunner(tournamentId: string, runner: TournamentRunner): boolean {
  if (runnerRegistry.has(tournamentId)) return false; // already running
  runnerRegistry.set(tournamentId, runner);
  return true;
}

export function unregisterRunner(tournamentId: string): void {
  runnerRegistry.delete(tournamentId);
}

export function getActiveRunners(): Map<string, TournamentRunner> {
  return runnerRegistry;
}

export class TournamentRunner extends EventEmitter {
  private tournamentId: string;
  private aborted = false;

  constructor(tournamentId: string) {
    super();
    this.tournamentId = tournamentId;
  }

  async run(): Promise<void> {
    const tournament = queries.getTournamentById(this.tournamentId);
    if (!tournament) {
      throw new Error(`Tournament ${this.tournamentId} not found`);
    }

    // Mark tournament as running
    queries.updateTournamentStatus(this.tournamentId, "running");

    // Get entries and build engine lookup
    const entries = queries.getTournamentEntries(this.tournamentId);
    const engineIds = entries.map((e) => e.engine_id);

    if (engineIds.length < 2) {
      throw new Error("Tournament needs at least 2 engines");
    }

    // Build engine lookup (id -> Engine)
    const engines = new Map<string, Engine>();
    for (const eid of engineIds) {
      const engine = queries.getEngineById(eid);
      if (!engine) {
        throw new Error(`Engine ${eid} not found`);
      }
      engines.set(eid, engine);
    }

    // Check for existing games (resume after restart) or create new ones
    let existingGames = queries.getGamesByTournament(this.tournamentId);

    if (existingGames.length === 0) {
      // Fresh start: generate pairings and create game records
      const pairings = generateRoundRobinPairings(engineIds, tournament.rounds);
      for (const pairing of pairings) {
        queries.createGame(this.tournamentId, pairing.red, pairing.black);
      }
      existingGames = queries.getGamesByTournament(this.tournamentId);
    }

    // Track scores from already-completed games
    const scores = new Map<string, number>();
    for (const eid of engineIds) {
      scores.set(eid, 0);
    }
    for (const g of existingGames) {
      if (g.result) {
        if (g.result === "red") {
          scores.set(g.red_engine_id, (scores.get(g.red_engine_id) ?? 0) + 1);
        } else if (g.result === "black") {
          scores.set(g.black_engine_id, (scores.get(g.black_engine_id) ?? 0) + 1);
        } else {
          scores.set(g.red_engine_id, (scores.get(g.red_engine_id) ?? 0) + 0.5);
          scores.set(g.black_engine_id, (scores.get(g.black_engine_id) ?? 0) + 0.5);
        }
      }
    }

    // Run unfinished games sequentially
    for (const game of existingGames) {
      if (this.aborted) break;
      if (game.result) continue; // Already finished, skip

      const gameId = game.id;
      const redEngine = engines.get(game.red_engine_id)!;
      const blackEngine = engines.get(game.black_engine_id)!;

      const initialTimeMs = tournament.time_control_base * 1000;

      // Mark game as started and persist initial clocks for live spectators.
      queries.initializeGameStarted(gameId, initialTimeMs);

      // Emit game_start event
      this.emit("game_start", {
        type: "game_start",
        gameId,
        redEngine: redEngine.name,
        blackEngine: blackEngine.name,
        redTime: initialTimeMs,
        blackTime: initialTimeMs,
      });

      const matchConfig: MatchConfig = {
        redEnginePath: redEngine.binary_path,
        blackEnginePath: blackEngine.binary_path,
        timeBase: initialTimeMs, // DB stores seconds, UCI needs ms
        timeInc: tournament.time_control_inc * 1000,
        gameId,
      };

      const match = new Match(matchConfig);

      // Forward move events (add type field for WebSocket clients)
      match.on("move", (moveData) => {
        this.emit("move", { type: "move", ...moveData });
      });

      let result: MatchResult;
      try {
        result = await match.run();
      } catch {
        // If match throws, treat it as a draw (shouldn't normally happen)
        result = {
          result: "draw",
          reason: "Match error",
          moves: [],
          redTimeLeft: 0,
          blackTimeLeft: 0,
        };
      }

      // Update game result in DB
      queries.updateGameResult(
        gameId,
        result.result,
        JSON.stringify(result.moves),
        result.redTimeLeft,
        result.blackTimeLeft,
      );

      // Update Elo ratings
      const redEngineData = engines.get(game.red_engine_id)!;
      const blackEngineData = engines.get(game.black_engine_id)!;

      let scoreA: number; // red's score
      if (result.result === "red") {
        scoreA = 1;
      } else if (result.result === "black") {
        scoreA = 0;
      } else {
        scoreA = 0.5;
      }

      const [newRedElo, newBlackElo] = calculateElo(
        redEngineData.elo,
        blackEngineData.elo,
        scoreA,
      );

      // Update engine Elo in DB and local cache
      redEngineData.elo = Math.round(newRedElo);
      redEngineData.games_played++;
      queries.updateEngineElo(
        game.red_engine_id,
        redEngineData.elo,
        redEngineData.games_played,
      );

      blackEngineData.elo = Math.round(newBlackElo);
      blackEngineData.games_played++;
      queries.updateEngineElo(
        game.black_engine_id,
        blackEngineData.elo,
        blackEngineData.games_played,
      );

      // Update tournament scores
      const redScore = scores.get(game.red_engine_id)!;
      const blackScore = scores.get(game.black_engine_id)!;

      if (result.result === "red") {
        scores.set(game.red_engine_id, redScore + 1);
      } else if (result.result === "black") {
        scores.set(game.black_engine_id, blackScore + 1);
      } else {
        scores.set(game.red_engine_id, redScore + 0.5);
        scores.set(game.black_engine_id, blackScore + 0.5);
      }

      // Update entry scores in DB
      queries.updateTournamentEntry(
        this.tournamentId,
        game.red_engine_id,
        scores.get(game.red_engine_id)!,
      );
      queries.updateTournamentEntry(
        this.tournamentId,
        game.black_engine_id,
        scores.get(game.black_engine_id)!,
      );

      // Emit game_end
      this.emit("game_end", {
        type: "game_end",
        gameId,
        result: result.result,
      });
    }

    // Calculate final rankings (sort by score descending)
    const sortedEntries = [...scores.entries()].sort((a, b) => b[1] - a[1]);

    let rank = 1;
    for (let i = 0; i < sortedEntries.length; i++) {
      const [engineId, score] = sortedEntries[i];
      // Same score = same rank
      if (i > 0 && sortedEntries[i][1] < sortedEntries[i - 1][1]) {
        rank = i + 1;
      }
      queries.updateTournamentEntry(this.tournamentId, engineId, score, rank);
    }

    // Mark tournament as finished or cancelled
    if (this.aborted) {
      queries.updateTournamentStatus(this.tournamentId, "cancelled");
    } else {
      queries.updateTournamentStatus(this.tournamentId, "finished");
    }

    // Clean up registry
    unregisterRunner(this.tournamentId);

    // Emit tournament_end
    this.emit("tournament_end", { type: "tournament_end", tournamentId: this.tournamentId });
  }

  abort(): void {
    this.aborted = true;
  }
}

/**
 * Resume tournaments that were interrupted by a server restart.
 * Resets stuck games (started but not finished) and re-runs them.
 */
export function resumeRunningTournaments(hub: WsHub): void {
  const tournaments = getTournaments().filter((t) => t.status === "running");
  if (tournaments.length === 0) return;

  for (const t of tournaments) {
    // Reset any games that were mid-flight (started but no result)
    // so the runner will re-play them
    const games = queries.getGamesByTournament(t.id);
    for (const g of games) {
      if (g.started_at && !g.result) {
        queries.resetGameStarted(g.id);
        console.log(`[resume] Reset interrupted game ${g.id} for replay`);
      }
    }

    // Re-run: set back to pending so run() picks up unfinished games
    // Actually run() already handles existing games, just restart it
    console.log(`[resume] Resuming tournament "${t.name}" (${t.id})`);
    const runner = new TournamentRunner(t.id);
    registerRunner(t.id, runner);
    runner.on("move", (msg) => hub.broadcast(msg));
    runner.on("game_start", (msg) => hub.broadcast(msg));
    runner.on("game_end", (msg) => hub.broadcast(msg));
    runner.on("tournament_end", (msg) => hub.broadcast(msg));
    runner.run().catch((err) => console.error("[resume] Tournament error:", err));
  }
}
