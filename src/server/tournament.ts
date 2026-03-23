import { EventEmitter } from "events";
import { Match, type MatchConfig, type MatchResult } from "./match";
import { calculateElo } from "./elo";
import * as queries from "@/db/queries";
import type { Engine, Tournament, TournamentEntry } from "@/lib/types";

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

    // Generate pairings
    const pairings = generateRoundRobinPairings(engineIds, tournament.rounds);

    // Create Game records in DB for all pairings
    const gameIds: string[] = [];
    for (const pairing of pairings) {
      const game = queries.createGame(
        this.tournamentId,
        pairing.red,
        pairing.black,
      );
      gameIds.push(game.id);
    }

    // Track scores for each engine (tournament points: win=1, draw=0.5, loss=0)
    const scores = new Map<string, number>();
    for (const eid of engineIds) {
      scores.set(eid, 0);
    }

    // Run matches sequentially (respecting MAX_CONCURRENT_MATCHES = 1)
    for (let i = 0; i < pairings.length; i++) {
      if (this.aborted) break;

      const pairing = pairings[i];
      const gameId = gameIds[i];
      const redEngine = engines.get(pairing.red)!;
      const blackEngine = engines.get(pairing.black)!;

      // Mark game as started
      queries.updateGameStarted(gameId);

      // Emit game_start event
      this.emit("game_start", {
        gameId,
        redEngine: redEngine.name,
        blackEngine: blackEngine.name,
      });

      const matchConfig: MatchConfig = {
        redEnginePath: redEngine.binary_path,
        blackEnginePath: blackEngine.binary_path,
        timeBase: tournament.time_control_base * 1000, // DB stores seconds, UCI needs ms
        timeInc: tournament.time_control_inc * 1000,
        gameId,
      };

      const match = new Match(matchConfig);

      // Forward move events
      match.on("move", (moveData) => {
        this.emit("move", moveData);
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
      const redEngineData = engines.get(pairing.red)!;
      const blackEngineData = engines.get(pairing.black)!;

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
        pairing.red,
        redEngineData.elo,
        redEngineData.games_played,
      );

      blackEngineData.elo = Math.round(newBlackElo);
      blackEngineData.games_played++;
      queries.updateEngineElo(
        pairing.black,
        blackEngineData.elo,
        blackEngineData.games_played,
      );

      // Update tournament scores
      const redScore = scores.get(pairing.red)!;
      const blackScore = scores.get(pairing.black)!;

      if (result.result === "red") {
        scores.set(pairing.red, redScore + 1);
      } else if (result.result === "black") {
        scores.set(pairing.black, blackScore + 1);
      } else {
        scores.set(pairing.red, redScore + 0.5);
        scores.set(pairing.black, blackScore + 0.5);
      }

      // Update entry scores in DB
      queries.updateTournamentEntry(
        this.tournamentId,
        pairing.red,
        scores.get(pairing.red)!,
      );
      queries.updateTournamentEntry(
        this.tournamentId,
        pairing.black,
        scores.get(pairing.black)!,
      );

      // Emit game_end
      this.emit("game_end", {
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

    // Mark tournament as finished
    queries.updateTournamentStatus(this.tournamentId, "finished");

    // Emit tournament_end
    this.emit("tournament_end", { tournamentId: this.tournamentId });
  }

  abort(): void {
    this.aborted = true;
  }
}
