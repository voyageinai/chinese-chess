"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { Plus, Trophy } from "lucide-react";

interface Tournament {
  id: string;
  name: string;
  status: "pending" | "running" | "finished";
  time_control_base: number;
  time_control_inc: number;
  rounds: number;
  created_at: number;
  finished_at: number | null;
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

function formatTimeControl(base: number, inc: number): string {
  const mins = Math.floor(base / 60);
  const secs = base % 60;
  const baseStr =
    secs > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${mins}`;
  return `${baseStr}+${inc}s`;
}

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formTimeBase, setFormTimeBase] = useState("300");
  const [formTimeInc, setFormTimeInc] = useState("3");
  const [formRounds, setFormRounds] = useState("1");
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setCreating(true);

    try {
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          timeBase: parseInt(formTimeBase, 10),
          timeInc: parseInt(formTimeInc, 10),
          rounds: parseInt(formRounds, 10) || 1,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "创建失败");
        return;
      }

      setTournaments((prev) => [data.tournament, ...prev]);
      setDialogOpen(false);
      setFormName("");
      setFormTimeBase("300");
      setFormTimeInc("3");
      setFormRounds("1");
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
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建锦标赛</DialogTitle>
                <DialogDescription>
                  设定锦标赛参数后开始创建。
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">名称</Label>
                  <Input
                    id="name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="第一届象棋引擎锦标赛"
                    required
                  />
                </div>
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
                  <Label htmlFor="rounds">轮次</Label>
                  <Input
                    id="rounds"
                    type="number"
                    min="1"
                    value={formRounds}
                    onChange={(e) => setFormRounds(e.target.value)}
                    required
                  />
                </div>
                {formError && (
                  <p className="text-sm text-destructive">{formError}</p>
                )}
                <Button type="submit" disabled={creating} className="w-full">
                  {creating ? "创建中..." : "创建"}
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
                    <span className="truncate">{t.name}</span>
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
