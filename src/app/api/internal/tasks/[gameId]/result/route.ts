export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import { handleResult } from "@/server/distributed/task-queue";
import { getLeaseManager } from "@/server/distributed/lease-manager";
import type { ResultReport } from "@/server/distributed/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  const { gameId } = await params;

  let body: ResultReport;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { ok, reason } = handleResult(gameId, body);

  if (!ok) {
    return NextResponse.json({ ok: false, reason }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
