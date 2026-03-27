import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getTournaments,
  createTournament,
  addEngineToTournament,
  getEngineById,
  getTournamentById,
} from "@/db/queries";
import { TournamentRunner, registerRunner } from "@/server/tournament";
import { wsHub } from "@/server/ws";
import { logAudit } from "@/server/audit";

export async function GET() {
  try {
    const tournaments = getTournaments();
    return NextResponse.json({ tournaments });
  } catch (error) {
    console.error("Get tournaments error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      );
    }

    const { name, timeBase, timeInc, rounds, format, engineIds, autoStart } =
      await request.json();

    if (!name || (typeof name !== "string") || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Tournament name must be a non-empty string" },
        { status: 400 },
      );
    }

    if (timeBase != null && (typeof timeBase !== "number" || !Number.isFinite(timeBase) || timeBase <= 0)) {
      return NextResponse.json(
        { error: "timeBase must be a positive number" },
        { status: 400 },
      );
    }

    if (timeInc != null && (typeof timeInc !== "number" || !Number.isFinite(timeInc) || timeInc < 0)) {
      return NextResponse.json(
        { error: "timeInc must be a non-negative number" },
        { status: 400 },
      );
    }

    if (
      rounds != null &&
      (typeof rounds !== "number" || !Number.isFinite(rounds) || rounds <= 0)
    ) {
      return NextResponse.json(
        { error: "rounds must be a positive number" },
        { status: 400 },
      );
    }

    // Validate all engines BEFORE creating tournament (avoid half-baked state)
    if (Array.isArray(engineIds) && engineIds.length > 0) {
      for (const eid of engineIds) {
        const engine = getEngineById(eid);
        if (!engine) {
          return NextResponse.json({ error: `引擎不存在` }, { status: 404 });
        }
        if (engine.status === "disabled") {
          return NextResponse.json(
            { error: `引擎 ${engine.name} 已被禁用` },
            { status: 403 },
          );
        }
        if (
          engine.visibility !== "public" &&
          engine.user_id !== user.id &&
          user.role !== "admin"
        ) {
          return NextResponse.json(
            { error: `引擎 ${engine.name} 不可用` },
            { status: 403 },
          );
        }
      }
    }

    const validFormats = ["round_robin", "knockout", "gauntlet", "swiss"];
    const tournamentFormat = validFormats.includes(format) ? format : "round_robin";

    const tournament = createTournament(
      user.id,
      name.trim(),
      timeBase,
      timeInc,
      rounds ?? 1,
      "tournament",
      tournamentFormat,
    );

    // Add engines if provided
    if (Array.isArray(engineIds) && engineIds.length > 0) {
      for (const eid of engineIds) {
        addEngineToTournament(tournament.id, eid);
      }
    }

    // Auto-start if requested and enough engines
    if (autoStart && Array.isArray(engineIds) && engineIds.length >= 2) {
      const runner = new TournamentRunner(tournament.id);
      if (registerRunner(tournament.id, runner)) {
        runner.on("move", (msg) => wsHub.broadcast(msg));
        runner.on("game_start", (msg) => wsHub.broadcast(msg));
        runner.on("game_end", (msg) => wsHub.broadcast(msg));
        runner.on("tournament_end", (msg) => wsHub.broadcast(msg));
        runner.on("engine_thinking", (msg) => wsHub.broadcast(msg, true));
        runner.run().catch((err) =>
          console.error("Tournament auto-start error:", err),
        );
        logAudit("tournament.start", user.id, "tournament", tournament.id, {
          engine_count: engineIds.length,
          auto_start: true,
        });
      }
    }

    return NextResponse.json(
      { tournament: getTournamentById(tournament.id) },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create tournament error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
