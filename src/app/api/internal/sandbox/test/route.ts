export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import path from "path";
import { mkdir, writeFile, chmod } from "fs/promises";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import * as queries from "@/db/queries";
import { TournamentRunner, registerRunner } from "@/server/tournament";
import { wsHub } from "@/server/ws";

export async function POST(request: Request) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  try {
    const formData = await request.formData();
    const engineFile = formData.get("engine") as File | null;
    const engineName = (formData.get("engineName") as string) || "sandbox-engine";
    const opponentIds = (formData.get("opponentIds") as string || "").split(",").filter(Boolean);
    const games = parseInt(formData.get("games") as string || "2", 10);
    const timeBase = parseInt(formData.get("timeBase") as string || "60", 10);
    const timeInc = parseInt(formData.get("timeInc") as string || "1", 10);

    if (!engineFile) {
      return NextResponse.json({ error: "engine file required" }, { status: 400 });
    }
    if (opponentIds.length === 0) {
      return NextResponse.json({ error: "at least one opponentId required" }, { status: 400 });
    }

    // Validate opponents exist
    for (const oid of opponentIds) {
      const opp = queries.getEngineById(oid);
      if (!opp) {
        return NextResponse.json({ error: `Opponent engine ${oid} not found` }, { status: 404 });
      }
    }

    // Save sandbox engine to temporary directory
    const sandboxEngineId = nanoid();
    const engineDir = path.join(process.cwd(), "data", "engines", "__sandbox__", sandboxEngineId);
    await mkdir(engineDir, { recursive: true });

    const filename = engineFile.name || "engine";
    const binaryPath = path.join(engineDir, filename);
    const buffer = Buffer.from(await engineFile.arrayBuffer());
    await writeFile(binaryPath, buffer);
    await chmod(binaryPath, 0o755);

    // Register sandbox engine in DB
    const engine = queries.createEngine("__sandbox__", engineName, binaryPath, "public");

    // Create sandbox tournament
    // Each opponent plays `games` games (games/2 as red, games/2 as black)
    const rounds = 1;
    const tournament = queries.createTournament(
      "__sandbox__",
      `[sandbox] ${engineName} test`,
      timeBase,
      timeInc,
      rounds,
      "tournament",
      "round_robin",
      true, // sandbox = true
    );

    // Add engines to tournament
    queries.addEngineToTournament(tournament.id, engine.id);
    for (const oid of opponentIds) {
      queries.addEngineToTournament(tournament.id, oid);
    }

    // Create game pairings manually (sandbox engine vs each opponent, swapping colors)
    const gamesPerOpponent = Math.max(2, Math.floor(games / opponentIds.length));
    for (const oid of opponentIds) {
      for (let i = 0; i < gamesPerOpponent; i++) {
        if (i % 2 === 0) {
          queries.createGame(tournament.id, engine.id, oid);
        } else {
          queries.createGame(tournament.id, oid, engine.id);
        }
      }
    }

    // Start the tournament runner
    const runner = new TournamentRunner(tournament.id);
    if (!registerRunner(tournament.id, runner)) {
      return NextResponse.json({ error: "Failed to start runner" }, { status: 500 });
    }

    runner.on("move", (msg) => wsHub.broadcast(msg));
    runner.on("game_start", (msg) => wsHub.broadcast(msg));
    runner.on("game_end", (msg) => wsHub.broadcast(msg));
    runner.on("tournament_end", (msg) => wsHub.broadcast(msg));
    runner.on("engine_thinking", (msg) => wsHub.broadcast(msg, true));

    runner.run().catch((err) => console.error("[sandbox] Tournament error:", err));

    // Return tournament info for CLI to track
    const allGames = queries.getGamesByTournament(tournament.id);

    return NextResponse.json({
      tournamentId: tournament.id,
      engineId: engine.id,
      engineName,
      opponentIds,
      gameCount: allGames.length,
      timeControl: `${timeBase}+${timeInc}s`,
    }, { status: 201 });
  } catch (error) {
    console.error("[sandbox] Create test error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
