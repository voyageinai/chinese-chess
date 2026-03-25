"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Zap, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";

interface Engine {
  id: string;
  name: string;
  elo: number;
}

interface QuickMatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickMatchDialog({ open, onOpenChange }: QuickMatchDialogProps) {
  const router = useRouter();
  const [engines, setEngines] = useState<Engine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gameCount, setGameCount] = useState("1");
  const [timeBase, setTimeBase] = useState("60");
  const [timeInc, setTimeInc] = useState("1");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    fetch("/api/engines?scope=owned&status=active")
      .then((r) => (r.ok ? r.json() : { engines: [] }))
      .then((d) => setEngines(d.engines ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

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

      onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            排位赛
          </DialogTitle>
          <DialogDescription>
            选择你的引擎，系统自动匹配 Elo 相近的对手
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-ink-muted animate-pulse py-4 text-center">
            加载引擎列表...
          </p>
        ) : engines.length === 0 ? (
          <div className="text-center py-4 text-ink-muted">
            <p className="text-sm">请先上传引擎</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                onOpenChange(false);
                router.push("/engines");
              }}
            >
              前往上传
            </Button>
          </div>
        ) : (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* Engine selection */}
            <div className="space-y-2">
              <Label>选择引擎</Label>
              <div className="grid grid-cols-2 gap-2">
                {engines.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    className={`rounded-lg border px-3 py-2 text-left transition-all ${
                      selectedId === e.id
                        ? "border-vermilion bg-vermilion/5 ring-1 ring-vermilion/30"
                        : "border-paper-300 hover:border-paper-400 hover:bg-paper-100"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {selectedId === e.id && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-vermilion shrink-0" />
                      )}
                      <span className="font-semibold text-sm text-ink truncate">
                        {e.name}
                      </span>
                    </span>
                    <span className="block text-xs text-ink-muted font-mono mt-0.5">
                      Elo {Math.round(e.elo)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Game count */}
            <div className="space-y-1.5">
              <Label htmlFor="qm-gameCount">对局数</Label>
              <Input
                id="qm-gameCount"
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
                    <Label htmlFor="qm-timeBase">基础时间 (秒)</Label>
                    <Input
                      id="qm-timeBase"
                      type="number"
                      min="1"
                      value={timeBase}
                      onChange={(e) => setTimeBase(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="qm-timeInc">加秒 (秒)</Label>
                    <Input
                      id="qm-timeInc"
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
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            {/* Start button */}
            <Button
              onClick={handleStart}
              disabled={!selectedId || starting}
              className="w-full"
              size="lg"
            >
              <Zap className="w-4 h-4" data-icon="inline-start" />
              {starting
                ? "匹配中..."
                : parseInt(gameCount) > 1
                  ? `开始排位 (${gameCount} 局)`
                  : "开始对弈"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
