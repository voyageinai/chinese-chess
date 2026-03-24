"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface User {
  id: string;
  username: string;
  role: "admin" | "user";
  status: "active" | "banned";
  created_at: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");

  async function loadUsers() {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function updateUser(id: string, body: Record<string, string>) {
    setActionError("");
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      setActionError(data.error || "操作失败");
      return;
    }
    await loadUsers();
  }

  if (loading) return <p className="text-ink-muted">加载中...</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-4">用户管理</h2>
      {actionError && (
        <p className="text-red-600 text-sm mb-4">{actionError}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper-300 text-left text-ink-muted">
              <th className="pb-2 pr-4">用户名</th>
              <th className="pb-2 pr-4">角色</th>
              <th className="pb-2 pr-4">状态</th>
              <th className="pb-2 pr-4">注册时间</th>
              <th className="pb-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-paper-200">
                <td className="py-3 pr-4 text-ink">{u.username}</td>
                <td className="py-3 pr-4">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      u.role === "admin"
                        ? "bg-vermilion/10 text-vermilion"
                        : "bg-paper-200 text-ink-muted"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      u.status === "banned"
                        ? "bg-red-100 text-red-700"
                        : "bg-green-100 text-green-700"
                    }`}
                  >
                    {u.status === "banned" ? "已封禁" : "正常"}
                  </span>
                </td>
                <td className="py-3 pr-4 text-ink-muted">
                  {new Date(u.created_at * 1000).toLocaleDateString("zh-CN")}
                </td>
                <td className="py-3 space-x-2">
                  {u.role === "user" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateUser(u.id, { role: "admin" })}
                    >
                      升级管理员
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateUser(u.id, { role: "user" })}
                    >
                      降为用户
                    </Button>
                  )}
                  {u.status === "active" ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => updateUser(u.id, { status: "banned" })}
                    >
                      封禁
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateUser(u.id, { status: "active" })}
                    >
                      解封
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
