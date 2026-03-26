"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Database,
} from "lucide-react";
import {
  RESULT_CODE_OPTIONS,
  getGameResultLabel,
  getEngineOutcomeLabel,
  translateResult,
} from "@/lib/results";
import type { EngineOutcome } from "@/lib/results";
import type { ResultCode, Color } from "@/lib/types";

interface LeaderboardEngine {
  id: string;
  name: string;
  elo: number;
}

interface GameRow {
  id: string;
  red_engine_id: string;
  black_engine_id: string;
  red_engine_name: string;
  black_engine_name: string;
  result: "red" | "black" | "draw";
  result_code: ResultCode | null;
  result_reason: string | null;
  result_detail: string | null;
  engine_side: Color | null;
  engine_outcome: EngineOutcome | null;
  finished_at: number | null;
}

interface GamesResponse {
  games: GameRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const BOARD_RESULT_LABELS: Record<string, string> = {
  "": "全部",
  red: "红胜",
  black: "黑胜",
  draw: "和棋",
};

const OUTCOME_LABELS: Record<string, string> = {
  "": "全部",
  win: "胜",
  loss: "负",
  draw: "和",
};

export default function GamesPage() {
  const [engines, setEngines] = useState<LeaderboardEngine[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [engineFilter, setEngineFilter] = useState("");
  const [boardResultFilter, setBoardResultFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [resultCodeFilter, setResultCodeFilter] = useState("");

  // Load engines for filter dropdown
  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((d) => setEngines(d.leaderboard ?? []))
      .catch(() => {});
  }, []);

  // Load games
  const loadGames = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      if (engineFilter) params.set("engineId", engineFilter);
      if (boardResultFilter) params.set("result", boardResultFilter);
      if (outcomeFilter) params.set("outcome", outcomeFilter);
      if (resultCodeFilter) params.set("resultCode", resultCodeFilter);

      const res = await fetch(`/api/games?${params.toString()}`);
      const data: GamesResponse = await res.json();
      setGames(data.games);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      setGames([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [page, engineFilter, boardResultFilter, outcomeFilter, resultCodeFilter]);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [engineFilter, boardResultFilter, outcomeFilter, resultCodeFilter]);

  useEffect(() => {
    if (!engineFilter && outcomeFilter) {
      setOutcomeFilter("");
    }
  }, [engineFilter, outcomeFilter]);

  function buildExportUrl(format: string) {
    const params = new URLSearchParams();
    params.set("format", format);
    if (engineFilter) params.set("engineId", engineFilter);
    if (boardResultFilter) params.set("result", boardResultFilter);
    if (outcomeFilter) params.set("outcome", outcomeFilter);
    if (resultCodeFilter) params.set("resultCode", resultCodeFilter);
    return `/api/games/export?${params.toString()}`;
  }

  function formatDate(ts: number | null): string {
    if (!ts) return "-";
    return new Date(ts * 1000).toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const engineLabel = engineFilter
    ? engines.find((engine) => engine.id === engineFilter)?.name ?? "全部引擎"
    : "全部引擎";
  const outcomeLabel = outcomeFilter
    ? OUTCOME_LABELS[outcomeFilter] ?? "全部"
    : engineFilter
      ? "全部"
      : "先选引擎";
  const boardResultLabel = boardResultFilter
    ? BOARD_RESULT_LABELS[boardResultFilter] ?? "全部"
    : "全部";
  const resultCodeLabel = resultCodeFilter
    ? RESULT_CODE_OPTIONS.find((option) => option.value === resultCodeFilter)?.label ?? "全部原因"
    : "全部原因";

  function getResultBadge(game: GameRow): {
    label: string;
    variant: "default" | "secondary" | "outline";
    className?: string;
    sideLabel: string | null;
  } {
    if (engineFilter && game.engine_outcome) {
      return {
        label: getEngineOutcomeLabel(game.engine_outcome),
        variant:
          game.engine_outcome === "win"
            ? "default"
            : game.engine_outcome === "loss"
              ? "secondary"
              : "outline",
        className:
          game.engine_outcome === "win"
            ? "bg-green-100 text-green-800 border-green-200"
            : game.engine_outcome === "loss"
              ? "bg-vermilion/10 text-vermilion border-vermilion/20"
              : "",
        sideLabel:
          game.engine_side === "red"
            ? "执红"
            : game.engine_side === "black"
              ? "执黑"
              : null,
      };
    }

    return {
      label: getGameResultLabel(game.result),
      variant:
        game.result === "red"
          ? "default"
          : game.result === "black"
            ? "secondary"
            : "outline",
      className:
        game.result === "red"
          ? "bg-vermilion/15 text-vermilion border-vermilion/20"
          : game.result === "black"
            ? "bg-ink/10 text-ink border-ink/20"
            : "",
      sideLabel: null,
    };
  }

  return (
    <div className="space-y-8">
      <header className="text-center py-6">
        <h1 className="font-brush text-4xl text-ink flex items-center justify-center gap-3">
          <Database className="w-8 h-8" />
          对局库
        </h1>
        <p className="mt-2 text-ink-light">
          浏览、筛选和导出所有已完成的对局
        </p>
      </header>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="w-4 h-4" />
            筛选条件
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Engine filter */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-ink-muted">引擎</label>
              <Select
                value={engineFilter}
                onValueChange={(v) => setEngineFilter(v ?? "")}
              >
                <SelectTrigger className="w-[200px]">
                  <span className="flex flex-1 text-left line-clamp-1">
                    {engineLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">全部引擎</SelectItem>
                  {engines.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Outcome filter */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-ink-muted">模型结果</label>
              <Select
                value={outcomeFilter}
                onValueChange={(v) => setOutcomeFilter(v ?? "")}
              >
                <SelectTrigger className="w-[140px]" disabled={!engineFilter}>
                  <span className="flex flex-1 text-left line-clamp-1">
                    {outcomeLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(OUTCOME_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Board result filter */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-ink-muted">棋局结果</label>
              <Select
                value={boardResultFilter}
                onValueChange={(v) => setBoardResultFilter(v ?? "")}
              >
                <SelectTrigger className="w-[140px]">
                  <span className="flex flex-1 text-left line-clamp-1">
                    {boardResultLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(BOARD_RESULT_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Termination filter */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-ink-muted">终局原因</label>
              <Select
                value={resultCodeFilter}
                onValueChange={(v) => setResultCodeFilter(v ?? "")}
              >
                <SelectTrigger className="w-[180px]">
                  <span className="flex flex-1 text-left line-clamp-1">
                    {resultCodeLabel}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">全部原因</SelectItem>
                  {RESULT_CODE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Export buttons */}
            <div className="flex gap-2 ml-auto">
              <a href={buildExportUrl("json")} download>
                <Button variant="outline" size="sm">
                  <Download className="w-3.5 h-3.5" data-icon="inline-start" />
                  导出 JSON
                </Button>
              </a>
              <a href={buildExportUrl("pgn")} download>
                <Button variant="outline" size="sm">
                  <Download className="w-3.5 h-3.5" data-icon="inline-start" />
                  导出 PGN
                </Button>
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-ink-muted">
            共 {total} 局
            {(engineFilter || boardResultFilter || outcomeFilter || resultCodeFilter) && "（已筛选）"}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="font-brush text-xl text-ink-muted animate-pulse">
              加载中...
            </p>
          </div>
        ) : games.length === 0 ? (
          <div className="text-center py-16 text-ink-muted">
            <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="font-brush text-lg">暂无对局记录</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>红方</TableHead>
                <TableHead>黑方</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>原因</TableHead>
                <TableHead>时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {games.map((g) => {
                const badge = getResultBadge(g);
                return (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium text-vermilion">
                      {g.red_engine_name}
                    </TableCell>
                    <TableCell className="font-medium">
                      {g.black_engine_name}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={badge.variant} className={badge.className}>
                          {badge.label}
                        </Badge>
                        {badge.sideLabel && (
                          <Badge variant="outline" className="text-xs">
                            {badge.sideLabel}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[220px] text-sm text-ink-muted">
                      {translateResult(
                        g.result_code,
                        g.result_reason,
                        g.result_detail,
                      ) || "-"}
                    </TableCell>
                    <TableCell className="text-ink-muted text-xs">
                      {formatDate(g.finished_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/games/${g.id}`}>
                        <Button variant="ghost" size="sm">
                          查看
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-ink-muted tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
