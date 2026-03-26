"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SwissEntry {
  engine_id: string;
  engine_name: string;
  score: number;
}

interface SwissGame {
  id: string;
  red_engine_id: string;
  black_engine_id: string;
  result: "red" | "black" | "draw" | null;
  started_at: number | null;
  finished_at: number | null;
  round: number | null;
}

interface SwissStandingsProps {
  entries: SwissEntry[];
  games: SwissGame[];
  engineMap: Record<string, string>;
  totalRounds: number;
}

function getEngineName(engineMap: Record<string, string>, id: string): string {
  return engineMap[id] ?? id.slice(0, 8);
}

function scoreForEngine(engineId: string, games: SwissGame[]): number {
  let score = 0;
  for (const g of games) {
    if (g.result === "red" && g.red_engine_id === engineId) score += 1;
    else if (g.result === "black" && g.black_engine_id === engineId) score += 1;
    else if (g.result === "draw" && (g.red_engine_id === engineId || g.black_engine_id === engineId)) score += 0.5;
  }
  return score;
}

export function SwissStandings({
  entries,
  games,
  engineMap,
  totalRounds,
}: SwissStandingsProps) {
  const hasRounds = games.some((g) => g.round != null);
  const sorted = [...entries].sort((a, b) => b.score - a.score);

  // Group games by round
  const roundMap = new Map<number, SwissGame[]>();
  if (hasRounds) {
    for (const g of games) {
      if (g.round != null) {
        if (!roundMap.has(g.round)) roundMap.set(g.round, []);
        roundMap.get(g.round)!.push(g);
      }
    }
  }
  const roundNumbers = [...roundMap.keys()].sort((a, b) => a - b);
  const maxRound = roundNumbers.length > 0 ? roundNumbers[roundNumbers.length - 1] : 0;

  return (
    <section className="space-y-6">
      <h2 className="font-brush text-2xl text-ink">排位赛积分</h2>

      {/* Progress indicator */}
      {maxRound > 0 && (
        <p className="text-sm text-ink-muted">
          进度：第 {maxRound} / {totalRounds} 轮
        </p>
      )}

      {/* Standings table with per-round scores */}
      <div className="rounded-lg border border-paper-300 bg-paper-50 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-paper-300 hover:bg-transparent">
              <TableHead className="w-12 text-center text-ink-muted">#</TableHead>
              <TableHead className="text-ink-muted min-w-[120px]">引擎</TableHead>
              {hasRounds &&
                roundNumbers.map((r) => (
                  <TableHead
                    key={r}
                    className="text-center text-ink-muted text-xs min-w-[48px]"
                  >
                    R{r}
                  </TableHead>
                ))}
              <TableHead className="text-right text-ink-muted">总分</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((entry, i) => (
              <TableRow
                key={entry.engine_id}
                className="border-paper-300 hover:bg-paper-100/40"
              >
                <TableCell className="text-center text-ink-muted">
                  {i + 1}
                </TableCell>
                <TableCell className="font-semibold text-ink">
                  {entry.engine_name}
                </TableCell>
                {hasRounds &&
                  roundNumbers.map((r) => {
                    const roundGames = roundMap.get(r) ?? [];
                    const engineGames = roundGames.filter(
                      (g) =>
                        g.red_engine_id === entry.engine_id ||
                        g.black_engine_id === entry.engine_id,
                    );
                    if (engineGames.length === 0) {
                      return (
                        <TableCell
                          key={r}
                          className="text-center text-ink-muted text-xs"
                        >
                          -
                        </TableCell>
                      );
                    }
                    const roundScore = scoreForEngine(entry.engine_id, engineGames);
                    const allDone = engineGames.every((g) => g.result);
                    return (
                      <TableCell
                        key={r}
                        className={`text-center font-mono text-xs ${
                          !allDone
                            ? "text-ink-muted"
                            : roundScore >= engineGames.length
                              ? "text-green-700 bg-green-50/50"
                              : roundScore === 0
                                ? "text-red-700 bg-red-50/50"
                                : ""
                        }`}
                      >
                        {allDone ? roundScore : "..."}
                      </TableCell>
                    );
                  })}
                <TableCell className="text-right font-mono font-semibold">
                  {entry.score}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Per-round pairings */}
      {hasRounds && roundNumbers.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-brush text-xl text-ink">各轮配对</h3>
          {roundNumbers.map((r) => {
            const roundGames = roundMap.get(r) ?? [];
            // Group into matchups (pairs of games between same engines)
            const pairMap = new Map<string, SwissGame[]>();
            for (const g of roundGames) {
              const key = [g.red_engine_id, g.black_engine_id].sort().join("|");
              if (!pairMap.has(key)) pairMap.set(key, []);
              pairMap.get(key)!.push(g);
            }

            return (
              <div key={r}>
                <h4 className="text-sm font-semibold text-ink-muted mb-2">
                  第 {r} 轮
                </h4>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[...pairMap.values()].map((pairGames) => {
                    const a = pairGames[0].red_engine_id;
                    const b = pairGames[0].black_engine_id;
                    const scoreA = scoreForEngine(a, pairGames);
                    const scoreB = scoreForEngine(b, pairGames);
                    const allDone = pairGames.every((g) => g.result);

                    return (
                      <div
                        key={`${a}-${b}`}
                        className="rounded-lg border border-paper-300 bg-paper-50 px-3 py-2"
                      >
                        <div className="flex items-center justify-between text-sm">
                          <span
                            className={`truncate ${
                              allDone && scoreA > scoreB
                                ? "font-bold text-green-800"
                                : "text-ink"
                            }`}
                          >
                            {getEngineName(engineMap, a)}
                          </span>
                          <span className="font-mono mx-2 text-ink-muted">
                            {allDone ? `${scoreA} : ${scoreB}` : "..."}
                          </span>
                          <span
                            className={`truncate text-right ${
                              allDone && scoreB > scoreA
                                ? "font-bold text-green-800"
                                : "text-ink"
                            }`}
                          >
                            {getEngineName(engineMap, b)}
                          </span>
                        </div>
                        <div className="flex gap-1 mt-1 justify-center">
                          {pairGames.map((g, i) => (
                            <Link
                              key={g.id}
                              href={`/games/${g.id}`}
                              className="text-xs text-ink-muted hover:text-ink underline"
                            >
                              G{i + 1}
                            </Link>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
