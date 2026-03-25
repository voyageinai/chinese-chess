"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Swords, Trophy, Cpu, Home, LogIn, User, BookOpen, Shield, Zap, Database, Menu, X } from "lucide-react";
import { QuickMatchDialog } from "@/components/QuickMatchDialog";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/tournaments", label: "锦标赛", icon: Trophy },
  { href: "/games", label: "对局库", icon: Database },
  { href: "/engines", label: "引擎", icon: Cpu },
  { href: "/guide", label: "接入指南", icon: BookOpen },
];

interface CurrentUser {
  username: string;
  role: "admin" | "user";
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [quickMatchOpen, setQuickMatchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUser(d?.user ?? null))
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [pathname]);

  // Lock body scroll when menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  function handleQuickMatch() {
    if (!user && checked) {
      setMenuOpen(false);
      router.push("/login");
      return;
    }
    setMenuOpen(false);
    setQuickMatchOpen(true);
  }

  const navLinkClass = (href: string) =>
    `flex items-center gap-1.5 text-sm transition-colors ${
      pathname === href ? "text-ink font-semibold" : "text-ink-muted hover:text-ink"
    }`;

  const mobileNavLinkClass = (href: string) =>
    `flex items-center gap-3 px-4 py-3 text-base transition-colors ${
      pathname === href ? "text-ink font-semibold bg-paper-200/60" : "text-ink-muted hover:text-ink hover:bg-paper-200/40"
    }`;

  return (
    <nav className="border-b border-paper-300 bg-paper-100/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Swords className="w-5 h-5 text-vermilion" />
          <span className="font-brush text-xl text-ink">象棋擂台</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          {navItems.slice(0, 1).map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={navLinkClass(item.href)}>
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={handleQuickMatch}
            className="flex items-center gap-1.5 text-sm transition-colors text-ink-muted hover:text-ink"
          >
            <Zap className="w-4 h-4" />
            排位赛
          </button>
          {navItems.slice(1).map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={navLinkClass(item.href)}>
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
                <Link href="/login" className={navLinkClass("/login")}>
                  <LogIn className="w-4 h-4" />
                  登录
                </Link>
              )}
            </>
          )}
        </div>

        {/* Mobile hamburger button */}
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden flex items-center justify-center w-10 h-10 -mr-2 text-ink-muted hover:text-ink transition-colors"
          aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 top-14 z-40 bg-black/20 backdrop-blur-sm"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="bg-paper-100 border-b border-paper-300 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className={mobileNavLinkClass(item.href)}>
                  <Icon className="w-5 h-5" />
                  {item.label}
                </Link>
              );
            })}

            <button
              type="button"
              onClick={handleQuickMatch}
              className="flex items-center gap-3 px-4 py-3 text-base w-full transition-colors text-ink-muted hover:text-ink hover:bg-paper-200/40"
            >
              <Zap className="w-5 h-5" />
              排位赛
            </button>

            {checked && user?.role === "admin" && (
              <Link
                href="/admin"
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 text-base transition-colors ${
                  pathname.startsWith("/admin")
                    ? "text-vermilion font-semibold bg-paper-200/60"
                    : "text-ink-muted hover:text-vermilion hover:bg-paper-200/40"
                }`}
              >
                <Shield className="w-5 h-5" />
                管理
              </Link>
            )}

            <div className="border-t border-paper-300 px-4 py-3">
              {checked && (
                user ? (
                  <span className="flex items-center gap-3 text-base text-ink-muted">
                    <User className="w-5 h-5" />
                    {user.username}
                  </span>
                ) : (
                  <Link href="/login" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 text-base text-ink-muted hover:text-ink transition-colors">
                    <LogIn className="w-5 h-5" />
                    登录
                  </Link>
                )
              )}
            </div>
          </div>
        </div>
      )}

      <QuickMatchDialog open={quickMatchOpen} onOpenChange={setQuickMatchOpen} />
    </nav>
  );
}
