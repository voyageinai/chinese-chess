"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Swords, Trophy, Cpu, Home, LogIn, User, BookOpen, Shield } from "lucide-react";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/tournaments", label: "锦标赛", icon: Trophy },
  { href: "/engines", label: "引擎", icon: Cpu },
  { href: "/guide", label: "接入指南", icon: BookOpen },
];

interface CurrentUser {
  username: string;
  role: "admin" | "user";
}

export function Navbar() {
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUser(d?.user ?? null))
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [pathname]);

  return (
    <nav className="border-b border-paper-300 bg-paper-100/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Swords className="w-5 h-5 text-vermilion" />
          <span className="font-brush text-xl text-ink">象棋擂台</span>
        </Link>

        <div className="flex items-center gap-6">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 text-sm transition-colors ${
                  active ? "text-ink font-semibold" : "text-ink-muted hover:text-ink"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}

          {checked && (
            <>
              {user ? (
                <>
                  {user.role === "admin" && (
                    <Link
                      href="/admin"
                      className={`flex items-center gap-1.5 text-sm transition-colors ${
                        pathname.startsWith("/admin")
                          ? "text-vermilion font-semibold"
                          : "text-ink-muted hover:text-vermilion"
                      }`}
                    >
                      <Shield className="w-4 h-4" />
                      管理
                    </Link>
                  )}
                  <span className="flex items-center gap-1.5 text-sm text-ink-muted">
                    <User className="w-4 h-4" />
                    {user.username}
                  </span>
                </>
              ) : (
                <Link
                  href="/login"
                  className={`flex items-center gap-1.5 text-sm transition-colors ${
                    pathname === "/login"
                      ? "text-ink font-semibold"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  <LogIn className="w-4 h-4" />
                  登录
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
