"use client";

import { useEffect, useState } from "react";

interface AuditLog {
  id: string;
  action: string;
  actor_id: string;
  target_type: string | null;
  target_id: string | null;
  details: string | null;
  created_at: number;
}

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/audit-logs?limit=200")
      .then((r) => r.json())
      .then((data) => setLogs(data.logs || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-ink-muted">加载中...</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-4">审计日志</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper-300 text-left text-ink-muted">
              <th className="pb-2 pr-4">时间</th>
              <th className="pb-2 pr-4">操作</th>
              <th className="pb-2 pr-4">操作人</th>
              <th className="pb-2 pr-4">目标</th>
              <th className="pb-2">详情</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              let details = "";
              try {
                const parsed = JSON.parse(log.details || "{}");
                details = Object.entries(parsed)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ");
              } catch {
                details = log.details || "";
              }

              return (
                <tr key={log.id} className="border-b border-paper-200">
                  <td className="py-2 pr-4 text-ink-muted text-xs whitespace-nowrap">
                    {new Date(log.created_at * 1000).toLocaleString("zh-CN")}
                  </td>
                  <td className="py-2 pr-4">
                    <span className="px-2 py-0.5 rounded text-xs bg-paper-200 text-ink font-mono">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-ink-muted text-xs font-mono">
                    {log.actor_id.substring(0, 8)}...
                  </td>
                  <td className="py-2 pr-4 text-ink-muted text-xs">
                    {log.target_type && (
                      <span>
                        {log.target_type}:{log.target_id?.substring(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-ink-muted text-xs max-w-xs truncate">
                    {details}
                  </td>
                </tr>
              );
            })}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-ink-muted">
                  暂无日志
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
