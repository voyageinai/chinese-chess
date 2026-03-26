export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import * as queries from "@/db/queries";
import { cleanupSandboxTournamentResources } from "@/server/sandbox";

/** GET: query sandbox tournament status and results */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  const { id } = await params;
  const tournament = queries.getTournamentById(id);
  if (!tournament || !tournament.sandbox) {
    return NextResponse.json({ error: "Sandbox tournament not found" }, { status: 404 });
  }

  const games = queries.getGamesByTournament(id);
  const entries = queries.getTournamentEntries(id);

  const completed = games.filter((g) => g.result);
  const total = games.length;

  return NextResponse.json({
    status: tournament.status,
    progress: { completed: completed.length, total },
    games: games.map((g) => ({
      id: g.id,
      redEngineId: g.red_engine_id,
      blackEngineId: g.black_engine_id,
      result: g.result,
      resultCode: g.result_code,
      resultReason: g.result_reason,
      moves: g.result ? (JSON.parse(g.moves || "[]")).length : 0,
      redTimeLeft: g.red_time_left,
      blackTimeLeft: g.black_time_left,
    })),
    entries: entries.map((e) => ({
      engineId: e.engine_id,
      score: e.score,
      rank: e.final_rank,
    })),
  });
}

/** DELETE: force cleanup a sandbox tournament */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  const { id } = await params;
  const tournament = queries.getTournamentById(id);
  if (!tournament || !tournament.sandbox) {
    return NextResponse.json({ error: "Sandbox tournament not found" }, { status: 404 });
  }

  cleanupSandboxTournamentResources(id);
  return NextResponse.json({ ok: true });
}
