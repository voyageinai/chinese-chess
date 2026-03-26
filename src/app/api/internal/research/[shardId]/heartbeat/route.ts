export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import { getLeaseManager } from "@/server/distributed/lease-manager";
import { heartbeatResearchTask } from "@/server/distributed/research-queue";
import type { ResearchHeartbeatRequest } from "@/server/distributed/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shardId: string }> },
) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  const { shardId } = await params;

  let body: ResearchHeartbeatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  getLeaseManager().trackWorker(body.workerId);
  const result = heartbeatResearchTask(shardId, body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: "lease_expired" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, leaseExpiresAt: result.leaseExpiresAt });
}
