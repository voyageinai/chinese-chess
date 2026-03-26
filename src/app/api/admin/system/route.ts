import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSystemStats } from "@/db/queries";
import { getActiveRunners } from "@/server/tournament";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import { isDistributedEnabled } from "@/server/distributed/auth";
import { getLeaseManager } from "@/server/distributed/lease-manager";
import type { DistributedMonitoringData } from "@/server/distributed/lease-manager";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();
    if (!isAdmin(user)) return denyForbidden();

    const stats = getSystemStats();
    const runningTournaments = Array.from(getActiveRunners().keys());

    let distributed: DistributedMonitoringData;
    if (isDistributedEnabled()) {
      distributed = getLeaseManager().getMonitoringData();
    } else {
      distributed = {
        enabled: false,
        workers: [],
        leases: [],
        stats: { totalWorkers: 0, onlineWorkers: 0, activeLeases: 0 },
      };
    }

    return NextResponse.json({
      ...stats,
      runningTournaments,
      distributed,
    });
  } catch (error) {
    console.error("Admin get system stats error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
