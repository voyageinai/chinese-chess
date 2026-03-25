"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Leaderboard } from "@/components/Leaderboard";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Trophy, ArrowRight } from "lucide-react";

interface LeaderboardEngine {
  id: string;
  name: string;
  elo: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  owner: string;
}

interface Tournament {
  id: string;
  name: string;
  status: "pending" | "running" | "finished";
  type: "tournament" | "quick_match";
  time_control_base: number;
  time_control_inc: number;
  rounds: number;
  created_at: number;
  finished_at: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待开始",
  running: "进行中",
  finished: "已结束",
};

function formatTimeControl(base: number, inc: number): string {
  const mins = Math.floor(base / 60);
  const secs = base % 60;
  const baseStr = secs > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${mins}`;
  return `${baseStr}+${inc}s`;
}

export default function Home() {
  const [engines, setEngines] = useState<LeaderboardEngine[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/leaderboard")
        .then((r) => r.json())
        .then((d) => d.leaderboard ?? []),
      fetch("/api/tournaments")
        .then((r) => r.json())
        .then((d) => d.tournaments ?? []),
    ])
      .then(([leaderboard, tourns]) => {
        setEngines(leaderboard);
        setTournaments(tourns.slice(0, 5));
      })
      .finally(() => setLoading(false));
  }, []);

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
    <div className="space-y-12">
      {/* Hero */}
      <header className="text-center py-8">
        <h1 className="font-brush text-3xl sm:text-5xl text-ink">象棋擂台</h1>
        <p className="mt-3 text-ink-light text-lg">中国象棋引擎锦标赛平台</p>
      </header>

      {/* Leaderboard */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-brush text-2xl text-ink">排行榜</h2>
        </div>
        <Leaderboard engines={engines} />
      </section>

      {/* Recent Tournaments */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-brush text-2xl text-ink">近期锦标赛</h2>
          <Link
            href="/tournaments"
            className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors"
          >
            查看全部 <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {tournaments.length === 0 ? (
          <div className="text-center py-8 text-ink-muted">
            <Trophy className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="font-brush text-lg">暂无锦标赛</p>
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
      </section>
    </div>
  );
}
