"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, ChevronDown, ChevronUp, CheckCircle2, Cpu } from "lucide-react";

interface Engine {
  id: string;
  name: string;
  elo: number;
}

export default function QuickMatchPage() {
  const router = useRouter();
  const [engines, setEngines] = useState<Engine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gameCount, setGameCount] = useState("1");
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

        const engRes = await fetch("/api/engines?scope=owned");
        if (engRes.ok) {
          const data = await engRes.json();
          setEngines(data.engines ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleStart() {
    if (!selectedId) {
      setError("请选择一个引擎");
      return;
    }
    setStarting(true);
    setError("");

    try {
      const res = await fetch("/api/quick-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engineId: selectedId,
          gameCount: parseInt(gameCount, 10) || 1,
          timeBase: parseInt(timeBase, 10),
          timeInc: parseInt(timeInc, 10),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "启动失败");
        return;
      }

      // Single game: jump directly to game page
      if (data.gameId) {
        router.push(`/games/${data.gameId}`);
      } else {
        router.push(`/tournaments/${data.tournament.id}`);
      }
    } catch {
      setError("网络错误");
    } finally {
      setStarting(false);
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

  if (!authenticated) {
    return (
      <div className="text-center py-16 text-ink-muted">
        <Zap className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="font-brush text-xl">请先登录</p>
        <p className="text-sm mt-1">登录后即可使用快速对弈功能。</p>
      </div>
    );
  }

  if (engines.length === 0) {
    return (
      <div className="text-center py-16 text-ink-muted">
        <Cpu className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="font-brush text-xl">请先上传引擎</p>
        <p className="text-sm mt-1 mb-4">上传你的象棋引擎后即可开始对弈。</p>
        <Button variant="outline" onClick={() => router.push("/engines")}>
          前往上传
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <h1 className="font-brush text-4xl text-ink flex items-center justify-center gap-3">
          <Zap className="w-8 h-8" />
          排位赛
        </h1>
        <p className="mt-2 text-ink-light">
          选择你的引擎，系统自动匹配对手
        </p>
      </div>

      {/* Engine selection */}
      <div className="space-y-2">
        <h2 className="font-brush text-xl text-ink">选择引擎</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {engines.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelectedId(e.id)}
              className={`rounded-lg border px-4 py-3 text-left transition-all ${
                selectedId === e.id
                  ? "border-vermilion bg-vermilion/5 ring-2 ring-vermilion/30"
                  : "border-paper-300 hover:border-paper-400 hover:bg-paper-100"
              }`}
            >
              <span className="flex items-center gap-2">
                {selectedId === e.id && (
                  <CheckCircle2 className="w-4 h-4 text-vermilion shrink-0" />
                )}
                <span className="font-semibold text-ink">{e.name}</span>
              </span>
              <span className="block text-sm text-ink-muted font-mono mt-1">
                Elo {Math.round(e.elo)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Game count */}
      <div className="space-y-1.5">
        <Label htmlFor="gameCount">对局数</Label>
        <Input
          id="gameCount"
          type="number"
          min="1"
          max="20"
          value={gameCount}
          onChange={(e) => setGameCount(e.target.value)}
          className="w-24"
        />
        <p className="text-xs text-ink-muted">
          每局随机匹配不重复对手，随机分配红黑方
        </p>
      </div>

      {/* Advanced settings */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition-colors"
        >
          {showAdvanced ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
          高级设置
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-2 gap-3 mt-3">
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
      </div>

      {/* Error */}
      {error && <p className="text-sm text-destructive text-center">{error}</p>}

      {/* Start button */}
      <div className="sticky bottom-0 bg-paper-50/90 backdrop-blur-sm py-4 border-t border-paper-300 -mx-6 px-6">
        <Button
          onClick={handleStart}
          disabled={!selectedId || starting}
          className="w-full"
          size="lg"
        >
          <Zap className="w-4 h-4" data-icon="inline-start" />
          {starting ? "匹配中..." : parseInt(gameCount) > 1 ? `开始排位 (${gameCount} 局)` : "开始对弈"}
        </Button>
        <p className="text-xs text-ink-muted text-center mt-2">
          自动匹配 Elo 相近的对手
        </p>
      </div>
    </div>
  );
}
