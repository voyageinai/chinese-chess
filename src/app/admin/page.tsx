"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface SystemStats {
  userCount: number;
  engineCount: number;
  tournamentCount: number;
  activeGameCount: number;
  runningTournaments: string[];
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    fetch("/api/admin/system")
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error);
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

  return (
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
  );
}
