import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  createTournament,
  addEngineToTournament,
  getEngineById,
} from "@/db/queries";
import { TournamentRunner, registerRunner } from "@/server/tournament";
import { wsHub } from "@/server/ws";
import { isAdmin } from "@/server/permissions";
import { logAudit } from "@/server/audit";

const MAX_QUICK_MATCH_ENGINES = 4;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { engineIds, timeBase, timeInc } = await request.json();

    if (!Array.isArray(engineIds) || engineIds.length < 2) {
      return NextResponse.json(
        { error: "至少选择 2 个引擎" },
        { status: 400 },
      );
    }

    if (engineIds.length > MAX_QUICK_MATCH_ENGINES) {
      return NextResponse.json(
        {
          error: `快速对弈最多 ${MAX_QUICK_MATCH_ENGINES} 个引擎，更多引擎请创建正式锦标赛`,
        },
        { status: 400 },
      );
    }

    const resolvedTimeBase = typeof timeBase === "number" && timeBase > 0 ? timeBase : 60;
    const resolvedTimeInc = typeof timeInc === "number" && timeInc >= 0 ? timeInc : 1;

    // Validate all engines exist and are accessible
    const engineNames: string[] = [];
    for (const eid of engineIds) {
      const engine = getEngineById(eid);
      if (!engine) {
        return NextResponse.json(
          { error: `引擎不存在` },
          { status: 404 },
        );
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
        !isAdmin(user)
      ) {
        return NextResponse.json(
          { error: `引擎 ${engine.name} 不可用` },
          { status: 403 },
        );
      }
      engineNames.push(engine.name);
    }

    // Generate name
    const name =
      engineIds.length === 2
        ? `${engineNames[0]} vs ${engineNames[1]}`
        : `快速对弈 (${engineNames.join(", ")})`;

    // Create tournament (type=quick_match, rounds=1 → 2 games per pair with color swap)
    const tournament = createTournament(
      user.id,
      name,
      resolvedTimeBase,
      resolvedTimeInc,
      1,
      "quick_match",
    );

    // Add engines
    for (const eid of engineIds) {
      addEngineToTournament(tournament.id, eid);
    }

    // Start immediately
    const runner = new TournamentRunner(tournament.id);
    if (!registerRunner(tournament.id, runner)) {
      return NextResponse.json(
        { error: "启动失败" },
        { status: 409 },
      );
    }
    runner.on("move", (msg) => wsHub.broadcast(msg));
    runner.on("game_start", (msg) => wsHub.broadcast(msg));
    runner.on("game_end", (msg) => wsHub.broadcast(msg));
    runner.on("tournament_end", (msg) => wsHub.broadcast(msg));
    runner.run().catch((err) => console.error("Quick match error:", err));

    logAudit("quick_match.start", user.id, "tournament", tournament.id, {
      engine_count: engineIds.length,
    });

    return NextResponse.json(
      { tournament, message: "快速对弈已开始" },
      { status: 201 },
    );
  } catch (error) {
    console.error("Quick match error:", error);
    return NextResponse.json(
      { error: "服务器错误" },
      { status: 500 },
    );
  }
}
