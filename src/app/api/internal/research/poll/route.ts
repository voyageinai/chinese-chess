export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import { getLeaseManager } from "@/server/distributed/lease-manager";
import { pollResearchTask } from "@/server/distributed/research-queue";
import type { PollRequest } from "@/server/distributed/types";

export async function POST(request: Request) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  let body: PollRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.workerId) {
    return NextResponse.json({ error: "workerId required" }, { status: 400 });
  }

  getLeaseManager().trackWorker(body.workerId);

  const task = pollResearchTask(body.workerId);
  if (!task) {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json({ task });
}
