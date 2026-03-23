"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { Cpu, Upload, Trash2 } from "lucide-react";

interface Engine {
  id: string;
  name: string;
  elo: number;
  games_played: number;
  uploaded_at: number;
}

export default function EnginesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [engines, setEngines] = useState<Engine[]>([]);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  // Upload form
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) {
          setAuthenticated(false);
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

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile || !uploadName.trim()) return;

    setUploading(true);
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("name", uploadName.trim());
      formData.append("file", uploadFile);

      const res = await fetch("/api/engines", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "上传失败");
        return;
      }

      setEngines((prev) => [data.engine, ...prev]);
      setUploadName("");
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setUploadError("网络错误");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(engineId: string) {
    if (confirmDeleteId !== engineId) {
      setDeleteError("");
      setConfirmDeleteId(engineId);
      return;
    }

    setDeletingId(engineId);
    try {
      const res = await fetch(`/api/engines/${engineId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setEngines((prev) => prev.filter((e) => e.id !== engineId));
      } else {
        const data = await res.json().catch(() => null);
        setDeleteError(data?.error || "删除失败");
      }
    } catch {
      setDeleteError("网络错误");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
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
      <div className="text-center py-16">
        <Cpu className="w-10 h-10 mx-auto mb-3 text-ink-muted opacity-50" />
        <p className="font-brush text-xl text-ink-muted mb-4">
          请先登录以管理引擎
        </p>
        <Button variant="outline" onClick={() => router.push("/login")}>
          前往登录
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="font-brush text-3xl text-ink">我的引擎</h1>

      {/* Upload Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            上传引擎
          </CardTitle>
          <CardDescription>
            上传 UCI 协议兼容的象棋引擎二进制文件。上传后默认对全站公开可用。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="engineName">引擎名称</Label>
                <Input
                  id="engineName"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="Stockfish 16"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="engineFile">二进制文件</Label>
                <Input
                  id="engineFile"
                  ref={fileInputRef}
                  type="file"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  required
                />
              </div>
            </div>
            {uploadError && (
              <p className="text-sm text-destructive">{uploadError}</p>
            )}
            <Button type="submit" disabled={uploading}>
              {uploading ? "上传中..." : "上传"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Engine List */}
      {engines.length === 0 ? (
        <div className="text-center py-12 text-ink-muted">
          <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="font-brush text-lg">暂无引擎</p>
          <p className="text-sm mt-1">使用上方表单上传您的第一个引擎。</p>
        </div>
      ) : (
        <>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {engines.map((engine) => (
              <Card key={engine.id}>
                <CardHeader>
                  <CardTitle className="truncate">{engine.name}</CardTitle>
                  <CardAction>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      onClick={() => handleDelete(engine.id)}
                      disabled={deletingId === engine.id}
                      title={
                        confirmDeleteId === engine.id
                          ? "再次点击确认删除"
                          : "删除引擎"
                      }
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </CardAction>
                  <CardDescription>
                    {confirmDeleteId === engine.id && (
                      <span className="text-destructive font-medium">
                        再次点击确认删除
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">等级分</span>
                    <span className="font-mono font-semibold">{engine.elo}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-ink-muted">对局数</span>
                    <span className="font-mono">{engine.games_played}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-ink-muted">上传时间</span>
                    <span className="text-xs text-ink-muted">
                      {new Date(engine.uploaded_at * 1000).toLocaleDateString(
                        "zh-CN",
                      )}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
