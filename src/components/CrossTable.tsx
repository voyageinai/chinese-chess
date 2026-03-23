"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CrossTableProps {
  entries: Array<{ engine_id: string; engine_name: string; score: number }>;
  games: Array<{
    red_engine_id: string;
    black_engine_id: string;
    result: string | null;
  }>;
}

export function CrossTable({ entries, games }: CrossTableProps) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-ink-muted">
        <p className="font-brush text-lg">暂无引擎参赛</p>
      </div>
    );
  }

  // Build head-to-head results: h2h[a][b] = { wins, draws, losses } for a vs b
  const h2h: Record<string, Record<string, { wins: number; draws: number; losses: number }>> = {};

  for (const e of entries) {
    h2h[e.engine_id] = {};
    for (const other of entries) {
      if (other.engine_id !== e.engine_id) {
        h2h[e.engine_id][other.engine_id] = { wins: 0, draws: 0, losses: 0 };
      }
    }
  }

  for (const game of games) {
    if (!game.result) continue;
    const red = game.red_engine_id;
    const black = game.black_engine_id;

    if (!h2h[red] || !h2h[red][black]) continue;

    if (game.result === "red") {
      h2h[red][black].wins++;
      h2h[black][red].losses++;
    } else if (game.result === "black") {
      h2h[red][black].losses++;
      h2h[black][red].wins++;
    } else {
      h2h[red][black].draws++;
      h2h[black][red].draws++;
    }
  }

  // Sort by score descending
  const sorted = [...entries].sort((a, b) => b.score - a.score);

  function cellColor(wins: number, losses: number, draws: number) {
    const total = wins + losses + draws;
    if (total === 0) return "";
    if (wins > losses) return "bg-green-100/60 text-green-900";
    if (losses > wins) return "bg-red-100/60 text-red-900";
    return "bg-paper-200/60 text-ink-muted";
  }

  function cellText(record: { wins: number; draws: number; losses: number }) {
    const total = record.wins + record.draws + record.losses;
    if (total === 0) return "-";
    // Show score fraction: wins + draws*0.5 / total
    const score = record.wins + record.draws * 0.5;
    return `${score}/${total}`;
  }

  return (
    <div className="rounded-lg border border-paper-300 bg-paper-50 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-paper-300 hover:bg-transparent">
            <TableHead className="text-ink-muted min-w-[120px]">引擎</TableHead>
            {sorted.map((e) => (
              <TableHead
                key={e.engine_id}
                className="text-center text-ink-muted text-xs min-w-[64px]"
                title={e.engine_name}
              >
                {e.engine_name.length > 6
                  ? e.engine_name.slice(0, 5) + "..."
                  : e.engine_name}
              </TableHead>
            ))}
            <TableHead className="text-right text-ink-muted">得分</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.engine_id} className="border-paper-300 hover:bg-paper-100/40">
              <TableCell className="font-semibold text-ink">
                {row.engine_name}
              </TableCell>
              {sorted.map((col) => {
                if (row.engine_id === col.engine_id) {
                  return (
                    <TableCell
                      key={col.engine_id}
                      className="text-center bg-paper-300/40 text-ink-muted"
                    >
                      &mdash;
                    </TableCell>
                  );
                }
                const record = h2h[row.engine_id]?.[col.engine_id] ?? {
                  wins: 0,
                  draws: 0,
                  losses: 0,
                };
                return (
                  <TableCell
                    key={col.engine_id}
                    className={`text-center font-mono text-xs ${cellColor(record.wins, record.losses, record.draws)}`}
                  >
                    {cellText(record)}
                  </TableCell>
                );
              })}
              <TableCell className="text-right font-mono font-semibold">
                {row.score}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
