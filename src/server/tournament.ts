import { EventEmitter } from "events";
import path from "path";
import fs from "fs";
import { Match, type MatchConfig, type MatchResult } from "./match";
import { calculateElo } from "./elo";
import * as queries from "@/db/queries";
import { getTournaments } from "@/db/queries";
import type { Engine, Game, Tournament, TournamentEntry } from "@/lib/types";
import type { WsHub } from "./ws";
import { createStrategy } from "./strategies";
import type { RoundContext, Standing } from "./strategies";

// ---------------------------------------------------------------------------
// Pairing generation
// ---------------------------------------------------------------------------

export interface Pairing {
  red: string; // engine ID
  black: string; // engine ID
  startFen?: string;
}

/**
 * Generate round-robin pairings for a set of engines.
 * Each pair plays 2 games per round (swapping colors), ensuring perfect color
 * balance.  The final list is shuffled to eliminate systematic ordering bias.
 */
export function generateRoundRobinPairings(
  engineIds: string[],
  rounds: number,
  openingFens?: string[],
): Pairing[] {
  const pairings: Pairing[] = [];
  let fenIndex = 0;
  for (let i = 0; i < engineIds.length; i++) {
    for (let j = i + 1; j < engineIds.length; j++) {
      for (let r = 0; r < rounds; r++) {
        const fen = openingFens?.length
          ? openingFens[fenIndex++ % openingFens.length]
          : undefined;
        pairings.push({ red: engineIds[i], black: engineIds[j], startFen: fen });
        pairings.push({ red: engineIds[j], black: engineIds[i], startFen: fen });
      }
    }
  }
  // Fisher-Yates shuffle to eliminate systematic bias
  for (let i = pairings.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairings[i], pairings[j]] = [pairings[j], pairings[i]];
  }
  return pairings;
}

export function loadOpeningFens(): string[] {
  const filePath = path.join(process.cwd(), "data", "openings.txt");
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));
}

// ---------------------------------------------------------------------------
// Tournament runner
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_MATCHES = Math.max(1, parseInt(process.env.MAX_CONCURRENT_MATCHES || "1", 10));

// ---------------------------------------------------------------------------
// Semaphore — limits how many matches run concurrently
// ---------------------------------------------------------------------------

class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}

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

  // ── Elo mutex — prevents concurrent Elo read-modify-write races ──────────
  private static eloMutex = { locked: false, queue: [] as (() => void)[] };

  private static async withEloLock<T>(fn: () => T): Promise<T> {
    while (TournamentRunner.eloMutex.locked) {
      await new Promise<void>((resolve) =>
        TournamentRunner.eloMutex.queue.push(resolve),
      );
    }
    TournamentRunner.eloMutex.locked = true;
    try {
      return fn();
    } finally {
      TournamentRunner.eloMutex.locked = false;
      const next = TournamentRunner.eloMutex.queue.shift();
      if (next) next();
    }
  }

  constructor(tournamentId: string) {
    super();
    this.tournamentId = tournamentId;
  }

  /**
   * Run a single game from start to finish, updating the DB, Elo ratings,
   * tournament scores, and emitting WebSocket events.
   *
   * The Elo/scores update block is protected by a class-level mutex so that
   * concurrent invocations of this method do not race on read-modify-write
   * operations against the shared in-memory `engines` and `scores` maps.
   */
  private async runOneGame(
    game: {
      id: string;
      red_engine_id: string;
      black_engine_id: string;
      opening_fen: string | null;
      result?: string | null;
    },
    engines: Map<string, Engine>,
    scores: Map<string, number>,
    tournament: Tournament,
  ): Promise<void> {
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
      startFen: game.opening_fen || undefined,
    });

    const matchConfig: MatchConfig = {
      redEnginePath: redEngine.binary_path,
      blackEnginePath: blackEngine.binary_path,
      timeBase: initialTimeMs, // DB stores seconds, UCI needs ms
      timeInc: tournament.time_control_inc * 1000,
      gameId,
      startFen: game.opening_fen || undefined,
    };

    const match = new Match(matchConfig);

    // Forward move events (add type field for WebSocket clients)
    match.on("move", (moveData) => {
      this.emit("move", { type: "move", ...moveData });
    });

    // Forward engine thinking events (subscribers only — high frequency)
    match.on("engine_thinking", (data) => {
      this.emit("engine_thinking", { type: "engine_thinking", ...data });
    });

    let result: MatchResult;
    try {
      result = await match.run();
    } catch (err) {
      console.error(`[tournament] Match ${gameId} threw:`, err);
      result = {
        result: "draw",
        reason: "Internal error",
        moves: [],
        redTimeLeft: 0,
        blackTimeLeft: 0,
      };
    }

    // Update game result in DB (safe to call concurrently — each game has its own row)
    queries.updateGameResult(
      gameId,
      result.result,
      result.reason,
      JSON.stringify(result.moves),
      result.redTimeLeft,
      result.blackTimeLeft,
    );

    // Update Elo ratings and tournament scores (mutex-protected for concurrent safety)
    await TournamentRunner.withEloLock(() => {
      const redEngineData = engines.get(game.red_engine_id)!;
      const blackEngineData = engines.get(game.black_engine_id)!;

      // Re-read current Elo values from in-memory cache (may have been updated
      // by another game that finished while this one was playing).
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
        redEngineData.games_played,
        blackEngineData.games_played,
      );

      // Update engine Elo and W/L/D in DB and local cache
      redEngineData.elo = Math.round(newRedElo);
      redEngineData.games_played++;
      const redDelta = {
        wins: result.result === "red" ? 1 : 0,
        losses: result.result === "black" ? 1 : 0,
        draws: result.result === "draw" ? 1 : 0,
      };
      queries.updateEngineElo(
        game.red_engine_id,
        redEngineData.elo,
        redEngineData.games_played,
        redDelta,
      );

      blackEngineData.elo = Math.round(newBlackElo);
      blackEngineData.games_played++;
      const blackDelta = {
        wins: result.result === "black" ? 1 : 0,
        losses: result.result === "red" ? 1 : 0,
        draws: result.result === "draw" ? 1 : 0,
      };
      queries.updateEngineElo(
        game.black_engine_id,
        blackEngineData.elo,
        blackEngineData.games_played,
        blackDelta,
      );

      // Record Elo history snapshots (new Elo values already assigned above)
      queries.recordEloSnapshot(game.red_engine_id, redEngineData.elo, gameId);
      queries.recordEloSnapshot(game.black_engine_id, blackEngineData.elo, gameId);

      // Update tournament scores (inside the lock — shared mutable map)
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

      // Persist updated entry scores to DB
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
    });

    // Emit game_end
    this.emit("game_end", {
      type: "game_end",
      gameId,
      result: result.result,
      reason: result.reason,
    });
  }

  private async runGamesWithConcurrency(
    games: Game[],
    engines: Map<string, Engine>,
    scores: Map<string, number>,
    tournament: Tournament,
  ): Promise<void> {
    const sem = new Semaphore(MAX_CONCURRENT_MATCHES);
    const promises = games
      .filter((g) => !g.result)
      .map(async (game) => {
        if (this.aborted) return;
        await sem.acquire();
        try {
          if (this.aborted) return;
          await this.runOneGame(game, engines, scores, tournament);
        } finally {
          sem.release();
        }
      });
    await Promise.all(promises);
  }

  private computeScores(games: Game[], engineIds: string[]): Map<string, number> {
    const scores = new Map<string, number>();
    for (const eid of engineIds) scores.set(eid, 0);
    for (const g of games) {
      if (g.result === "red") {
        scores.set(g.red_engine_id, (scores.get(g.red_engine_id) ?? 0) + 1);
      } else if (g.result === "black") {
        scores.set(g.black_engine_id, (scores.get(g.black_engine_id) ?? 0) + 1);
      } else if (g.result === "draw") {
        scores.set(g.red_engine_id, (scores.get(g.red_engine_id) ?? 0) + 0.5);
        scores.set(g.black_engine_id, (scores.get(g.black_engine_id) ?? 0) + 0.5);
      }
    }
    return scores;
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

    const openingFens = loadOpeningFens();
    const format = (tournament as Tournament & { format?: string }).format || "round_robin";
    const strategy = createStrategy(format as "round_robin" | "knockout" | "gauntlet" | "swiss");

    // Check for existing games (resume after restart) or create new ones
    let existingGames = queries.getGamesByTournament(this.tournamentId);

    if (strategy.isRoundBased()) {
      // --- Round-based execution (knockout, swiss) ---
      const scores = this.computeScores(existingGames, engineIds);
      const totalRounds = format === "knockout"
        ? Math.ceil(Math.log2(engineIds.length))
        : tournament.rounds;

      // Determine which round we're on by counting completed rounds
      let currentRound = 1;
      if (existingGames.length > 0) {
        const maxRound = Math.max(...existingGames.map(g => (g as Game & { round?: number }).round ?? 1));
        const allInRoundDone = existingGames
          .filter(g => (g as Game & { round?: number }).round === maxRound)
          .every(g => g.result);
        currentRound = allInRoundDone ? maxRound + 1 : maxRound;
      }

      for (let round = currentRound; round <= totalRounds; round++) {
        if (this.aborted) break;

        // Check if this round's games already exist (resume)
        let roundGames = existingGames.filter(g => (g as Game & { round?: number }).round === round);

        if (roundGames.length === 0) {
          // Generate pairings for this round
          const completedGames = existingGames
            .filter(g => g.result)
            .map(g => ({ redId: g.red_engine_id, blackId: g.black_engine_id, result: g.result! }));

          const standings: Standing[] = engineIds.map(eid => ({
            engineId: eid,
            score: scores.get(eid) ?? 0,
            wins: completedGames.filter(g => (g.redId === eid && g.result === "red") || (g.blackId === eid && g.result === "black")).length,
            losses: completedGames.filter(g => (g.redId === eid && g.result === "black") || (g.blackId === eid && g.result === "red")).length,
            draws: completedGames.filter(g => (g.redId === eid || g.blackId === eid) && g.result === "draw").length,
            opponents: completedGames.filter(g => g.redId === eid || g.blackId === eid).map(g => g.redId === eid ? g.blackId : g.redId),
            colorHistory: completedGames.filter(g => g.redId === eid || g.blackId === eid).map(g => g.redId === eid ? "red" as const : "black" as const),
          }));

          const context: RoundContext = {
            round,
            totalRounds,
            engineIds,
            standings,
            completedGames,
            openingFens: openingFens.length > 0 ? openingFens : undefined,
          };

          const pairings = strategy.generateNextRound!(context);
          if (!pairings || pairings.length === 0) break; // Tournament complete

          for (const p of pairings) {
            queries.createGame(this.tournamentId, p.red, p.black, p.startFen);
          }
          existingGames = queries.getGamesByTournament(this.tournamentId);
          roundGames = existingGames.filter(g => !g.result);
        }

        await this.runGamesWithConcurrency(roundGames, engines, scores, tournament);

        // Refresh scores after round
        existingGames = queries.getGamesByTournament(this.tournamentId);
        const updatedScores = this.computeScores(existingGames, engineIds);
        for (const [k, v] of updatedScores) scores.set(k, v);
      }

      // Final rankings
      const sortedEntries = [...scores.entries()].sort((a, b) => b[1] - a[1]);
      let rank = 1;
      for (let i = 0; i < sortedEntries.length; i++) {
        const [engineId, score] = sortedEntries[i];
        if (i > 0 && sortedEntries[i][1] < sortedEntries[i - 1][1]) rank = i + 1;
        queries.updateTournamentEntry(this.tournamentId, engineId, score, rank);
      }
    } else {
      // --- Batch execution (round_robin, gauntlet) ---
      if (existingGames.length === 0) {
        const challengerEngineId = format === "gauntlet"
          ? (queries.getFirstTournamentEngine(this.tournamentId) ?? engineIds[0])
          : undefined;
        const pairings = strategy.generateAllPairings!(engineIds, {
          rounds: tournament.rounds,
          openingFens: openingFens.length > 0 ? openingFens : undefined,
          challengerEngineId,
        });
        for (const pairing of pairings) {
          queries.createGame(this.tournamentId, pairing.red, pairing.black, pairing.startFen);
        }
        existingGames = queries.getGamesByTournament(this.tournamentId);
      }

      const scores = this.computeScores(existingGames, engineIds);

      await this.runGamesWithConcurrency(existingGames, engines, scores, tournament);

      // Calculate final rankings
      const sortedEntries = [...scores.entries()].sort((a, b) => b[1] - a[1]);
      let rank = 1;
      for (let i = 0; i < sortedEntries.length; i++) {
        const [engineId, score] = sortedEntries[i];
        if (i > 0 && sortedEntries[i][1] < sortedEntries[i - 1][1]) rank = i + 1;
        queries.updateTournamentEntry(this.tournamentId, engineId, score, rank);
      }
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
    runner.on("engine_thinking", (msg) => hub.broadcast(msg, true));
    runner.run().catch((err) => console.error("[resume] Tournament error:", err));
  }
}
