export interface MatchCandidate {
  id: string;
  elo: number;
  user_id: string;
  status?: string;
}

/**
 * Select opponents for matchmaking using weighted random selection.
 * Engines closer in Elo are more likely to be selected.
 * Excludes all engines owned by the same user.
 */
export function selectOpponents(
  myEngineId: string,
  myElo: number,
  myUserId: string,
  count: number,
  allEngines: MatchCandidate[],
): string[] {
  const candidates = allEngines.filter(
    (e) => e.user_id !== myUserId && e.id !== myEngineId && e.status !== "disabled",
  );
  if (candidates.length === 0) return [];
  const n = Math.min(count, candidates.length);

  const selected: string[] = [];
  const remaining = [...candidates];

  for (let i = 0; i < n; i++) {
    const weights = remaining.map(
      (e) => 1 / (1 + Math.abs(myElo - e.elo) / 200),
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let pick = 0;
    for (let j = 0; j < weights.length; j++) {
      r -= weights[j];
      if (r <= 0) {
        pick = j;
        break;
      }
    }
    selected.push(remaining[pick].id);
    remaining.splice(pick, 1);
  }

  return selected;
}

export function randomColor(): "red" | "black" {
  return Math.random() < 0.5 ? "red" : "black";
}
