"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LeaderboardEngine {
  id: string;
  name: string;
  elo: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  owner?: string;
  elo_delta?: number | null;
}

interface LeaderboardProps {
  engines: LeaderboardEngine[];
}

const CHINESE_NUMERALS = [
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
];

function getEloCI(w: number, l: number, d: number): number | null {
  const N = w + l + d;
  if (N < 10) return null;
  const mu = (w + d * 0.5) / N;
  const se = Math.sqrt(mu * (1 - mu) / N);
  const lo = Math.max(0.001, mu - 1.96 * se);
  const hi = Math.min(0.999, mu + 1.96 * se);
  const eloLo = -400 * Math.log10(1 / lo - 1);
  const eloHi = -400 * Math.log10(1 / hi - 1);
  return Math.round((eloHi - eloLo) / 2);
}

function toChineseNumeral(n: number): string {
  if (n <= 0) return String(n);
  if (n <= 10) return CHINESE_NUMERALS[n - 1];
  if (n < 20) return "十" + (n === 10 ? "" : CHINESE_NUMERALS[n - 11]);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return (
    CHINESE_NUMERALS[tens - 1] +
    "十" +
    (ones === 0 ? "" : CHINESE_NUMERALS[ones - 1])
  );
}

export function Leaderboard({ engines }: LeaderboardProps) {
  if (engines.length === 0) {
    return (
      <div className="text-center py-12 text-ink-muted">
        <p className="font-brush text-lg">暂无引擎</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-paper-300 bg-paper-50 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-paper-300 hover:bg-transparent">
            <TableHead className="w-16 text-center text-ink-muted">
              名次
            </TableHead>
            <TableHead className="text-ink-muted">引擎</TableHead>
            {engines[0]?.owner !== undefined && (
              <TableHead className="text-ink-muted">作者</TableHead>
            )}
            <TableHead className="text-right text-ink-muted">等级分</TableHead>
            <TableHead className="text-right text-ink-muted hidden sm:table-cell">胜</TableHead>
            <TableHead className="text-right text-ink-muted hidden sm:table-cell">负</TableHead>
            <TableHead className="text-right text-ink-muted hidden sm:table-cell">和</TableHead>
            <TableHead className="text-right text-ink-muted hidden sm:table-cell">胜率</TableHead>
            <TableHead className="text-right text-ink-muted">对局</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {engines.map((engine, i) => {
            const rank = i + 1;
            const isTop3 = rank <= 3;
            return (
              <TableRow
                key={engine.id}
                className={`border-paper-300 ${
                  isTop3
                    ? "bg-paper-100/60 hover:bg-paper-200/60"
                    : "hover:bg-paper-100/40"
                }`}
              >
                <TableCell className="text-center">
                  <span
                    className={`font-brush text-lg ${
                      rank === 1
                        ? "text-vermilion"
                        : isTop3
                          ? "text-ink-light"
                          : "text-ink-muted"
                    }`}
                  >
                    {toChineseNumeral(rank)}
                  </span>
                </TableCell>
                <TableCell>
                  <span
                    className={`font-semibold ${
                      isTop3 ? "text-ink" : "text-ink-light"
                    }`}
                  >
                    {engine.name}
                  </span>
                </TableCell>
                {engine.owner !== undefined && (
                  <TableCell className="text-ink-muted">
                    {engine.owner}
                  </TableCell>
                )}
                <TableCell className="text-right font-mono text-sm">
                  {Math.round(engine.elo)}
                  {(() => {
                    const ci = getEloCI(engine.wins, engine.losses, engine.draws);
                    return ci !== null ? (
                      <span className="text-ink-muted text-xs ml-1">±{ci}</span>
                    ) : null;
                  })()}
                  {engine.elo_delta != null && engine.elo_delta !== 0 && (
                    <span
                      className={`text-xs ml-1.5 ${engine.elo_delta > 0 ? "text-green-700" : "text-vermilion"}`}
                    >
                      {engine.elo_delta > 0 ? "+" : ""}{engine.elo_delta}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-green-700 hidden sm:table-cell">
                  {engine.wins}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-vermilion hidden sm:table-cell">
                  {engine.losses}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-ink-muted hidden sm:table-cell">
                  {engine.draws}
                </TableCell>
                <TableCell className="text-right font-mono text-sm hidden sm:table-cell">
                  {engine.wins + engine.losses + engine.draws > 0
                    ? `${((engine.wins / (engine.wins + engine.losses + engine.draws)) * 100).toFixed(1)}%`
                    : "-"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-ink-muted">
                  {engine.wins + engine.losses + engine.draws}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
