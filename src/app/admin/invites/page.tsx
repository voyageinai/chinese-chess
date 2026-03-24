"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InviteCode {
  code: string;
  created_by: string;
  used_by: string | null;
  expires_at: number;
  created_at: number;
}

export default function AdminInvitesPage() {
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [newCode, setNewCode] = useState("");
  const [actionError, setActionError] = useState("");
  const [copiedCode, setCopiedCode] = useState("");

  function copyToClipboard(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(""), 2000);
    });
  }

  async function loadInvites() {
    try {
      const res = await fetch("/api/admin/invites");
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvites();
  }, []);

  async function createInvite() {
    setCreating(true);
    setActionError("");
    setNewCode("");
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: parseInt(expiresInDays, 10) }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewCode(data.code);
        await loadInvites();
      } else {
        const data = await res.json();
        setActionError(data.error || "创建失败");
      }
    } catch {
      setActionError("创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function revokeInvite(code: string) {
    setActionError("");
    const res = await fetch(`/api/admin/invites/${code}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error || "撤销失败");
      return;
    }
    await loadInvites();
  }

  const now = Math.floor(Date.now() / 1000);

  if (loading) return <p className="text-ink-muted">加载中...</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-4">邀请码管理</h2>

      <div className="mb-6 p-4 border border-paper-300 rounded-lg">
        <h3 className="text-sm font-medium text-ink mb-3">生成新邀请码</h3>
        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="expires">有效期（天）</Label>
            <Input
              id="expires"
              type="number"
              min="1"
              max="365"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="w-24"
            />
          </div>
          <Button onClick={createInvite} disabled={creating}>
            {creating ? "生成中..." : "生成"}
          </Button>
        </div>
        {newCode && (
          <div className="mt-3 p-3 bg-green-50 rounded text-sm flex items-center gap-3">
            <div className="flex-1">
              <p className="text-green-800 font-medium mb-1">新邀请码已生成：</p>
              <code className="text-green-900 font-mono select-all break-all">{newCode}</code>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(newCode)}
            >
              {copiedCode === newCode ? "已复制" : "复制"}
            </Button>
          </div>
        )}
      </div>

      {actionError && (
        <p className="text-red-600 text-sm mb-4">{actionError}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper-300 text-left text-ink-muted">
              <th className="pb-2 pr-4">邀请码</th>
              <th className="pb-2 pr-4">状态</th>
              <th className="pb-2 pr-4">过期时间</th>
              <th className="pb-2 pr-4">创建时间</th>
              <th className="pb-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => {
              const isUsed = !!inv.used_by;
              const isExpired = inv.expires_at < now;
              let statusText = "可用";
              let statusCls = "bg-green-100 text-green-700";
              if (isUsed) {
                statusText = "已使用";
                statusCls = "bg-gray-100 text-gray-600";
              } else if (isExpired) {
                statusText = "已过期";
                statusCls = "bg-red-100 text-red-700";
              }

              return (
                <tr key={inv.code} className="border-b border-paper-200">
                  <td className="py-3 pr-4 font-mono text-ink text-xs">
                    <span className="select-all break-all">{inv.code}</span>
                    <button
                      className="ml-2 text-ink-muted hover:text-ink text-xs underline"
                      onClick={() => copyToClipboard(inv.code)}
                    >
                      {copiedCode === inv.code ? "已复制" : "复制"}
                    </button>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`px-2 py-0.5 rounded text-xs ${statusCls}`}>
                      {statusText}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-ink-muted">
                    {new Date(inv.expires_at * 1000).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="py-3 pr-4 text-ink-muted">
                    {new Date(inv.created_at * 1000).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="py-3">
                    {!isUsed && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => revokeInvite(inv.code)}
                      >
                        撤销
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {invites.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-ink-muted">
                  暂无邀请码
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
