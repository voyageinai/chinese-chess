"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Engine {
  id: string;
  user_id: string;
  name: string;
  visibility: string;
  status: "active" | "disabled";
  elo: number;
  games_played: number;
  uploaded_at: number;
}

export default function AdminEnginesPage() {
  const [engines, setEngines] = useState<Engine[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");

  async function loadEngines() {
    try {
      const res = await fetch("/api/admin/engines");
      if (res.ok) {
        const data = await res.json();
        setEngines(data.engines);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEngines();
  }, []);

  async function toggleStatus(id: string, currentStatus: string) {
    setActionError("");
    const newStatus = currentStatus === "active" ? "disabled" : "active";
    const res = await fetch(`/api/admin/engines/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error || "操作失败");
      return;
    }
    await loadEngines();
  }

  if (loading) return <p className="text-ink-muted">加载中...</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-4">引擎管理</h2>
      {actionError && (
        <p className="text-red-600 text-sm mb-4">{actionError}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper-300 text-left text-ink-muted">
              <th className="pb-2 pr-4">名称</th>
              <th className="pb-2 pr-4">可见性</th>
              <th className="pb-2 pr-4">状态</th>
              <th className="pb-2 pr-4">Elo</th>
              <th className="pb-2 pr-4">对局数</th>
              <th className="pb-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {engines.map((e) => (
              <tr key={e.id} className="border-b border-paper-200">
                <td className="py-3 pr-4 text-ink">{e.name}</td>
                <td className="py-3 pr-4 text-ink-muted">{e.visibility}</td>
                <td className="py-3 pr-4">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      e.status === "disabled"
                        ? "bg-red-100 text-red-700"
                        : "bg-green-100 text-green-700"
                    }`}
                  >
                    {e.status === "disabled" ? "已禁用" : "正常"}
                  </span>
                </td>
                <td className="py-3 pr-4 text-ink">{Math.round(e.elo)}</td>
                <td className="py-3 pr-4 text-ink-muted">{e.games_played}</td>
                <td className="py-3">
                  <Button
                    variant={e.status === "active" ? "destructive" : "outline"}
                    size="sm"
                    onClick={() => toggleStatus(e.id, e.status)}
                  >
                    {e.status === "active" ? "禁用" : "启用"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
