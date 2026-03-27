import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";

const adminNav = [
  { href: "/admin", label: "概览" },
  { href: "/admin/users", label: "用户" },
  { href: "/admin/engines", label: "引擎" },
  { href: "/admin/tournaments", label: "锦标赛" },
  { href: "/admin/invites", label: "邀请码" },
  { href: "/admin/workers", label: "集群" },
  { href: "/admin/research", label: "研究任务" },
  { href: "/admin/audit-logs", label: "审计日志" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    redirect("/");
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <h1 className="font-brush text-2xl text-ink mb-6">管理面板</h1>
      <div className="flex gap-4 mb-8 border-b border-paper-300 pb-4">
        {adminNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-sm text-ink-muted hover:text-ink transition-colors px-3 py-1.5 rounded-md hover:bg-paper-200"
          >
            {item.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}
