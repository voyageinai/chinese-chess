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
