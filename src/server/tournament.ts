import { EventEmitter } from "events";
import path from "path";
import fs from "fs";
import { Match, type MatchConfig, type MatchResult } from "./match";
import { calculateElo } from "./elo";
import { buildStaticVerdict } from "./judge";
import * as queries from "@/db/queries";
import { getTournaments } from "@/db/queries";
import type { Engine, Game, Tournament } from "@/lib/types";
import type { WsHub } from "./ws";
import { createStrategy } from "./strategies";
import type { RoundContext, Standing, BracketData } from "./strategies";
import { KnockoutStrategy } from "./strategies";
import type { ResultReport } from "./distributed/types";
import { getLeaseManager } from "./distributed/lease-manager";
import { cleanupSandboxTournamentResources } from "./sandbox";

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

const MAX_CONCURRENT_MATCHES = Math.max(1, parseInt(process.env.MAX_CONCURRENT_MATCHES || "2", 10));

// Global semaphore — limits total concurrent matches across ALL tournaments
const globalMatchSemaphore = new Semaphore(MAX_CONCURRENT_MATCHES);
console.log(`[tournament] Global match concurrency: ${MAX_CONCURRENT_MATCHES}`);

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
  private sandbox = false;

  // Instance-level engine and score maps, accessible by applyRemoteResult
  private engines = new Map<string, Engine>();
  private scores = new Map<string, number>();

  // ── Elo mutex — prevents concurrent Elo read-modify-write races ──────────
  private static eloMutex = { locked: false, queue: [] as (() => void)[] };

  static async withEloLock<T>(fn: () => T): Promise<T> {
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
   * Apply a game result reported by a remote worker.
   * Updates Elo, scores, and emits game_end — same logic as runOneGame post-match.
   */
  applyRemoteResult(gameId: string, report: ResultReport): void {
    const game = queries.getGameById(gameId);
    if (!game) return;

    // Emit game_end event → WebSocket broadcast
    this.emit("game_end", {
      type: "game_end",
      gameId,
      tournamentId: this.tournamentId,
      redEngineId: game.red_engine_id,
      blackEngineId: game.black_engine_id,
      result: report.result,
      code: report.code,
      reason: report.reason,
      detail: report.detail,
    });

    // Elo update — skip for sandbox
    if (!this.sandbox) {
      const redEngineData = this.engines.get(game.red_engine_id);
      const blackEngineData = this.engines.get(game.black_engine_id);
      if (redEngineData && blackEngineData) {
        const scoreA =
          report.result === "red" ? 1 : report.result === "black" ? 0 : 0.5;
        const [newRedElo, newBlackElo] = calculateElo(
          redEngineData.elo, blackEngineData.elo, scoreA,
          redEngineData.games_played, blackEngineData.games_played,
        );
        redEngineData.elo = Math.round(newRedElo);
        redEngineData.games_played++;
        queries.updateEngineElo(game.red_engine_id, redEngineData.elo, redEngineData.games_played, {
          wins: report.result === "red" ? 1 : 0, losses: report.result === "black" ? 1 : 0, draws: report.result === "draw" ? 1 : 0,
        });
        blackEngineData.elo = Math.round(newBlackElo);
        blackEngineData.games_played++;
        queries.updateEngineElo(game.black_engine_id, blackEngineData.elo, blackEngineData.games_played, {
          wins: report.result === "black" ? 1 : 0, losses: report.result === "red" ? 1 : 0, draws: report.result === "draw" ? 1 : 0,
        });
        queries.recordEloSnapshot(game.red_engine_id, redEngineData.elo, gameId);
        queries.recordEloSnapshot(game.black_engine_id, blackEngineData.elo, gameId);
      }
    }

    // Tournament scores — always tracked
    const redScore = this.scores.get(game.red_engine_id) ?? 0;
    const blackScore = this.scores.get(game.black_engine_id) ?? 0;
    if (report.result === "red") {
      this.scores.set(game.red_engine_id, redScore + 1);
    } else if (report.result === "black") {
      this.scores.set(game.black_engine_id, blackScore + 1);
    } else {
      this.scores.set(game.red_engine_id, redScore + 0.5);
      this.scores.set(game.black_engine_id, blackScore + 0.5);
    }

    queries.updateTournamentEntry(this.tournamentId, game.red_engine_id, this.scores.get(game.red_engine_id)!);
    queries.updateTournamentEntry(this.tournamentId, game.black_engine_id, this.scores.get(game.black_engine_id)!);
  }

  /** Emit an event from a remote worker (move, thinking, game_start, etc.) for WebSocket broadcast. */
  emitRemoteEvent(event: string, data: Record<string, unknown>): void {
    this.emit(event, data);
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
    tournament: Tournament,
  ): Promise<void> {
    const gameId = game.id;
    const redEngine = this.engines.get(game.red_engine_id)!;
    const blackEngine = this.engines.get(game.black_engine_id)!;

    const initialTimeMs = tournament.time_control_base * 1000;

    // Mark game as started and persist initial clocks for live spectators.
    queries.initializeGameStarted(gameId, initialTimeMs);

    // Emit game_start event
    this.emit("game_start", {
      type: "game_start",
      gameId,
      tournamentId: this.tournamentId,
      redEngineId: game.red_engine_id,
      blackEngineId: game.black_engine_id,
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
      const verdict = buildStaticVerdict("draw", "internal_error");
      result = {
        result: verdict.result,
        code: verdict.code,
        reason: verdict.reason,
        detail: verdict.detail,
        moves: [],
        redTimeLeft: 0,
        blackTimeLeft: 0,
      };
    }

    // Update game result in DB (safe to call concurrently — each game has its own row)
    queries.updateGameResult(
      gameId,
      result.result,
      result.code,
      result.reason,
      result.detail,
      JSON.stringify(result.moves),
      result.redTimeLeft,
      result.blackTimeLeft,
    );

    // Update Elo ratings and tournament scores (mutex-protected for concurrent safety)
    await TournamentRunner.withEloLock(() => {
      // Elo/W-L-D updates — skip for sandbox tournaments
      if (!this.sandbox) {
        const redEngineData = this.engines.get(game.red_engine_id)!;
        const blackEngineData = this.engines.get(game.black_engine_id)!;

        let scoreA: number;
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

        queries.recordEloSnapshot(game.red_engine_id, redEngineData.elo, gameId);
        queries.recordEloSnapshot(game.black_engine_id, blackEngineData.elo, gameId);
      }

      // Tournament scores — always tracked (needed for rankings/CLI output)
      const redScore = this.scores.get(game.red_engine_id) ?? 0;
      const blackScore = this.scores.get(game.black_engine_id) ?? 0;

      if (result.result === "red") {
        this.scores.set(game.red_engine_id, redScore + 1);
      } else if (result.result === "black") {
        this.scores.set(game.black_engine_id, blackScore + 1);
      } else {
        this.scores.set(game.red_engine_id, redScore + 0.5);
        this.scores.set(game.black_engine_id, blackScore + 0.5);
      }

      queries.updateTournamentEntry(
        this.tournamentId,
        game.red_engine_id,
        this.scores.get(game.red_engine_id)!,
      );
      queries.updateTournamentEntry(
        this.tournamentId,
        game.black_engine_id,
        this.scores.get(game.black_engine_id)!,
      );
    });

    // Emit game_end
    this.emit("game_end", {
      type: "game_end",
      gameId,
      tournamentId: this.tournamentId,
      redEngineId: game.red_engine_id,
      blackEngineId: game.black_engine_id,
      result: result.result,
      code: result.code,
      reason: result.reason,
      detail: result.detail,
    });
  }

  private async runGamesWithConcurrency(
    games: Game[],
    tournament: Tournament,
  ): Promise<void> {
    const unfinished = games.filter((g) => !g.result);
    if (unfinished.length === 0) return;

    const distributed = !!process.env.WORKER_SECRET;

    const promises = unfinished.map(async (game) => {
      if (this.aborted) return;
      await globalMatchSemaphore.acquire();
      try {
        if (this.aborted) return;
        // In distributed mode, skip games already claimed by a worker
        if (distributed) {
          const fresh = queries.getGameById(game.id);
          if (fresh?.result || fresh?.started_at) return;
        }
        await this.runOneGame(game, tournament);
      } finally {
        globalMatchSemaphore.release();
      }
    });
    await Promise.all(promises);

    // In distributed mode, wait for worker-executed games to complete
    if (distributed) {
      await this.waitForAllGamesComplete(unfinished.map((g) => g.id));
    }
  }

  /**
   * Poll DB until all given games have results (for worker-dispatched games).
   * Recovers orphaned games: if a game has started_at but no result and no
   * active lease, reset it so a worker (or the next poll cycle) can pick it up.
   */
  private async waitForAllGamesComplete(gameIds: string[]): Promise<void> {
    const POLL_INTERVAL = 2000;
    const leaseMgr = getLeaseManager();

    while (!this.aborted) {
      let allDone = true;

      for (const id of gameIds) {
        const g = queries.getGameById(id);
        if (g?.result != null) continue; // done
        allDone = false;

        // Orphan detection: game is started but nobody is running it
        if (g?.started_at && !leaseMgr.hasActiveLease(id)) {
          console.log(`[distributed] Recovering orphaned game ${id} — resetting for re-dispatch`);
          queries.resetGameStarted(id);
        }
      }

      if (allDone) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
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

    // Track sandbox mode
    this.sandbox = !!tournament.sandbox;

    // Mark tournament as running
    queries.updateTournamentStatus(this.tournamentId, "running");

    // Get entries and build engine lookup
    const entries = queries.getTournamentEntries(this.tournamentId);
    const engineIds = entries.map((e) => e.engine_id);

    if (engineIds.length < 2) {
      throw new Error("Tournament needs at least 2 engines");
    }

    // Build engine lookup (id -> Engine) on instance for distributed access
    this.engines = new Map<string, Engine>();
    for (const eid of engineIds) {
      const engine = queries.getEngineById(eid);
      if (!engine) {
        throw new Error(`Engine ${eid} not found`);
      }
      this.engines.set(eid, engine);
    }

    const openingFens = loadOpeningFens();
    const format = (tournament as Tournament & { format?: string }).format || "round_robin";
    const strategy = createStrategy(format as "round_robin" | "knockout" | "gauntlet" | "swiss");

    // Check for existing games (resume after restart) or create new ones
    let existingGames = queries.getGamesByTournament(this.tournamentId);

    if (strategy instanceof KnockoutStrategy) {
      // --- Bracket-based execution (knockout) ---
      await this.runBracketKnockout(strategy, engineIds, tournament, openingFens, existingGames);
    } else if (strategy.isRoundBased()) {
      // --- Round-based execution (swiss) ---
      await this.runRoundBased(strategy, engineIds, tournament, openingFens, existingGames);
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

      this.scores = this.computeScores(existingGames, engineIds);

      await this.runGamesWithConcurrency(existingGames, tournament);

      // Calculate final rankings
      const sortedEntries = [...this.scores.entries()].sort((a, b) => b[1] - a[1]);
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

    // Sandbox auto-cleanup: delete all games, entries, and the tournament itself
    if (this.sandbox) {
      console.log(`[sandbox] Cleaning up sandbox tournament ${this.tournamentId}`);
      cleanupSandboxTournamentResources(this.tournamentId);
      console.log(`[sandbox] Cleanup complete for ${this.tournamentId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Bracket-based knockout execution
  // ---------------------------------------------------------------------------

  private async runBracketKnockout(
    knockout: KnockoutStrategy,
    engineIds: string[],
    tournament: Tournament,
    openingFens: string[],
    existingGames: Game[],
  ): Promise<void> {
    this.scores = this.computeScores(existingGames, engineIds);

    // Load or create bracket
    let bracket: BracketData;
    if (tournament.bracket_data) {
      bracket = JSON.parse(tournament.bracket_data) as BracketData;
    } else {
      // Seed by Elo descending — strongest engine = seed 1
      const seededIds = [...engineIds].sort((a, b) => {
        const eloA = this.engines.get(a)?.elo ?? 0;
        const eloB = this.engines.get(b)?.elo ?? 0;
        return eloB - eloA;
      });
      bracket = knockout.initBracket(seededIds);
      queries.updateTournamentBracket(this.tournamentId, JSON.stringify(bracket));
    }

    // Sync phase: recover from crashes between game completion and bracket persist.
    // 1) Match bracket gameIds to completed games that weren't resolved
    const allGames = queries.getGamesByTournament(this.tournamentId);
    const gameMap = new Map(allGames.map((g) => [g.id, g]));

    // Purge phantom gameIds: bracket references games that no longer exist in DB.
    // This can happen when the server crashes after persisting bracket but before
    // the DB transaction commits, or if the WAL file was lost.
    for (const match of bracket.matches) {
      if (match.isBye || match.gameIds.length === 0) continue;
      const validIds = match.gameIds.filter((id) => gameMap.has(id));
      if (validIds.length !== match.gameIds.length) {
        console.log(
          `[bracket-sync] Match round=${match.round} pos=${match.position}: purged ${match.gameIds.length - validIds.length} phantom gameId(s)`,
        );
        match.gameIds = validIds;
      }
    }

    // Orphan recovery: games in DB not referenced by any bracket match
    const referencedIds = new Set(bracket.matches.flatMap((m) => m.gameIds));
    const orphanGames = allGames.filter((g) => !referencedIds.has(g.id));
    if (orphanGames.length > 0) {
      for (const og of orphanGames) {
        // Match orphan to bracket slot by engineA/engineB + round
        // A match can hold up to 3 gameIds (2 regular + 1 decider)
        const match = bracket.matches.find(
          (m) =>
            !m.isBye &&
            m.winner === null &&
            m.gameIds.length < 3 &&
            m.round === og.round &&
            m.engineA &&
            m.engineB &&
            ((og.red_engine_id === m.engineA && og.black_engine_id === m.engineB) ||
              (og.red_engine_id === m.engineB && og.black_engine_id === m.engineA)),
        );
        if (match && !match.gameIds.includes(og.id)) {
          match.gameIds.push(og.id);
        }
      }
    }

    // Resolve matches with all games completed but no winner
    for (const match of bracket.matches) {
      if (match.winner || match.isBye || match.gameIds.length < 2) continue;
      const matchGames = match.gameIds.map((id) => gameMap.get(id)).filter(Boolean) as Game[];
      if (matchGames.length < 2) continue; // not enough valid games to determine winner
      if (matchGames.every((g) => g.result)) {
        const { winner, tiebreak } = knockout.determineMatchWinner(
          match,
          matchGames.map((g) => ({ result: g.result!, redId: g.red_engine_id, blackId: g.black_engine_id })),
          bracket.seeds,
        );
        if (winner) {
          knockout.resolveMatch(bracket, match.round, match.position, winner, tiebreak);
        }
        // winner === null means needs decider — handled in main loop
      }
    }
    queries.updateTournamentBracket(this.tournamentId, JSON.stringify(bracket));

    // Main execution loop
    let fenIndex = 0;
    let prevBracketSnapshot = "";
    while (!this.aborted && !knockout.isComplete(bracket)) {
      const readyMatches = knockout.getReadyMatches(bracket);
      const unresolvedMatches = knockout.getUnresolvedMatches(bracket);

      // Also find matches that need a decider game
      const deciderMatches = bracket.matches.filter((m) => knockout.needsDecider(m));

      if (readyMatches.length === 0 && unresolvedMatches.length === 0 && deciderMatches.length === 0) break;

      // Stall detection: if bracket state hasn't changed and there are no new
      // games to run, the loop would spin forever. Break to avoid freezing.
      const snapshot = JSON.stringify(bracket.matches.map((m) => [m.winner, m.gameIds.length]));
      if (snapshot === prevBracketSnapshot && readyMatches.length === 0 && deciderMatches.length === 0) {
        console.error(
          `[bracket] Stall detected: unresolved matches but no progress possible. Breaking.`,
        );
        break;
      }
      prevBracketSnapshot = snapshot;

      // Create 2 regular games for new matches
      for (const match of readyMatches) {
        const fen = openingFens.length > 0
          ? openingFens[fenIndex++ % openingFens.length]
          : undefined;

        const game1 = queries.createGame(
          this.tournamentId, match.engineA!, match.engineB!, fen, match.round,
        );
        const game2 = queries.createGame(
          this.tournamentId, match.engineB!, match.engineA!, fen, match.round,
        );
        match.gameIds = [game1.id, game2.id];
      }

      // Create 1 decider game for tied matches (lower seed = red)
      for (const match of deciderMatches) {
        const { red, black } = knockout.getDeciderColors(match, bracket.seeds);
        const deciderGame = queries.createGame(
          this.tournamentId, red, black, undefined, match.round,
        );
        match.gameIds.push(deciderGame.id);
      }

      queries.updateTournamentBracket(this.tournamentId, JSON.stringify(bracket));

      // Collect all unfinished games from ready + unresolved + decider matches
      const activeMatches = [...readyMatches, ...unresolvedMatches, ...deciderMatches];
      const allMatchGameIds = activeMatches.flatMap((m) => m.gameIds);
      const gamesToRun = allMatchGameIds
        .map((id) => queries.getGameById(id)!)
        .filter((g) => g && !g.result);

      if (gamesToRun.length > 0) {
        await this.runGamesWithConcurrency(gamesToRun, tournament);
      }

      // Resolve completed matches and propagate winners
      const freshGames = queries.getGamesByTournament(this.tournamentId);
      const freshMap = new Map(freshGames.map((g) => [g.id, g]));

      for (const match of bracket.matches) {
        if (match.winner || match.isBye || match.gameIds.length < 2) continue;
        const matchGames = match.gameIds.map((id) => freshMap.get(id)).filter(Boolean) as Game[];
        if (matchGames.length < 2) continue; // not enough valid games to determine winner
        if (!matchGames.every((g) => g.result)) continue;

        const { winner, tiebreak } = knockout.determineMatchWinner(
          match,
          matchGames.map((g) => ({ result: g.result!, redId: g.red_engine_id, blackId: g.black_engine_id })),
          bracket.seeds,
        );
        if (winner) {
          knockout.resolveMatch(bracket, match.round, match.position, winner, tiebreak);
        }
        // winner === null → needsDecider will catch it next iteration
      }
      queries.updateTournamentBracket(this.tournamentId, JSON.stringify(bracket));
    }

    // Final rankings from bracket
    const rankings = knockout.getRankings(bracket);
    for (const [engineId, rank] of rankings) {
      const score = this.scores.get(engineId) ?? 0;
      queries.updateTournamentEntry(this.tournamentId, engineId, score, rank);
    }
  }

  // ---------------------------------------------------------------------------
  // Round-based execution (swiss) — preserved from original code
  // ---------------------------------------------------------------------------

  private async runRoundBased(
    strategy: { generateNextRound?(context: RoundContext): Pairing[] | null },
    engineIds: string[],
    tournament: Tournament,
    openingFens: string[],
    existingGames: Game[],
  ): Promise<void> {
    this.scores = this.computeScores(existingGames, engineIds);
    const totalRounds = tournament.rounds;

    let currentRound = 1;
    if (existingGames.length > 0) {
      const maxRound = Math.max(...existingGames.map((g) => g.round ?? 1));
      const allInRoundDone = existingGames
        .filter((g) => g.round === maxRound)
        .every((g) => g.result);
      currentRound = allInRoundDone ? maxRound + 1 : maxRound;
    }

    for (let round = currentRound; round <= totalRounds; round++) {
      if (this.aborted) break;

      let roundGames = existingGames.filter((g) => g.round === round);

      if (roundGames.length === 0) {
        const completedGames = existingGames
          .filter((g) => g.result)
          .map((g) => ({ redId: g.red_engine_id, blackId: g.black_engine_id, result: g.result! }));

        const standings: Standing[] = engineIds.map((eid) => ({
          engineId: eid,
          score: this.scores.get(eid) ?? 0,
          wins: completedGames.filter((g) => (g.redId === eid && g.result === "red") || (g.blackId === eid && g.result === "black")).length,
          losses: completedGames.filter((g) => (g.redId === eid && g.result === "black") || (g.blackId === eid && g.result === "red")).length,
          draws: completedGames.filter((g) => (g.redId === eid || g.blackId === eid) && g.result === "draw").length,
          opponents: completedGames.filter((g) => g.redId === eid || g.blackId === eid).map((g) => g.redId === eid ? g.blackId : g.redId),
          colorHistory: completedGames.filter((g) => g.redId === eid || g.blackId === eid).map((g) => g.redId === eid ? "red" as const : "black" as const),
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
        if (!pairings || pairings.length === 0) break;

        for (const p of pairings) {
          queries.createGame(this.tournamentId, p.red, p.black, p.startFen, round);
        }
        existingGames = queries.getGamesByTournament(this.tournamentId);
        roundGames = existingGames.filter((g) => !g.result);
      }

      await this.runGamesWithConcurrency(roundGames, tournament);

      existingGames = queries.getGamesByTournament(this.tournamentId);
      const updatedScores = this.computeScores(existingGames, engineIds);
      for (const [k, v] of updatedScores) this.scores.set(k, v);
    }

    // Final rankings
    const sortedEntries = [...this.scores.entries()].sort((a, b) => b[1] - a[1]);
    let rank = 1;
    for (let i = 0; i < sortedEntries.length; i++) {
      const [engineId, score] = sortedEntries[i];
      if (i > 0 && sortedEntries[i][1] < sortedEntries[i - 1][1]) rank = i + 1;
      queries.updateTournamentEntry(this.tournamentId, engineId, score, rank);
    }
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
