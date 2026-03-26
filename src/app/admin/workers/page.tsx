"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface WorkerInfo {
  id: string;
  status: "online" | "idle" | "offline";
  currentGames: string[];
  lastSeenAt: number;
  completedGames: number;
}

interface LeaseInfo {
  gameId: string;
  leaseId: string;
  workerId: string;
  grantedAt: number;
  expiresAt: number;
  ply: number;
}

interface DistributedData {
  enabled: boolean;
  workers: WorkerInfo[];
  leases: LeaseInfo[];
  stats: {
    totalWorkers: number;
    onlineWorkers: number;
    activeLeases: number;
  };
}

interface SystemData {
  distributed: DistributedData;
  activeGameCount: number;
}

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  online: { text: "运行中", color: "bg-green-500" },
  idle: { text: "空闲", color: "bg-yellow-500" },
  offline: { text: "离线", color: "bg-red-500" },
};

function timeAgo(ts: number): string {
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 5) return "刚刚";
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  return `${Math.floor(diff / 3600)}小时前`;
}

function countdown(expiresAt: number): string {
  const remain = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  if (remain === 0) return "已过期";
  return `${remain}s`;
}

function duration(startMs: number): string {
  const secs = Math.round((Date.now() - startMs) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m${remainSecs}s`;
}

export default function WorkersPage() {
  const [data, setData] = useState<SystemData | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = () =>
      fetch("/api/admin/system")
        .then((r) => r.json())
        .then(setData)
        .catch(console.error);
    load();
    const fetcher = setInterval(load, 5000);
    // Tick every second to update countdown timers
    const ticker = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(fetcher);
      clearInterval(ticker);
    };
  }, []);

  if (!data) {
    return <p className="text-ink-muted">加载中...</p>;
  }

  const d = data.distributed;

  if (!d.enabled) {
    return (
      <div className="text-ink-muted">
        <p>分布式模式未启用。</p>
        <p className="mt-2 text-sm">
          在 Master 的 <code className="bg-surface-2 px-1 rounded">.env</code> 中设置{" "}
          <code className="bg-surface-2 px-1 rounded">WORKER_SECRET</code> 即可启用。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-ink-muted">Worker 总数</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-ink">
              {d.stats.onlineWorkers}
              <span className="text-base text-ink-muted font-normal">
                {" / "}{d.stats.totalWorkers}
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-ink-muted">活跃 Lease</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-ink">{d.stats.activeLeases}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-ink-muted">活跃比赛总数</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-ink">{data.activeGameCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Worker list */}
      <div>
        <h2 className="text-lg font-semibold text-ink mb-3">Worker 节点</h2>
        {d.workers.length === 0 ? (
          <p className="text-ink-muted text-sm">暂无 Worker 连接过。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-ink-muted text-left">
                  <th className="py-2 pr-4">状态</th>
                  <th className="py-2 pr-4">Worker ID</th>
                  <th className="py-2 pr-4">当前对局</th>
                  <th className="py-2 pr-4">已完成</th>
                  <th className="py-2 pr-4">最后活跃</th>
                </tr>
              </thead>
              <tbody>
                {d.workers.map((w) => {
                  const st = STATUS_LABELS[w.status] || STATUS_LABELS.offline;
                  return (
                    <tr key={w.id} className="border-b border-border/50">
                      <td className="py-2 pr-4">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${st.color}`} />
                          {st.text}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{w.id}</td>
                      <td className="py-2 pr-4">{w.currentGames.length}</td>
                      <td className="py-2 pr-4">{w.completedGames}</td>
                      <td className="py-2 pr-4 text-ink-muted">{timeAgo(w.lastSeenAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Active leases */}
      <div>
        <h2 className="text-lg font-semibold text-ink mb-3">活跃 Lease</h2>
        {d.leases.length === 0 ? (
          <p className="text-ink-muted text-sm">当前没有 Worker 正在执行对局。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-ink-muted text-left">
                  <th className="py-2 pr-4">对局 ID</th>
                  <th className="py-2 pr-4">Worker</th>
                  <th className="py-2 pr-4">步数</th>
                  <th className="py-2 pr-4">已持续</th>
                  <th className="py-2 pr-4">到期倒计时</th>
                </tr>
              </thead>
              <tbody>
                {d.leases.map((l) => (
                  <tr key={l.gameId} className="border-b border-border/50">
                    <td className="py-2 pr-4">
                      <a
                        href={`/games/${l.gameId}`}
                        className="font-mono text-xs text-accent hover:underline"
                      >
                        {l.gameId.slice(0, 10)}...
                      </a>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{l.workerId}</td>
                    <td className="py-2 pr-4">{l.ply}</td>
                    <td className="py-2 pr-4">{duration(l.grantedAt)}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={
                          l.expiresAt - Date.now() < 30000
                            ? "text-red-500"
                            : "text-ink-muted"
                        }
                      >
                        {countdown(l.expiresAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
