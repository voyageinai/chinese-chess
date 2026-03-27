"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface ShardCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

interface JobWithProgress {
  id: string;
  kind: string;
  status: string;
  output_path: string;
  params_json: string;
  shard_count: number;
  created_at: number;
  finished_at: number | null;
  error_text: string | null;
  shardCounts: ShardCounts;
  totalPositions: number;
  collectedPositions: number;
}

interface ShardRow {
  id: string;
  shard_index: number;
  status: string;
  worker_id: string | null;
  positions: number;
  progress_positions: number;
  progress_games: number;
  pending_command: string | null;
  result_type: string | null;
  last_heartbeat_at: number | null;
  error_text: string | null;
}

function timeAgo(ts: number): string {
  const diff = Math.round((Date.now() - ts * 1000) / 1000);
  if (diff < 5) return "刚刚";
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  return `${Math.floor(diff / 3600)}小时前`;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-400",
  running: "bg-blue-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  finalizing: "bg-yellow-500",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "等待中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  finalizing: "合并中",
};

export default function ResearchPage() {
  const [jobs, setJobs] = useState<JobWithProgress[]>([]);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [shards, setShards] = useState<ShardRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/research/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchShards = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/admin/research/jobs/${jobId}`);
      if (res.ok) {
        const data = await res.json();
        setShards(data.shards);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const timer = setInterval(fetchJobs, 5000);
    return () => clearInterval(timer);
  }, [fetchJobs]);

  useEffect(() => {
    if (!expandedJob) return;
    fetchShards(expandedJob);
    const timer = setInterval(() => fetchShards(expandedJob), 5000);
    return () => clearInterval(timer);
  }, [expandedJob, fetchShards]);

  async function sendCommand(
    type: "job" | "shard",
    id: string,
    command: "stop" | "cancel",
  ) {
    const path =
      type === "job"
        ? `/api/admin/research/jobs/${id}/${command}`
        : `/api/admin/research/shards/${id}/${command}`;
    try {
      await fetch(path, { method: "POST" });
      if (expandedJob) fetchShards(expandedJob);
      fetchJobs();
    } catch {
      // ignore
    }
  }

  if (loading) {
    return <p className="text-ink-muted">加载中...</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>研究任务</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-ink-muted text-sm">暂无研究任务</p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const progress =
                  job.totalPositions > 0
                    ? Math.round(
                        (job.collectedPositions / job.totalPositions) * 100,
                      )
                    : 0;
                const isExpanded = expandedJob === job.id;
                const isRunning = job.status === "running";

                return (
                  <div
                    key={job.id}
                    className="border border-paper-300 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-2 h-2 rounded-full ${STATUS_COLORS[job.status] ?? "bg-gray-400"}`}
                        />
                        <span className="font-mono text-xs text-ink-muted">
                          {job.id.slice(0, 8)}
                        </span>
                        <span className="text-sm font-medium">
                          {job.kind} &middot;{" "}
                          {STATUS_LABELS[job.status] ?? job.status}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {job.shard_count} shards &middot;{" "}
                          {job.totalPositions.toLocaleString()} positions
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isRunning && (
                          <>
                            <button
                              onClick={() => sendCommand("job", job.id, "stop")}
                              className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                            >
                              停止
                            </button>
                            <button
                              onClick={() =>
                                sendCommand("job", job.id, "cancel")
                              }
                              className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200"
                            >
                              取消
                            </button>
                          </>
                        )}
                        <button
                          onClick={() =>
                            setExpandedJob(isExpanded ? null : job.id)
                          }
                          className="px-2 py-1 text-xs bg-paper-200 text-ink-muted rounded hover:bg-paper-300"
                        >
                          {isExpanded ? "收起" : "展开"}
                        </button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-paper-200 rounded-full h-2 mb-1">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${Math.min(100, progress)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-ink-muted">
                      <span>
                        {job.collectedPositions.toLocaleString()} /{" "}
                        {job.totalPositions.toLocaleString()}
                      </span>
                      <span>{progress}%</span>
                    </div>

                    {job.error_text && (
                      <p className="text-xs text-red-600 mt-1">
                        {job.error_text}
                      </p>
                    )}

                    {/* Expanded shard detail */}
                    {isExpanded && (
                      <div className="mt-4 border-t border-paper-200 pt-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-ink-muted text-left">
                              <th className="pb-1">Shard</th>
                              <th className="pb-1">状态</th>
                              <th className="pb-1">Worker</th>
                              <th className="pb-1">进度</th>
                              <th className="pb-1">对局</th>
                              <th className="pb-1">心跳</th>
                              <th className="pb-1">命令</th>
                              <th className="pb-1">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shards.map((s) => (
                              <tr
                                key={s.id}
                                className="border-t border-paper-100"
                              >
                                <td className="py-1.5 font-mono">
                                  {s.shard_index}
                                </td>
                                <td className="py-1.5">
                                  <span className="flex items-center gap-1">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[s.status] ?? "bg-gray-400"}`}
                                    />
                                    {STATUS_LABELS[s.status] ?? s.status}
                                    {s.result_type === "partial" && (
                                      <span className="text-yellow-600">
                                        (部分)
                                      </span>
                                    )}
                                  </span>
                                </td>
                                <td className="py-1.5 font-mono text-ink-muted">
                                  {s.worker_id ?? "-"}
                                </td>
                                <td className="py-1.5">
                                  {s.progress_positions.toLocaleString()} /{" "}
                                  {s.positions.toLocaleString()}
                                </td>
                                <td className="py-1.5">{s.progress_games}</td>
                                <td className="py-1.5 text-ink-muted">
                                  {s.last_heartbeat_at
                                    ? timeAgo(s.last_heartbeat_at)
                                    : "-"}
                                </td>
                                <td className="py-1.5">
                                  {s.pending_command ? (
                                    <span className="text-yellow-600">
                                      {s.pending_command}
                                    </span>
                                  ) : (
                                    "-"
                                  )}
                                </td>
                                <td className="py-1.5">
                                  {s.status === "running" &&
                                    !s.pending_command && (
                                      <div className="flex gap-1">
                                        <button
                                          onClick={() =>
                                            sendCommand(
                                              "shard",
                                              s.id,
                                              "stop",
                                            )
                                          }
                                          className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                                        >
                                          停止
                                        </button>
                                        <button
                                          onClick={() =>
                                            sendCommand(
                                              "shard",
                                              s.id,
                                              "cancel",
                                            )
                                          }
                                          className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded hover:bg-red-200"
                                        >
                                          取消
                                        </button>
                                      </div>
                                    )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
