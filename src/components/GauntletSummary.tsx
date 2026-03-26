"use client";

import Link from "next/link";

interface GauntletEntry {
  engine_id: string;
  engine_name: string;
  score: number;
}

interface GauntletGame {
  id: string;
  red_engine_id: string;
  black_engine_id: string;
  result: "red" | "black" | "draw" | null;
  started_at: number | null;
  finished_at: number | null;
  round: number | null;
}

interface GauntletSummaryProps {
  entries: GauntletEntry[];
  games: GauntletGame[];
  engineMap?: Record<string, string>;
}

export function GauntletSummary({
  entries,
  games,
}: GauntletSummaryProps) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-ink-muted">
        <p className="font-brush text-lg">暂无对局数据</p>
      </div>
    );
  }

  // Detect challenger: the engine that appears in the most games
  // (gauntlet challenger plays every game by definition)
  const gameCounts = new Map<string, number>();
  for (const g of games) {
    gameCounts.set(g.red_engine_id, (gameCounts.get(g.red_engine_id) ?? 0) + 1);
    gameCounts.set(g.black_engine_id, (gameCounts.get(g.black_engine_id) ?? 0) + 1);
  }
  let challengerId = entries[0].engine_id;
  let maxGames = 0;
  for (const [eid, cnt] of gameCounts) {
    if (cnt > maxGames) {
      maxGames = cnt;
      challengerId = eid;
    }
  }
  const challenger = entries.find((e) => e.engine_id === challengerId) ?? entries[0];
  const opponents = entries.filter((e) => e.engine_id !== challenger.engine_id);

  // Calculate challenger's overall stats
  let totalWins = 0;
  let totalLosses = 0;
  let totalDraws = 0;

  for (const g of games) {
    if (!g.result) continue;
    const isRed = g.red_engine_id === challenger.engine_id;
    const isBlack = g.black_engine_id === challenger.engine_id;
    if (!isRed && !isBlack) continue;

    if (
      (isRed && g.result === "red") ||
      (isBlack && g.result === "black")
    ) {
      totalWins++;
    } else if (g.result === "draw") {
      totalDraws++;
    } else {
      totalLosses++;
    }
  }

  // Group games by opponent
  const opponentStats = opponents.map((opp) => {
    const oppGames = games.filter(
      (g) =>
        (g.red_engine_id === challenger.engine_id &&
          g.black_engine_id === opp.engine_id) ||
        (g.black_engine_id === challenger.engine_id &&
          g.red_engine_id === opp.engine_id),
    );

    let wins = 0;
    let losses = 0;
    let draws = 0;
    for (const g of oppGames) {
      if (!g.result) continue;
      const challengerIsRed = g.red_engine_id === challenger.engine_id;
      if (
        (challengerIsRed && g.result === "red") ||
        (!challengerIsRed && g.result === "black")
      ) {
        wins++;
      } else if (g.result === "draw") {
        draws++;
      } else {
        losses++;
      }
    }

    return {
      opponent: opp,
      games: oppGames,
      wins,
      losses,
      draws,
    };
  });

  return (
    <section className="space-y-6">
      <h2 className="font-brush text-2xl text-ink">定级赛战报</h2>

      {/* Challenger summary card */}
      <div className="rounded-lg border border-paper-300 bg-paper-50 p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-sm text-ink-muted">挑战者</span>
          <span className="font-brush text-xl text-ink">
            {challenger.engine_name}
          </span>
        </div>
        <div className="flex gap-4 text-sm">
          <span className="text-green-700 font-semibold">{totalWins} 胜</span>
          <span className="text-red-700 font-semibold">{totalLosses} 负</span>
          <span className="text-ink-muted font-semibold">{totalDraws} 和</span>
          <span className="text-ink font-mono ml-auto">
            得分 {challenger.score}
          </span>
        </div>
      </div>

      {/* Per-opponent breakdown */}
      <div className="space-y-3">
        {opponentStats.map(({ opponent, games: oppGames, wins, losses, draws }) => {
          return (
            <div
              key={opponent.engine_id}
              className="rounded-lg border border-paper-300 bg-paper-50 overflow-hidden"
            >
              {/* Opponent header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-paper-200">
                <span className="font-semibold text-ink text-sm">
                  vs {opponent.engine_name}
                </span>
                <span className="text-sm">
                  <span className={wins > losses ? "text-green-700 font-semibold" : losses > wins ? "text-red-700 font-semibold" : "text-ink-muted"}>
                    {wins}W {losses}L {draws}D
                  </span>
                </span>
              </div>

              {/* Individual games */}
              {oppGames.length > 0 && (
                <div className="px-4 py-2 flex flex-wrap gap-2">
                  {oppGames.map((g) => {
                    const challengerIsRed =
                      g.red_engine_id === challenger.engine_id;
                    const colorLabel = challengerIsRed ? "执红" : "执黑";
                    let resultLabel = "进行中";
                    let resultColor = "text-ink-muted";

                    if (g.result) {
                      const won =
                        (challengerIsRed && g.result === "red") ||
                        (!challengerIsRed && g.result === "black");
                      const drew = g.result === "draw";
                      if (won) {
                        resultLabel = "胜";
                        resultColor = "text-green-700";
                      } else if (drew) {
                        resultLabel = "和";
                        resultColor = "text-ink-muted";
                      } else {
                        resultLabel = "负";
                        resultColor = "text-red-700";
                      }
                    }

                    return (
                      <Link
                        key={g.id}
                        href={`/games/${g.id}`}
                        className="inline-flex items-center gap-1.5 rounded border border-paper-200 px-2 py-1 text-xs hover:bg-paper-100 transition-colors"
                      >
                        <span className="text-ink-muted">{colorLabel}</span>
                        <span className={`font-semibold ${resultColor}`}>
                          {resultLabel}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
