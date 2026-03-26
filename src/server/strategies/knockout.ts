import type { TournamentStrategy, TournamentFormat, BracketData, BracketMatch } from "./types";

/**
 * Knockout (single elimination) with persistent bracket tree.
 *
 * The bracket is a complete binary tree stored as a flat array of BracketMatch.
 * Each matchup = 2 games (swapping colors). Tie → higher seed advances.
 *
 * Classic seeding ensures seed 1 and seed 2 are in opposite halves and can
 * only meet in the final. Byes go to the top seeds when the engine count
 * is not a power of 2.
 */
export class KnockoutStrategy implements TournamentStrategy {
  readonly format: TournamentFormat = "knockout";

  isRoundBased(): boolean {
    return true;
  }

  isBracketBased(): boolean {
    return true;
  }

  // ---------------------------------------------------------------------------
  // Bracket lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create a full bracket tree for the given engines (ordered by seed).
   * Bye slots are resolved and propagated immediately.
   */
  initBracket(engineIds: string[]): BracketData {
    const n = engineIds.length;
    if (n < 2) throw new Error("Need at least 2 engines for knockout");

    const totalRounds = Math.ceil(Math.log2(n));
    const bracketSize = Math.pow(2, totalRounds);
    const seedPositions = generateBracketPositions(bracketSize);

    const matches: BracketMatch[] = [];

    // Round 1: map seed positions to engines
    for (let p = 0; p < bracketSize / 2; p++) {
      const seedIdxA = seedPositions[p * 2];     // 0-based seed index
      const seedIdxB = seedPositions[p * 2 + 1];
      const engineA = seedIdxA < n ? engineIds[seedIdxA] : null;
      const engineB = seedIdxB < n ? engineIds[seedIdxB] : null;
      const isBye = engineA === null || engineB === null;
      const winner = isBye ? (engineA ?? engineB) : null;

      matches.push({
        round: 1, position: p,
        engineA, engineB, winner, isBye, tiebreak: false, gameIds: [],
      });
    }

    // Subsequent rounds: empty slots
    for (let r = 2; r <= totalRounds; r++) {
      const count = bracketSize / Math.pow(2, r);
      for (let p = 0; p < count; p++) {
        matches.push({
          round: r, position: p,
          engineA: null, engineB: null, winner: null,
          isBye: false, tiebreak: false, gameIds: [],
        });
      }
    }

    // Propagate bye winners (may cascade)
    propagateAllWinners(matches, totalRounds);

    return { bracketSize, totalRounds, seeds: engineIds, matches };
  }

  /**
   * Return matches that are ready to play: both engines known, not a bye,
   * no winner yet, and no games created yet.
   */
  getReadyMatches(bracket: BracketData): BracketMatch[] {
    return bracket.matches.filter(
      (m) => m.engineA !== null && m.engineB !== null
        && !m.isBye && m.winner === null && m.gameIds.length === 0,
    );
  }

  /**
   * Return matches that have games created but no winner resolved yet.
   */
  getUnresolvedMatches(bracket: BracketData): BracketMatch[] {
    return bracket.matches.filter(
      (m) => m.gameIds.length > 0 && m.winner === null && !m.isBye,
    );
  }

  /**
   * Set the winner of a match and propagate to the next round.
   */
  resolveMatch(
    bracket: BracketData,
    matchRound: number,
    matchPosition: number,
    winner: string,
    tiebreak: boolean,
  ): void {
    const match = bracket.matches.find(
      (m) => m.round === matchRound && m.position === matchPosition,
    );
    if (!match) throw new Error(`Match not found: round ${matchRound} pos ${matchPosition}`);

    match.winner = winner;
    match.tiebreak = tiebreak;

    // Propagate to next round
    const nextRound = match.round + 1;
    if (nextRound > bracket.totalRounds) return;

    const nextPos = Math.floor(match.position / 2);
    const nextMatch = bracket.matches.find(
      (m) => m.round === nextRound && m.position === nextPos,
    );
    if (!nextMatch) return;

    if (match.position % 2 === 0) {
      nextMatch.engineA = winner;
    } else {
      nextMatch.engineB = winner;
    }
  }

  /**
   * Determine the winner of a matchup (2 regular games + optional decider).
   *
   * - After 2 games: tie → returns winner=null (needs decider game).
   * - After 3 games: tie → higher seed (lower index) advances as last resort.
   */
  determineMatchWinner(
    match: BracketMatch,
    games: { result: "red" | "black" | "draw"; redId: string; blackId: string }[],
    seeds: string[],
  ): { winner: string | null; tiebreak: boolean } {
    const a = match.engineA!;
    const b = match.engineB!;
    let scoreA = 0;
    let scoreB = 0;

    for (const g of games) {
      if (g.result === "red") {
        if (g.redId === a) scoreA++;
        else scoreB++;
      } else if (g.result === "black") {
        if (g.blackId === a) scoreA++;
        else scoreB++;
      } else {
        scoreA += 0.5;
        scoreB += 0.5;
      }
    }

    if (scoreA > scoreB) return { winner: a, tiebreak: false };
    if (scoreB > scoreA) return { winner: b, tiebreak: false };

    // Tied — after only 2 games, request a decider
    if (games.length <= 2) return { winner: null, tiebreak: false };

    // Tied after 3 games (decider was a draw): higher seed advances
    const idxA = seeds.indexOf(a);
    const idxB = seeds.indexOf(b);
    return {
      winner: idxA < idxB ? a : b,
      tiebreak: true,
    };
  }

  /**
   * Check if a match needs a decider game (2 regular games played, no winner).
   */
  needsDecider(match: BracketMatch): boolean {
    return !match.isBye
      && match.winner === null
      && match.gameIds.length === 2;
  }

  /**
   * Get red/black assignment for the decider game.
   * Lower seed (higher index) gets red (first-move advantage)
   * to compensate for their seed disadvantage.
   */
  getDeciderColors(
    match: BracketMatch,
    seeds: string[],
  ): { red: string; black: string } {
    const a = match.engineA!;
    const b = match.engineB!;
    const idxA = seeds.indexOf(a);
    const idxB = seeds.indexOf(b);
    // Lower seed = higher index → gets red
    if (idxA > idxB) {
      return { red: a, black: b };
    }
    return { red: b, black: a };
  }

  /**
   * Check if the tournament is complete (final match has a winner).
   */
  isComplete(bracket: BracketData): boolean {
    const finalMatch = bracket.matches.find(
      (m) => m.round === bracket.totalRounds && m.position === 0,
    );
    return finalMatch?.winner != null;
  }

  /**
   * Get the champion engine ID.
   */
  getChampion(bracket: BracketData): string | null {
    const finalMatch = bracket.matches.find(
      (m) => m.round === bracket.totalRounds && m.position === 0,
    );
    return finalMatch?.winner ?? null;
  }

  /**
   * Compute final rankings based on elimination round.
   * Champion: 1, finalist: 2, semi-losers: 3, quarter-losers: 5, etc.
   * Byes don't count as "losing" — rank is based on the round the engine
   * actually lost a real match.
   */
  getRankings(bracket: BracketData): Map<string, number> {
    const rankings = new Map<string, number>();
    const { totalRounds, seeds, matches } = bracket;

    // Champion
    const champion = this.getChampion(bracket);
    if (champion) rankings.set(champion, 1);

    // For each non-bye match with a winner, the loser gets a rank based on the round
    for (const match of matches) {
      if (match.isBye || !match.winner) continue;
      const loser = match.engineA === match.winner ? match.engineB : match.engineA;
      if (!loser) continue;

      // Rank for losing in round R: 2^(totalRounds - R) + 1
      // R=totalRounds (final): rank 2
      // R=totalRounds-1 (semi): rank 3
      // R=totalRounds-2 (quarter): rank 5
      const rank = match.round === totalRounds
        ? 2
        : Math.pow(2, totalRounds - match.round) + 1;
      rankings.set(loser, rank);
    }

    // Engines that never played (shouldn't happen, but safety)
    for (const id of seeds) {
      if (!rankings.has(id)) {
        rankings.set(id, seeds.length);
      }
    }

    return rankings;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Generate classic bracket seed positions for a given bracket size.
 * Returns an array of length `size` where each element is a 0-based seed index.
 *
 * For size=8: [0, 7, 3, 4, 1, 6, 2, 5]
 *   → pairs: (seed1 vs seed8), (seed4 vs seed5), (seed2 vs seed7), (seed3 vs seed6)
 *   → seed 1 and 2 in opposite halves, meet only in the final
 */
export function generateBracketPositions(size: number): number[] {
  let positions = [0];
  while (positions.length < size) {
    const sum = positions.length * 2 - 1;
    const expanded: number[] = [];
    for (const s of positions) {
      expanded.push(s, sum - s);
    }
    positions = expanded;
  }
  return positions;
}

/**
 * Propagate all known winners forward through the bracket.
 * Handles cascading byes (e.g., 5 engines → 3 byes, some round-2 matches
 * may have both engines known from bye propagation).
 */
function propagateAllWinners(matches: BracketMatch[], totalRounds: number): void {
  // Process round by round to handle cascading
  for (let r = 1; r < totalRounds; r++) {
    const roundMatches = matches.filter((m) => m.round === r);
    for (const match of roundMatches) {
      if (!match.winner) continue;

      const nextRound = r + 1;
      const nextPos = Math.floor(match.position / 2);
      const nextMatch = matches.find(
        (m) => m.round === nextRound && m.position === nextPos,
      );
      if (!nextMatch) continue;

      if (match.position % 2 === 0) {
        nextMatch.engineA = match.winner;
      } else {
        nextMatch.engineB = match.winner;
      }

      // Check if the next match is now also a bye (only one engine present,
      // and the other feeder is also a bye that's already propagated)
      if (nextMatch.engineA && !nextMatch.engineB) {
        // Check if the other feeder (odd position) has a winner
        const otherFeederPos = nextPos * 2 + (match.position % 2 === 0 ? 1 : 0);
        const otherFeeder = matches.find(
          (m) => m.round === r && m.position === otherFeederPos,
        );
        // If the other feeder doesn't exist or has no engine at all, this side gets a bye
        if (otherFeeder && otherFeeder.isBye && otherFeeder.winner) {
          nextMatch.engineB = otherFeeder.winner;
        }
      } else if (nextMatch.engineB && !nextMatch.engineA) {
        const otherFeederPos = nextPos * 2 + (match.position % 2 === 0 ? 1 : 0);
        const otherFeeder = matches.find(
          (m) => m.round === r && m.position === otherFeederPos,
        );
        if (otherFeeder && otherFeeder.isBye && otherFeeder.winner) {
          nextMatch.engineA = otherFeeder.winner;
        }
      }
    }
  }
}
