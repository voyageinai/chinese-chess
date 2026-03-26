export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import { getLeaseManager } from "@/server/distributed/lease-manager";
import type { HeartbeatRequest } from "@/server/distributed/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  const { gameId } = await params;

  let body: HeartbeatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leaseMgr = getLeaseManager();
  leaseMgr.trackHeartbeat(body.workerId, gameId, body.ply);

  const newExpiry = leaseMgr.renew(gameId, body.leaseId);

  if (newExpiry === null) {
    return NextResponse.json(
      { ok: false, reason: "lease_expired" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, leaseExpiresAt: newExpiry });
}
