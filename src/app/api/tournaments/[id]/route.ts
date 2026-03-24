import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getTournamentById,
  getTournamentEntries,
  getGamesByTournament,
  addEngineToTournament,
  getEngineById,
} from "@/db/queries";
import { TournamentRunner, registerRunner } from "@/server/tournament";
import { wsHub } from "@/server/ws";
import { denyUnauth, denyForbidden, canManageTournament, isAdmin } from "@/server/permissions";
import { logAudit } from "@/server/audit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const tournament = getTournamentById(id);

    if (!tournament) {
      return NextResponse.json(
        { error: "Tournament not found" },
        { status: 404 },
      );
    }

    const entries = getTournamentEntries(id);
    const games = getGamesByTournament(id);

    return NextResponse.json({ tournament, entries, games });
  } catch (error) {
    console.error("Get tournament error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();

    const { id } = await params;
    const tournament = getTournamentById(id);

    if (!tournament) {
      return NextResponse.json(
        { error: "Tournament not found" },
        { status: 404 },
      );
    }

    if (!canManageTournament(user, tournament)) return denyForbidden();

    if (tournament.status !== "pending") {
      return NextResponse.json(
        { error: "Can only add engines to pending tournaments" },
        { status: 400 },
      );
    }

    const { engineId } = await request.json();

    if (!engineId) {
      return NextResponse.json(
        { error: "Missing required field: engineId" },
        { status: 400 },
      );
    }

    const engine = getEngineById(engineId);
    if (!engine) {
      return NextResponse.json(
        { error: "Engine not found" },
        { status: 404 },
      );
    }

    if (engine.visibility !== "public" && engine.user_id !== user.id && !isAdmin(user)) {
      return NextResponse.json(
        { error: "Engine is not available for this tournament" },
        { status: 403 },
      );
    }

    // Check if engine already registered
    const entries = getTournamentEntries(id);
    if (entries.some((e) => e.engine_id === engineId)) {
      return NextResponse.json(
        { error: "Engine already registered in this tournament" },
        { status: 409 },
      );
    }

    addEngineToTournament(id, engineId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Add engine to tournament error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();

    const { id } = await params;
    const tournament = getTournamentById(id);

    if (!tournament) {
      return NextResponse.json(
        { error: "Tournament not found" },
        { status: 404 },
      );
    }

    if (!canManageTournament(user, tournament)) return denyForbidden();

    if (tournament.status !== "pending") {
      return NextResponse.json(
        { error: "Tournament is not in pending status" },
        { status: 400 },
      );
    }

    const entries = getTournamentEntries(id);
    if (entries.length < 2) {
      return NextResponse.json(
        { error: "Tournament needs at least 2 engines" },
        { status: 400 },
      );
    }

    // Start tournament in background (registry prevents double-start)
    const runner = new TournamentRunner(id);
    if (!registerRunner(id, runner)) {
      return NextResponse.json(
        { error: "Tournament is already running" },
        { status: 409 },
      );
    }
    runner.on("move", (msg) => wsHub.broadcast(msg));
    runner.on("game_start", (msg) => wsHub.broadcast(msg));
    runner.on("game_end", (msg) => wsHub.broadcast(msg));
    runner.on("tournament_end", (msg) => wsHub.broadcast(msg));
    runner.on("engine_thinking", (msg) => wsHub.broadcast(msg, true));
    runner.run().catch((err) => console.error("Tournament error:", err));

    logAudit("tournament.start", user.id, "tournament", id, {
      engine_count: entries.length,
    });

    return NextResponse.json({ success: true, message: "Tournament started" });
  } catch (error) {
    console.error("Start tournament error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
