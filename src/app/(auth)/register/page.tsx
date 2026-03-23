"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function RegisterPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, inviteCode }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "注册失败");
        return;
      }

      router.push("/");
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="font-brush text-2xl">注册</CardTitle>
          <CardDescription>创建象棋擂台账号</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="输入用户名 (2-32字符)"
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入密码 (至少6位)"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inviteCode">邀请码</Label>
              <Input
                id="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="输入邀请码"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "注册中..." : "注册"}
            </Button>
            <p className="text-center text-sm text-ink-muted">
              已有账号？{" "}
              <Link href="/login" className="text-ink hover:underline">
                登录
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
