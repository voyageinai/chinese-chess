"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Tournament {
  id: string;
  name: string;
  status: "pending" | "running" | "finished" | "cancelled";
  rounds: number;
  created_at: number;
  finished_at: number | null;
}

export default function AdminTournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");

  async function loadTournaments() {
    try {
      const res = await fetch("/api/tournaments");
      if (res.ok) {
        const data = await res.json();
        setTournaments(data.tournaments);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTournaments();
  }, []);

  async function deleteTournament(id: string) {
    setActionError("");
    const res = await fetch(`/api/admin/tournaments/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error || "删除失败");
      return;
    }
    await loadTournaments();
  }

  async function cancelTournament(id: string) {
    setActionError("");
    const res = await fetch(`/api/admin/tournaments/${id}/cancel`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error || "取消失败");
      return;
    }
    await loadTournaments();
  }

  const statusLabels: Record<string, { text: string; cls: string }> = {
    pending: { text: "待开始", cls: "bg-yellow-100 text-yellow-700" },
    running: { text: "运行中", cls: "bg-blue-100 text-blue-700" },
    finished: { text: "已完成", cls: "bg-green-100 text-green-700" },
    cancelled: { text: "已取消", cls: "bg-gray-100 text-gray-600" },
  };

  if (loading) return <p className="text-ink-muted">加载中...</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-4">锦标赛管理</h2>
      {actionError && (
        <p className="text-red-600 text-sm mb-4">{actionError}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper-300 text-left text-ink-muted">
              <th className="pb-2 pr-4">名称</th>
              <th className="pb-2 pr-4">状态</th>
              <th className="pb-2 pr-4">轮次</th>
              <th className="pb-2 pr-4">创建时间</th>
              <th className="pb-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {tournaments.map((t) => {
              const st = statusLabels[t.status] || statusLabels.pending;
              return (
                <tr key={t.id} className="border-b border-paper-200">
                  <td className="py-3 pr-4 text-ink">{t.name}</td>
                  <td className="py-3 pr-4">
                    <span className={`px-2 py-0.5 rounded text-xs ${st.cls}`}>
                      {st.text}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-ink-muted">{t.rounds}</td>
                  <td className="py-3 pr-4 text-ink-muted">
                    {new Date(t.created_at * 1000).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="py-3 space-x-2">
                    {t.status === "pending" && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteTournament(t.id)}
                      >
                        删除
                      </Button>
                    )}
                    {t.status === "running" && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => cancelTournament(t.id)}
                      >
                        取消
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
