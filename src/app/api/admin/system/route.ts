import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSystemStats } from "@/db/queries";
import { getActiveRunners } from "@/server/tournament";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();
    if (!isAdmin(user)) return denyForbidden();

    const stats = getSystemStats();
    const runningTournaments = Array.from(getActiveRunners().keys());

    return NextResponse.json({
      ...stats,
      runningTournaments,
    });
  } catch (error) {
    console.error("Admin get system stats error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
