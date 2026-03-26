"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface DistributedStats {
  enabled: boolean;
  workers: { id: string; status: string }[];
  leases: { gameId: string }[];
  stats: {
    totalWorkers: number;
    onlineWorkers: number;
    activeLeases: number;
  };
}

interface SystemStats {
  userCount: number;
  engineCount: number;
  tournamentCount: number;
  activeGameCount: number;
  runningTournaments: string[];
  distributed: DistributedStats;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/admin/system")
        .then((r) => r.json())
        .then(setStats)
        .catch(console.error);
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  if (!stats) {
    return <p className="text-ink-muted">加载中...</p>;
  }

  const items = [
    { label: "用户数", value: stats.userCount },
    { label: "引擎数", value: stats.engineCount },
    { label: "锦标赛数", value: stats.tournamentCount },
    { label: "活跃比赛", value: stats.activeGameCount },
    { label: "运行中锦标赛", value: stats.runningTournaments.length },
  ];

  const d = stats.distributed;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardTitle className="text-sm text-ink-muted">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-ink">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {d.enabled && (
        <div>
          <h2 className="text-lg font-semibold text-ink mb-3">分布式集群</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-ink-muted">Worker 在线</CardTitle>
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
                <CardTitle className="text-sm text-ink-muted">Worker 对局</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold text-ink">{d.stats.activeLeases}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
