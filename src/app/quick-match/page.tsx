"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Zap, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";

interface Engine {
  id: string;
  name: string;
  elo: number;
  owner?: string;
}

export default function QuickMatchPage() {
  const router = useRouter();
  const [engines, setEngines] = useState<Engine[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [timeBase, setTimeBase] = useState("60");
  const [timeInc, setTimeInc] = useState("1");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) {
          setLoading(false);
          return;
        }
        setAuthenticated(true);

        const engRes = await fetch("/api/leaderboard");
        if (engRes.ok) {
          const data = await engRes.json();
          setEngines(data.leaderboard ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function toggleEngine(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 4) {
          setError("快速对弈最多选择 4 个引擎");
          return prev;
        }
        next.add(id);
      }
      setError("");
      return next;
    });
  }

  async function handleStart() {
    if (selectedIds.size < 2) {
      setError("至少选择 2 个引擎");
      return;
    }
    setStarting(true);
    setError("");

    try {
      const res = await fetch("/api/quick-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engineIds: [...selectedIds],
          timeBase: parseInt(timeBase, 10),
          timeInc: parseInt(timeInc, 10),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "启动失败");
        return;
      }

      router.push(`/tournaments/${data.tournament.id}`);
    } catch {
      setError("网络错误");
    } finally {
      setStarting(false);
    }
  }

  // Calculate total games
  const n = selectedIds.size;
  const totalGames = n >= 2 ? (n * (n - 1)) / 2 * 2 : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="font-brush text-2xl text-ink-muted animate-pulse">
          载入中...
        </p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="text-center py-16 text-ink-muted">
        <Zap className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="font-brush text-xl">请先登录</p>
        <p className="text-sm mt-1">登录后即可使用快速对弈功能。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-brush text-3xl text-ink">快速对弈</h1>
        <p className="text-ink-muted mt-1">
          选择引擎，一键开始。每对引擎互换红黑各战一局。
        </p>
      </div>

      {/* Engine Selection */}
      <section>
        <h2 className="font-brush text-xl text-ink mb-3">
          选择引擎{" "}
          <span className="text-sm font-sans font-normal text-ink-muted">
            (已选 {selectedIds.size}/4)
          </span>
        </h2>

        {engines.length === 0 ? (
          <p className="text-ink-muted text-center py-8 font-brush text-lg">
            暂无可用引擎
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {engines.map((engine) => {
              const selected = selectedIds.has(engine.id);
              return (
                <Card
                  key={engine.id}
                  className={`cursor-pointer transition-all ${
                    selected
                      ? "ring-2 ring-vermilion bg-paper-100"
                      : "hover:ring-2 hover:ring-paper-400"
                  }`}
                  onClick={() => toggleEngine(engine.id)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span className="truncate">{engine.name}</span>
                      {selected && (
                        <CheckCircle2 className="w-5 h-5 text-vermilion shrink-0" />
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-3 text-sm text-ink-muted">
                      <span className="font-mono">
                        Elo {Math.round(engine.elo)}
                      </span>
                      {engine.owner && (
                        <span>&middot; {engine.owner}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Advanced Settings */}
      <section>
        <button
          type="button"
          className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
          高级设置
        </button>

        {showAdvanced && (
          <div className="mt-3 grid grid-cols-2 gap-3 max-w-sm">
            <div className="space-y-1.5">
              <Label htmlFor="timeBase">基础时间 (秒)</Label>
              <Input
                id="timeBase"
                type="number"
                min="1"
                value={timeBase}
                onChange={(e) => setTimeBase(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="timeInc">加秒 (秒)</Label>
              <Input
                id="timeInc"
                type="number"
                min="0"
                value={timeInc}
                onChange={(e) => setTimeInc(e.target.value)}
              />
            </div>
          </div>
        )}
      </section>

      {/* Action Bar */}
      <div className="sticky bottom-0 bg-paper-50/95 backdrop-blur-sm border-t border-paper-300 -mx-6 px-6 py-4">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="text-sm text-ink-muted">
            {selectedIds.size >= 2 ? (
              <span>
                共 <strong className="text-ink">{totalGames}</strong> 局对弈
              </span>
            ) : (
              <span>再选 {2 - selectedIds.size} 个引擎即可开始</span>
            )}
          </div>
          <Button
            onClick={handleStart}
            disabled={starting || selectedIds.size < 2}
            size="lg"
          >
            <Zap className="w-4 h-4" data-icon="inline-start" />
            {starting ? "启动中..." : "开始对弈"}
          </Button>
        </div>
        {error && (
          <p className="text-sm text-destructive mt-2 text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
