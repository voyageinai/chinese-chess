import type { TournamentStrategy, RoundContext, TournamentFormat } from "./types";
import type { Pairing } from "../tournament";

/**
 * Knockout (single elimination): losers are eliminated each round.
 * Each matchup consists of 2 games (swapping colors).
 * If tied after 2 games, the higher-Elo engine advances (MVP — no tiebreak matches).
 *
 * Seeds are ordered by position in the engineIds array (caller should sort by Elo).
 * Non-power-of-2 counts get byes in round 1 for the top seeds.
 */
export class KnockoutStrategy implements TournamentStrategy {
  readonly format: TournamentFormat = "knockout";

  isRoundBased(): boolean {
    return true;
  }

  generateNextRound(context: RoundContext): Pairing[] | null {
    const { round, engineIds, completedGames, openingFens } = context;

    if (round === 1) {
      // First round: seed matchups (1 vs last, 2 vs second-last, etc.)
      // If not power of 2, top seeds get byes
      return this.generateFirstRound(engineIds, openingFens);
    }

    // Determine winners of the previous round
    const winners = this.getWinners(context);
    if (winners.length <= 1) return null; // tournament over

    return this.pairWinners(winners, openingFens);
  }

  private generateFirstRound(engineIds: string[], openingFens?: string[]): Pairing[] {
    const n = engineIds.length;
    if (n < 2) return [];

    // Find next power of 2
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
    const byeCount = bracketSize - n;

    // Top seeds get byes (they advance automatically)
    // Remaining seeds are paired: highest vs lowest
    const activeEngines = engineIds.slice(byeCount);
    return this.pairSequential(activeEngines, openingFens);
  }

  private getWinners(context: RoundContext): string[] {
    const { completedGames, engineIds } = context;

    // Group games by matchup pair
    const matchups = new Map<string, { redWins: number; blackWins: number; draws: number; ids: [string, string] }>();

    for (const game of completedGames) {
      const key = [game.redId, game.blackId].sort().join("|");
      if (!matchups.has(key)) {
        matchups.set(key, { redWins: 0, blackWins: 0, draws: 0, ids: [game.redId, game.blackId].sort() as [string, string] });
      }
      const m = matchups.get(key)!;
      if (game.result === "red") {
        // Who was red? If sorted[0] was red, they won
        if (game.redId === m.ids[0]) m.redWins++;
        else m.blackWins++;
      } else if (game.result === "black") {
        if (game.blackId === m.ids[0]) m.redWins++;
        else m.blackWins++;
      } else {
        m.draws++;
      }
    }

    const winners = new Set<string>();
    const eliminated = new Set<string>();

    for (const [, m] of matchups) {
      const [a, b] = m.ids;
      const aScore = m.redWins;
      const bScore = m.blackWins;

      if (aScore > bScore) {
        winners.add(a);
        eliminated.add(b);
      } else if (bScore > aScore) {
        winners.add(b);
        eliminated.add(a);
      } else {
        // Tie: higher position in original engineIds advances
        const aIdx = engineIds.indexOf(a);
        const bIdx = engineIds.indexOf(b);
        if (aIdx < bIdx) {
          winners.add(a);
          eliminated.add(b);
        } else {
          winners.add(b);
          eliminated.add(a);
        }
      }
    }

    // Engines with byes (not in any matchup) also advance
    for (const id of engineIds) {
      if (!winners.has(id) && !eliminated.has(id)) {
        winners.add(id);
      }
    }

    // Maintain seeding order
    return engineIds.filter((id) => winners.has(id));
  }

  private pairWinners(winners: string[], openingFens?: string[]): Pairing[] {
    return this.pairSequential(winners, openingFens);
  }

  private pairSequential(engines: string[], openingFens?: string[]): Pairing[] {
    const pairings: Pairing[] = [];
    let fenIndex = 0;

    for (let i = 0; i < engines.length - 1; i += 2) {
      const fen = openingFens?.length
        ? openingFens[fenIndex++ % openingFens.length]
        : undefined;
      // 2 games per matchup (swap colors), same FEN
      pairings.push({ red: engines[i], black: engines[i + 1], startFen: fen });
      pairings.push({ red: engines[i + 1], black: engines[i], startFen: fen });
    }

    return pairings;
  }
}
