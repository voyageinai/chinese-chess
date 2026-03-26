export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import { getLeaseManager } from "@/server/distributed/lease-manager";
import { getGameById } from "@/db/queries";
import { getRunner } from "@/server/tournament";
import type { ThinkingReport } from "@/server/distributed/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  const { gameId } = await params;

  let body: ThinkingReport;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leaseMgr = getLeaseManager();
  if (!leaseMgr.validate(gameId, body.leaseId)) {
    return NextResponse.json(
      { ok: false, reason: "lease_expired" },
      { status: 409 },
    );
  }

  // Broadcast via WebSocket
  const game = getGameById(gameId);
  if (game) {
    const runner = getRunner(game.tournament_id);
    if (runner) {
      runner.emitRemoteEvent("engine_thinking", {
        type: "engine_thinking",
        gameId,
        side: body.side,
        depth: body.depth,
        eval: body.eval,
        nodes: body.nodes,
        pv: body.pv,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
