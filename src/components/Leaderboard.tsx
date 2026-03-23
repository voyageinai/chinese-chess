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
  owner?: string;
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
    <div className="rounded-lg border border-paper-300 bg-paper-50 overflow-hidden">
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
                  {engine.elo}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-ink-muted">
                  {engine.games_played}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
