const K = 32;

/**
 * Calculate new Elo ratings after a game.
 * @param ratingA - Player A's current rating
 * @param ratingB - Player B's current rating
 * @param scoreA - Player A's score: 1 (win), 0.5 (draw), 0 (loss)
 * @returns [newRatingA, newRatingB]
 */
export function calculateElo(
  ratingA: number,
  ratingB: number,
  scoreA: number
): [number, number] {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;
  const scoreB = 1 - scoreA;

  const newA = ratingA + K * (scoreA - expectedA);
  const newB = ratingB + K * (scoreB - expectedB);

  return [newA, newB];
}

/**
 * Estimate 95% confidence interval half-width for an engine's Elo rating.
 * Uses simplified formula: assumes worst-case variance (mu≈0.5) for robustness.
 * Returns null if sample size is too small (< 10 games).
 */
export function calculateEloCI(wins: number, losses: number, draws: number): number | null {
  const N = wins + losses + draws;
  if (N < 10) return null;
  const mu = (wins + draws * 0.5) / N;
  const se = Math.sqrt(mu * (1 - mu) / N);
  const lo = Math.max(0.001, mu - 1.96 * se);
  const hi = Math.min(0.999, mu + 1.96 * se);
  const eloLo = -400 * Math.log10(1 / lo - 1);
  const eloHi = -400 * Math.log10(1 / hi - 1);
  return Math.round((eloHi - eloLo) / 2);
}
