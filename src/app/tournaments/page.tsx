"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Trophy, CheckCircle2 } from "lucide-react";

interface LeaderboardEngine {
  id: string;
  name: string;
  elo: number;
}

interface Tournament {
  id: string;
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

function formatTimeControl(base: number, inc: number): string {
  const mins = Math.floor(base / 60);
  const secs = base % 60;
  const baseStr =
    secs > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${mins}`;
  return `${baseStr}+${inc}s`;
}

export default function TournamentsPage() {
  const router = useRouter();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formTimeBase, setFormTimeBase] = useState("300");
  const [formTimeInc, setFormTimeInc] = useState("3");
  const [formRounds, setFormRounds] = useState("1");
  const [formFormat, setFormFormat] = useState("round_robin");
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);

  // Engine selection (tournament mode)
  const [availableEngines, setAvailableEngines] = useState<LeaderboardEngine[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enginesLoading, setEnginesLoading] = useState(false);

  // Ranked mode
  const [myEngines, setMyEngines] = useState<{ id: string; name: string; elo: number }[]>([]);
  const [rankedEngineId, setRankedEngineId] = useState("");
  const [formGameCount, setFormGameCount] = useState("3");

  useEffect(() => {
    Promise.all([
      fetch("/api/tournaments")
        .then((r) => r.json())
        .then((d) => d.tournaments ?? []),
      fetch("/api/auth/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.user ?? null),
    ])
      .then(([tourns, u]) => {
        setTournaments(tourns);
        setUser(u);
      })
      .finally(() => setLoading(false));
  }, []);

  // Lazy-load engines when dialog opens
  useEffect(() => {
    if (!dialogOpen) return;
    setEnginesLoading(true);
    Promise.all([
      fetch("/api/leaderboard").then((r) => r.json()).then((d) => d.leaderboard ?? []),
      fetch("/api/engines?scope=owned").then((r) => r.ok ? r.json() : { engines: [] }).then((d) => d.engines ?? []),
    ])
      .then(([leaderboard, owned]) => {
        setAvailableEngines(leaderboard);
        setMyEngines(owned);
      })
      .catch(() => {})
      .finally(() => setEnginesLoading(false));
  }, [dialogOpen]);

  function toggleEngine(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setCreating(true);

    try {
      let res: Response;

      if (formFormat === "swiss") {
        // Ranked mode → matchmaking API
        if (!rankedEngineId) {
          setFormError("请选择引擎");
          setCreating(false);
          return;
        }
        res = await fetch("/api/quick-match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            engineId: rankedEngineId,
            gameCount: parseInt(formGameCount, 10) || 3,
            timeBase: parseInt(formTimeBase, 10),
            timeInc: parseInt(formTimeInc, 10),
          }),
        });
      } else {
        // Tournament mode → tournament API
        res = await fetch("/api/tournaments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            timeBase: parseInt(formTimeBase, 10),
            timeInc: parseInt(formTimeInc, 10),
            rounds: parseInt(formRounds, 10) || 1,
            format: formFormat,
            engineIds: selectedIds.size > 0 ? [...selectedIds] : undefined,
            autoStart: selectedIds.size >= 2,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "创建失败");
        return;
      }

      setDialogOpen(false);
      router.push(`/tournaments/${data.tournament.id}`);
    } catch {
      setFormError("网络错误");
    } finally {
      setCreating(false);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-brush text-3xl text-ink">锦标赛</h1>
        {user && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={
                <Button>
                  <Plus className="w-4 h-4" data-icon="inline-start" />
                  新建锦标赛
                </Button>
              }
            />
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>新建锦标赛</DialogTitle>
                <DialogDescription>
                  设定赛事参数，选择引擎后即可开始。
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                {formFormat !== "swiss" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name">名称</Label>
                    <Input
                      id="name"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="第一届象棋引擎锦标赛"
                      required={formFormat !== "swiss"}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="timeBase">基础时间 (秒)</Label>
                    <Input
                      id="timeBase"
                      type="number"
                      min="1"
                      value={formTimeBase}
                      onChange={(e) => setFormTimeBase(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="timeInc">加秒 (秒)</Label>
                    <Input
                      id="timeInc"
                      type="number"
                      min="0"
                      value={formTimeInc}
                      onChange={(e) => setFormTimeInc(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>赛制</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ["round_robin", "循环赛", "每对引擎互相对弈"],
                      ["knockout", "淘汰赛", "输者淘汰，决出冠军"],
                      ["gauntlet", "定级赛", "挑战者 vs 多个对手"],
                      ["swiss", "排位赛", "自动匹配对手"],
                    ] as const).map(([val, label, desc]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setFormFormat(val)}
                        className={`rounded-lg border px-3 py-2 text-left transition-all ${
                          formFormat === val
                            ? "border-vermilion bg-vermilion/5 ring-1 ring-vermilion/30"
                            : "border-paper-300 hover:border-paper-400 hover:bg-paper-100"
                        }`}
                      >
                        <span className={`font-semibold text-sm ${formFormat === val ? "text-vermilion" : "text-ink"}`}>
                          {label}
                        </span>
                        <span className="block text-xs text-ink-muted mt-0.5">{desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {formFormat === "swiss" ? (
                  /* ── Ranked mode: pick own engine + game count ── */
                  <>
                    <div className="space-y-1.5">
                      <Label>选择你的引擎</Label>
                      {enginesLoading ? (
                        <p className="text-sm text-ink-muted animate-pulse py-2">加载中...</p>
                      ) : myEngines.length === 0 ? (
                        <p className="text-sm text-ink-muted py-2">请先上传引擎</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {myEngines.map((e) => (
                            <button
                              key={e.id}
                              type="button"
                              onClick={() => setRankedEngineId(e.id)}
                              className={`rounded-lg border px-3 py-2 text-left transition-all ${
                                rankedEngineId === e.id
                                  ? "border-vermilion bg-vermilion/5 ring-1 ring-vermilion/30"
                                  : "border-paper-300 hover:border-paper-400 hover:bg-paper-100"
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                {rankedEngineId === e.id && (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-vermilion shrink-0" />
                                )}
                                <span className="font-semibold text-sm text-ink truncate">{e.name}</span>
                              </span>
                              <span className="block text-xs text-ink-muted font-mono">{Math.round(e.elo)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="gameCount">对局数</Label>
                      <Input
                        id="gameCount"
                        type="number"
                        min="1"
                        max="20"
                        value={formGameCount}
                        onChange={(e) => setFormGameCount(e.target.value)}
                        required
                      />
                      <p className="text-xs text-ink-muted">
                        系统自动匹配不重复对手，每局随机分配红黑方
                      </p>
                    </div>
                  </>
                ) : (
                  /* ── Tournament mode: rounds + multi-engine selection ── */
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="rounds">
                        {formFormat === "knockout" ? "每对局数" : "轮次"}
                      </Label>
                      <Input
                        id="rounds"
                        type="number"
                        min="1"
                        value={formRounds}
                        onChange={(e) => setFormRounds(e.target.value)}
                        required
                      />
                      <p className="text-xs text-ink-muted">
                        {formFormat === "round_robin" && "每对引擎互换颜色各打 1 局 × 轮数"}
                        {formFormat === "knockout" && "淘汰赛轮数自动计算，此处设每对的对局轮数"}
                        {formFormat === "gauntlet" && "挑战者与每个对手互换颜色各打 1 局 × 轮数"}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        选择引擎{" "}
                        <span className="text-ink-muted text-xs font-normal">
                          （可选，稍后也可在赛事页添加）
                        </span>
                      </Label>
                      {enginesLoading ? (
                        <p className="text-sm text-ink-muted animate-pulse py-2">加载引擎列表...</p>
                      ) : availableEngines.length === 0 ? (
                        <p className="text-sm text-ink-muted py-2">暂无可用引擎</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-1">
                          {availableEngines.map((e) => (
                            <button
                              key={e.id}
                              type="button"
                              onClick={() => toggleEngine(e.id)}
                              className={`rounded-lg border px-3 py-2 text-left transition-all ${
                                selectedIds.has(e.id)
                                  ? "border-vermilion bg-vermilion/5 ring-1 ring-vermilion/30"
                                  : "border-paper-300 hover:border-paper-400 hover:bg-paper-100"
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                {selectedIds.has(e.id) && (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-vermilion shrink-0" />
                                )}
                                <span className="font-semibold text-sm text-ink truncate">{e.name}</span>
                              </span>
                              <span className="block text-xs text-ink-muted font-mono">{Math.round(e.elo)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {selectedIds.size > 0 && (
                        <p className="text-xs text-ink-muted">
                          已选 {selectedIds.size} 个引擎
                          {selectedIds.size >= 2 && " · 创建后将自动开始"}
                        </p>
                      )}
                    </div>
                  </>
                )}

                {formError && (
                  <p className="text-sm text-destructive">{formError}</p>
                )}
                <Button type="submit" disabled={creating} className="w-full">
                  {creating
                    ? "创建中..."
                    : formFormat === "swiss"
                      ? "开始排位"
                      : selectedIds.size >= 2
                        ? "创建并开始"
                        : "创建"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {tournaments.length === 0 ? (
        <div className="text-center py-16 text-ink-muted">
          <Trophy className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="font-brush text-xl">暂无锦标赛</p>
          <p className="text-sm mt-1">
            {user ? "你可以创建第一场锦标赛。" : "登录后即可创建锦标赛。"}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => (
            <Link key={t.id} href={`/tournaments/${t.id}`}>
              <Card className="hover:ring-2 hover:ring-paper-400 transition-all cursor-pointer h-full">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span className="truncate flex items-center gap-2">
                      {t.type === "quick_match" && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          快速对弈
                        </Badge>
                      )}
                      {t.name}
                    </span>
                    <Badge
                      variant={
                        t.status === "running"
                          ? "default"
                          : t.status === "finished"
                            ? "secondary"
                            : "outline"
                      }
                      className="shrink-0"
                    >
                      {STATUS_LABELS[t.status]}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {t.type !== "quick_match" && (
                      <>{FORMAT_LABELS[t.format] || "循环赛"} &middot; </>
                    )}
                    {formatTimeControl(t.time_control_base, t.time_control_inc)}{" "}
                    &middot; {t.rounds} 轮
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-ink-muted">
                    创建于{" "}
                    {new Date(t.created_at * 1000).toLocaleDateString("zh-CN")}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
