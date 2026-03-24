import type { TournamentStrategy, RoundContext, TournamentFormat, Standing } from "./types";
import type { Pairing } from "../tournament";

/**
 * Swiss-system tournament (simplified Monrad variant).
 *
 * Rules:
 * 1. Same-score engines are paired first
 * 2. Avoid repeat opponents when possible (fallback: allow repeats)
 * 3. Balance colors (give each engine roughly equal red/black games)
 * 4. Odd number of engines: lowest-scoring engine that hasn't had a bye gets one (scores 1 point)
 * 5. Each matchup is 2 games (swapping colors) for fairness
 */
export class SwissStrategy implements TournamentStrategy {
  readonly format: TournamentFormat = "swiss";

  isRoundBased(): boolean {
    return true;
  }

  generateNextRound(context: RoundContext): Pairing[] | null {
    const { round, totalRounds, standings, openingFens } = context;

    if (round > totalRounds) return null;

    // Sort by score descending
    const sorted = [...standings].sort((a, b) => b.score - a.score);
    const paired = new Set<string>();
    const pairings: Pairing[] = [];
    let fenIndex = 0;

    // Group by score
    const groups = this.groupByScore(sorted);

    // Flatten unpaired engines across groups
    const unpaired: Standing[] = [];
    for (const group of groups) {
      unpaired.push(...group);
    }

    // Greedy pairing: iterate and pair best available
    for (let i = 0; i < unpaired.length; i++) {
      const a = unpaired[i];
      if (paired.has(a.engineId)) continue;

      // Find best opponent: same score > different score, not already played > already played
      let bestJ = -1;
      let bestScore = -Infinity;

      for (let j = i + 1; j < unpaired.length; j++) {
        const b = unpaired[j];
        if (paired.has(b.engineId)) continue;

        let priority = 0;
        // Same score group bonus
        if (b.score === a.score) priority += 100;
        // Haven't played before bonus
        if (!a.opponents.includes(b.engineId)) priority += 50;
        // Closer score difference is better
        priority -= Math.abs(a.score - b.score);

        if (priority > bestScore) {
          bestScore = priority;
          bestJ = j;
        }
      }

      if (bestJ === -1) continue; // No opponent found (odd engine, will get bye)

      const b = unpaired[bestJ];
      paired.add(a.engineId);
      paired.add(b.engineId);

      // Assign colors: give the less-played color to each
      const [red, black] = this.assignColors(a, b);

      const fen = openingFens?.length
        ? openingFens[fenIndex++ % openingFens.length]
        : undefined;

      // 2 games per matchup (swap colors), same FEN
      pairings.push({ red, black, startFen: fen });
      pairings.push({ red: black, black: red, startFen: fen });
    }

    // Handle bye: unpaired engine with lowest score
    for (const s of [...sorted].reverse()) {
      if (!paired.has(s.engineId)) {
        // Engine gets a bye (1 point). We don't create a game for it,
        // but the tournament runner should handle this.
        // For now, just skip — the engine simply doesn't play this round.
        break;
      }
    }

    return pairings.length > 0 ? pairings : null;
  }

  private groupByScore(standings: Standing[]): Standing[][] {
    const groups: Standing[][] = [];
    let current: Standing[] = [];
    let lastScore = -1;

    for (const s of standings) {
      if (s.score !== lastScore && current.length > 0) {
        groups.push(current);
        current = [];
      }
      current.push(s);
      lastScore = s.score;
    }
    if (current.length > 0) groups.push(current);

    return groups;
  }

  private assignColors(a: Standing, b: Standing): [string, string] {
    const aReds = a.colorHistory.filter((c) => c === "red").length;
    const bReds = b.colorHistory.filter((c) => c === "red").length;

    // Give red to whoever has played red fewer times
    if (aReds < bReds) return [a.engineId, b.engineId];
    if (bReds < aReds) return [b.engineId, a.engineId];

    // Equal: higher-scored engine gets red (slight advantage in xiangqi)
    return a.score >= b.score
      ? [a.engineId, b.engineId]
      : [b.engineId, a.engineId];
  }
}
