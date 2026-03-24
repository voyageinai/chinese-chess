import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAuditLogs } from "@/db/queries";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();
    if (!isAdmin(user)) return denyForbidden();

    const url = new URL(request.url);
    const action = url.searchParams.get("action") || undefined;
    const actorId = url.searchParams.get("actorId") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    const logs = getAuditLogs({ action, actorId, limit, offset });
    return NextResponse.json({ logs });
  } catch (error) {
    console.error("Admin get audit logs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
