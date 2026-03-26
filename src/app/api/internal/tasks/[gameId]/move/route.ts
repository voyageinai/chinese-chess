export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import { getLeaseManager } from "@/server/distributed/lease-manager";
import { updateGameMoves, getGameById } from "@/db/queries";
import { getRunner } from "@/server/tournament";
import type { MoveReport } from "@/server/distributed/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  const { gameId } = await params;

  let body: MoveReport;
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

  // Persist move data to DB (incremental, same as local Match does)
  const game = getGameById(gameId);
  if (!game) {
    return NextResponse.json({ ok: false, reason: "game_not_found" }, { status: 404 });
  }

  // Build cumulative moves array: parse existing + append new
  const existingMoves = JSON.parse(game.moves || "[]");
  existingMoves.push(body.move);
  updateGameMoves(gameId, JSON.stringify(existingMoves), body.redTime, body.blackTime);

  // Broadcast via WebSocket through the tournament runner
  const runner = getRunner(game.tournament_id);
  if (runner) {
    runner.emitRemoteEvent("move", {
      type: "move",
      gameId,
      move: body.move.move,
      fen: body.move.fen,
      eval: body.move.eval,
      depth: body.move.depth,
      redTime: body.redTime,
      blackTime: body.blackTime,
      timeMs: body.move.time_ms,
      ply: body.ply,
      movedAt: body.movedAt,
    });
  }

  return NextResponse.json({ ok: true });
}
