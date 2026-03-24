import type { Pairing } from "../tournament";

export type TournamentFormat = "round_robin" | "knockout" | "gauntlet" | "swiss";

export interface PairingConfig {
  rounds: number;
  openingFens?: string[];
  challengerEngineId?: string; // gauntlet: first engine is the challenger
}

export interface Standing {
  engineId: string;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  opponents: string[];
  colorHistory: ("red" | "black")[];
}

/**
 * Strategy interface for tournament formats.
 *
 * Batch formats (round-robin, gauntlet) generate all pairings upfront.
 * Round-based formats (knockout, swiss) generate pairings one round at a time.
 */
export interface TournamentStrategy {
  readonly format: TournamentFormat;

  /** Batch mode: generate all pairings at once. Returns null if this format is round-based. */
  generateAllPairings?(engineIds: string[], config: PairingConfig): Pairing[];

  /** Round mode: generate pairings for the next round based on current standings. Returns null when tournament is over. */
  generateNextRound?(context: RoundContext): Pairing[] | null;

  /** True if this format uses round-by-round generation (knockout, swiss). */
  isRoundBased(): boolean;
}

export interface RoundContext {
  round: number;
  totalRounds: number;
  engineIds: string[];
  standings: Standing[];
  completedGames: { redId: string; blackId: string; result: "red" | "black" | "draw" }[];
  openingFens?: string[];
}
