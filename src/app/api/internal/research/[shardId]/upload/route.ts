export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import { storeResearchArtifact } from "@/server/distributed/research-queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shardId: string }> },
) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  const { shardId } = await params;
  const leaseId = request.headers.get("x-lease-id");
  const filename = request.headers.get("x-artifact-filename") || "artifact.npz";
  if (!leaseId) {
    return NextResponse.json({ error: "x-lease-id required" }, { status: 400 });
  }

  const data = Buffer.from(await request.arrayBuffer());
  const result = storeResearchArtifact(shardId, leaseId, filename, data);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 409 });
  }

  return NextResponse.json({ ok: true, path: result.path });
}
