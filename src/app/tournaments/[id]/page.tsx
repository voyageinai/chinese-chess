"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CrossTable } from "@/components/CrossTable";
import { BracketView } from "@/components/BracketView";
import { SwissStandings } from "@/components/SwissStandings";
import { GauntletSummary } from "@/components/GauntletSummary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Play, Plus, RotateCcw } from "lucide-react";
import { translateResult } from "@/lib/results";
import type { ResultCode } from "@/lib/types";

interface Tournament {
  id: string;
  owner_id: string;
  name: string;
  status: "pending" | "running" | "finished";
  type: "tournament" | "quick_match";
  format: "round_robin" | "knockout" | "gauntlet" | "swiss";
  time_control_base: number;
  time_control_inc: number;
  rounds: number;
  created_at: number;
  finished_at: number | null;
}

const FORMAT_LABELS: Record<string, string> = {
  round_robin: "循环赛",
  knockout: "淘汰赛",
  gauntlet: "定级赛",
  swiss: "排位赛",
};

interface TournamentEntry {
  tournament_id: string;
  engine_id: string;
  final_rank: number | null;
  score: number;
}

interface GameRecord {
  id: string;
  tournament_id: string;
  red_engine_id: string;
  black_engine_id: string;
  result: "red" | "black" | "draw" | null;
  result_code: ResultCode | null;
  result_reason: string | null;
  result_detail: string | null;
  started_at: number | null;
  finished_at: number | null;
  round: number | null;
}

interface EngineInfo {
  id: string;
  name: string;
}

interface BracketViewBracketData {
  bracketSize: number;
  totalRounds: number;
  seeds: string[];
  matches: {
    round: number;
    position: number;
    engineA: string | null;
    engineB: string | null;
    winner: string | null;
    isBye: boolean;
    tiebreak: boolean;
    gameIds: string[];
  }[];
}

interface CurrentUser {
  id: string;
  username: string;
  role: "admin" | "user";
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待开始",
  running: "进行中",
  finished: "已结束",
};

const RESULT_LABELS: Record<string, string> = {
  red: "红胜",
  black: "黑胜",
  draw: "和棋",
};

const ROUND_LABELS: Record<number, string> = {};
function getRoundLabel(round: number): string {
  return ROUND_LABELS[round] || `第 ${round} 轮`;
}

function GamesListByRound({
  games,
  engineMap,
}: {
  games: GameRecord[];
  engineMap: Record<string, string>;
}) {
  const hasRounds = games.some((g) => g.round != null);

  if (!hasRounds) {
    return <GamesTable games={games} engineMap={engineMap} />;
  }

  // Group by round
  const roundMap = new Map<number, GameRecord[]>();
  const noRound: GameRecord[] = [];
  for (const g of games) {
    if (g.round != null) {
      if (!roundMap.has(g.round)) roundMap.set(g.round, []);
      roundMap.get(g.round)!.push(g);
    } else {
      noRound.push(g);
    }
  }

  const sortedRounds = [...roundMap.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      {sortedRounds.map((round) => (
        <div key={round}>
          <h3 className="font-brush text-lg text-ink mb-2">{getRoundLabel(round)}</h3>
          <GamesTable games={roundMap.get(round)!} engineMap={engineMap} />
        </div>
      ))}
      {noRound.length > 0 && (
        <div>
          <h3 className="font-brush text-lg text-ink-muted mb-2">其他</h3>
          <GamesTable games={noRound} engineMap={engineMap} />
        </div>
      )}
    </div>
  );
}

function GamesTable({
  games,
  engineMap,
}: {
  games: GameRecord[];
  engineMap: Record<string, string>;
}) {
  return (
    <div className="rounded-lg border border-paper-300 bg-paper-50 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-paper-300 hover:bg-transparent">
            <TableHead className="text-ink-muted">红方</TableHead>
            <TableHead className="text-ink-muted">黑方</TableHead>
            <TableHead className="text-ink-muted">结果</TableHead>
            <TableHead className="text-ink-muted">原因</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {games.map((game) => (
            <TableRow
              key={game.id}
              className="border-paper-300 hover:bg-paper-100/40"
            >
              <TableCell className="text-ink">
                {engineMap[game.red_engine_id] ??
                  game.red_engine_id.slice(0, 8)}
              </TableCell>
              <TableCell className="text-ink">
                {engineMap[game.black_engine_id] ??
                  game.black_engine_id.slice(0, 8)}
              </TableCell>
              <TableCell>
                {game.result ? (
                  <Badge
                    variant={
                      game.result === "draw" ? "secondary" : "outline"
                    }
                  >
                    {RESULT_LABELS[game.result]}
                  </Badge>
                ) : (
                  <span className="text-ink-muted text-sm">
                    {game.started_at ? "进行中" : "待开始"}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-sm text-ink-muted">
                {translateResult(
                  game.result_code,
                  game.result_reason,
                  game.result_detail,
                ) || "-"}
              </TableCell>
              <TableCell>
                <Link
                  href={`/games/${game.id}`}
                  className="text-sm text-ink-muted hover:text-ink underline"
                >
                  查看
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatTimeControl(base: number, inc: number): string {
  const mins = Math.floor(base / 60);
  const secs = base % 60;
  const baseStr =
    secs > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${mins}`;
  return `${baseStr}+${inc}s`;
}

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [entries, setEntries] = useState<TournamentEntry[]>([]);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [engineMap, setEngineMap] = useState<Record<string, string>>({});
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [userEngines, setUserEngines] = useState<EngineInfo[]>([]);
  const [bracketData, setBracketData] = useState<BracketViewBracketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add engine state
  const [selectedEngineId, setSelectedEngineId] = useState("");
  const [addingEngine, setAddingEngine] = useState(false);
  const [addError, setAddError] = useState("");

  // Start tournament state
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  // Rematch state (quick_match only)
  const [rematching, setRematching] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [tournRes, meRes] = await Promise.all([
          fetch(`/api/tournaments/${id}`),
          fetch("/api/auth/me"),
        ]);

        if (!tournRes.ok) {
          setError("锦标赛未找到");
          setLoading(false);
          return;
        }

        const tournData = await tournRes.json();
        setTournament(tournData.tournament);
        setEntries(tournData.entries ?? []);
        setGames(tournData.games ?? []);
        setBracketData(tournData.bracketData ?? null);

        // Build engine name map from entries
        const eMap: Record<string, string> = {};
        const allEngineIds = new Set<string>();
        for (const entry of tournData.entries ?? []) {
          allEngineIds.add(entry.engine_id);
        }
        for (const game of tournData.games ?? []) {
          allEngineIds.add(game.red_engine_id);
          allEngineIds.add(game.black_engine_id);
        }

        // Fetch engine names
        const enginePromises = Array.from(allEngineIds).map((eid) =>
          fetch(`/api/engines/${eid}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.engine) eMap[eid] = d.engine.name;
            })
            .catch(() => {}),
        );
        await Promise.all(enginePromises);
        setEngineMap(eMap);

        // Load user
        if (meRes.ok) {
          const meData = await meRes.json();
          setUser(meData.user);

          // Load user's engines for the add-engine selector
          const engRes = await fetch("/api/engines");
          if (engRes.ok) {
            const engData = await engRes.json();
            setUserEngines(
              (engData.engines ?? []).map((e: EngineInfo) => ({
                id: e.id,
                name: e.name,
              })),
            );
          }
        }
      } catch {
        setError("加载失败");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

  async function handleAddEngine() {
    if (!selectedEngineId) return;
    setAddingEngine(true);
    setAddError("");

    try {
      const res = await fetch(`/api/tournaments/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineId: selectedEngineId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "添加失败");
        return;
      }

      // Refresh tournament data
      const refreshRes = await fetch(`/api/tournaments/${id}`);
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setEntries(refreshData.entries ?? []);
        setGames(refreshData.games ?? []);

        // Update engine map
        const eName =
          userEngines.find((e) => e.id === selectedEngineId)?.name ??
          selectedEngineId;
        setEngineMap((prev) => ({ ...prev, [selectedEngineId]: eName }));
      }

      setSelectedEngineId("");
    } catch {
      setAddError("网络错误");
    } finally {
      setAddingEngine(false);
    }
  }

  async function handleStartTournament() {
    setStarting(true);
    setStartError("");

    try {
      const res = await fetch(`/api/tournaments/${id}`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        setStartError(data.error || "启动失败");
        return;
      }

      setTournament((prev) => (prev ? { ...prev, status: "running" } : prev));
    } catch {
      setStartError("网络错误");
    } finally {
      setStarting(false);
    }
  }

  async function handleRematch() {
    if (!tournament) return;
    setRematching(true);
    try {
      const engineIds = entries.map((e) => e.engine_id);
      const res = await fetch("/api/quick-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engineIds,
          timeBase: tournament.time_control_base,
          timeInc: tournament.time_control_inc,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/tournaments/${data.tournament.id}`);
      }
    } catch {
      // ignore
    } finally {
      setRematching(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="font-brush text-2xl text-ink-muted animate-pulse">
          载入中...
        </p>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="text-center py-16">
        <p className="font-brush text-xl text-ink-muted">
          {error || "锦标赛未找到"}
        </p>
        <Link
          href="/tournaments"
          className="mt-4 inline-block text-sm text-ink-muted hover:text-ink underline"
        >
          返回列表
        </Link>
      </div>
    );
  }

  // Build cross-table entries with engine names
  const crossEntries = entries.map((e) => ({
    engine_id: e.engine_id,
    engine_name: engineMap[e.engine_id] ?? e.engine_id.slice(0, 8),
    score: e.score,
  }));

  // Engines not yet added to tournament
  const entryIds = new Set(entries.map((e) => e.engine_id));
  const availableEngines = userEngines.filter((e) => !entryIds.has(e.id));
  const canManageTournament =
    !!user &&
    (user.role === "admin" || user.id === tournament.owner_id);

  // Sort entries by score
  const sortedEntries = [...entries].sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-brush text-3xl text-ink">{tournament.name}</h1>
          <Badge
            variant={
              tournament.status === "running"
                ? "default"
                : tournament.status === "finished"
                  ? "secondary"
                  : "outline"
            }
          >
            {STATUS_LABELS[tournament.status]}
          </Badge>
        </div>
        <p className="text-ink-muted">
          {formatTimeControl(
            tournament.time_control_base,
            tournament.time_control_inc,
          )}{" "}
          {tournament.type !== "quick_match" && (
            <>&middot; {FORMAT_LABELS[tournament.format] || "循环赛"} </>
          )}
          &middot;{" "}
          {tournament.format === "knockout"
            ? `每对 ${tournament.rounds * 2} 局`
            : `${tournament.rounds} 轮`}
          {" "}&middot; 创建于{" "}
          {new Date(tournament.created_at * 1000).toLocaleDateString("zh-CN")}
        </p>
      </div>

      {/* Tournament Controls */}
      {canManageTournament && tournament.status === "pending" && (
        <Card>
          <CardHeader>
            <CardTitle className="font-brush text-lg">赛事管理</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add Engine */}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <label className="text-sm font-medium text-ink-light">
                  添加引擎
                </label>
                {availableEngines.length > 0 ? (
                  <Select
                    value={selectedEngineId}
                    onValueChange={(v) => setSelectedEngineId(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择引擎..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEngines.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-ink-muted py-1">
                    {user
                      ? "没有可用公开引擎，请先上传或等待其他用户上传。"
                      : "请先登录。"}
                  </p>
                )}
              </div>
              <Button
                onClick={handleAddEngine}
                disabled={!selectedEngineId || addingEngine}
                variant="outline"
              >
                <Plus className="w-4 h-4" data-icon="inline-start" />
                {addingEngine ? "添加中..." : "添加"}
              </Button>
            </div>
            {addError && (
              <p className="text-sm text-destructive">{addError}</p>
            )}

            <div>
              <Button
                onClick={handleStartTournament}
                disabled={starting || entries.length < 2}
              >
                <Play className="w-4 h-4" data-icon="inline-start" />
                {starting ? "启动中..." : "开始比赛"}
              </Button>
              {entries.length < 2 && (
                <p className="text-xs text-ink-muted mt-1">
                  至少需要 2 个引擎才能开始。
                </p>
              )}
              {startError && (
                <p className="text-sm text-destructive mt-1">{startError}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Format-specific visualization */}
      {entries.length > 0 && (
        <>
          {tournament.format === "knockout" ? (
            <BracketView
              entries={crossEntries}
              games={games}
              engineMap={engineMap}
              status={tournament.status}
              bracketData={bracketData as BracketViewBracketData | null}
            />
          ) : tournament.format === "swiss" ? (
            <SwissStandings
              entries={crossEntries}
              games={games}
              engineMap={engineMap}
              totalRounds={tournament.rounds}
            />
          ) : tournament.format === "gauntlet" ? (
            <GauntletSummary
              entries={crossEntries}
              games={games}
              engineMap={engineMap}
            />
          ) : (
            /* round_robin — original cross table */
            <section>
              <h2 className="font-brush text-2xl text-ink mb-4">交叉表</h2>
              <CrossTable entries={crossEntries} games={games} />
            </section>
          )}
        </>
      )}

      {/* Engine Rankings */}
      <section>
        <h2 className="font-brush text-2xl text-ink mb-4">参赛引擎</h2>
        {entries.length === 0 ? (
          <p className="text-ink-muted text-center py-8 font-brush text-lg">
            暂无引擎参赛
          </p>
        ) : (
          <div className="rounded-lg border border-paper-300 bg-paper-50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-paper-300 hover:bg-transparent">
                  <TableHead className="w-12 text-center text-ink-muted">
                    #
                  </TableHead>
                  <TableHead className="text-ink-muted">引擎</TableHead>
                  <TableHead className="text-right text-ink-muted">
                    得分
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEntries.map((entry, i) => (
                  <TableRow
                    key={entry.engine_id}
                    className="border-paper-300 hover:bg-paper-100/40"
                  >
                    <TableCell className="text-center text-ink-muted">
                      {entry.final_rank ?? i + 1}
                    </TableCell>
                    <TableCell className="font-semibold text-ink">
                      {engineMap[entry.engine_id] ??
                        entry.engine_id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.score}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Games List */}
      {games.length > 0 && (
        <section>
          <h2 className="font-brush text-2xl text-ink mb-4">对局列表</h2>
          <GamesListByRound games={games} engineMap={engineMap} />
        </section>
      )}

      {/* Rematch button for finished quick matches */}
      {tournament.type === "quick_match" &&
        tournament.status === "finished" &&
        user && (
          <div className="text-center py-4">
            <Button
              onClick={handleRematch}
              disabled={rematching}
              variant="outline"
              size="lg"
            >
              <RotateCcw className="w-4 h-4" data-icon="inline-start" />
              {rematching ? "创建中..." : "再来一局"}
            </Button>
          </div>
        )}
    </div>
  );
}
