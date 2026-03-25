import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  createTournament,
  addEngineToTournament,
  getEngineById,
  getVisibleEngines,
  createGame,
} from "@/db/queries";
import { TournamentRunner, registerRunner, loadOpeningFens } from "@/server/tournament";
import { wsHub } from "@/server/ws";
import { isAdmin } from "@/server/permissions";
import { logAudit } from "@/server/audit";
import { selectOpponents, randomColor } from "@/server/matchmaking";

function wireRunner(runner: TournamentRunner): void {
  runner.on("move", (msg) => wsHub.broadcast(msg));
  runner.on("game_start", (msg) => wsHub.broadcast(msg));
  runner.on("game_end", (msg) => wsHub.broadcast(msg));
  runner.on("tournament_end", (msg) => wsHub.broadcast(msg));
  runner.on("engine_thinking", (msg) => wsHub.broadcast(msg, true));
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const body = await request.json();

    // ── New format: matchmaking mode ──
    if (typeof body.engineId === "string") {
      return handleMatchmaking(body, user);
    }

    // ── Legacy format: multi-engine quick match ──
    if (Array.isArray(body.engineIds)) {
      return handleLegacyQuickMatch(body, user);
    }

    return NextResponse.json({ error: "请提供 engineId 或 engineIds" }, { status: 400 });
  } catch (error) {
    console.error("Quick match error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

async function handleMatchmaking(
  body: {
    engineId: string;
    gameCount?: number;
    timeBase?: number;
    timeInc?: number;
    label?: string;
    opponentIds?: string[];
  },
  user: { id: string; role: string },
) {
  const { engineId, gameCount = 1, label } = body;
  const resolvedTimeBase = typeof body.timeBase === "number" && body.timeBase > 0 ? body.timeBase : 60;
  const resolvedTimeInc = typeof body.timeInc === "number" && body.timeInc >= 0 ? body.timeInc : 1;
  const isGauntlet = label === "定级赛" && Array.isArray(body.opponentIds) && body.opponentIds.length > 0;

  // Validate engine belongs to user
  const engine = getEngineById(engineId);
  if (!engine) {
    return NextResponse.json({ error: "引擎不存在" }, { status: 404 });
  }
  if (engine.user_id !== user.id) {
    return NextResponse.json({ error: "只能使用自己的引擎" }, { status: 403 });
  }
  if (engine.status === "disabled") {
    return NextResponse.json({ error: "引擎已被禁用" }, { status: 403 });
  }

  let opponents: string[];

  if (isGauntlet) {
    // ── Gauntlet mode: user-selected opponents ──
    const opponentIds = body.opponentIds!;
    if (opponentIds.length > 10) {
      return NextResponse.json({ error: "最多选择 10 个对手" }, { status: 400 });
    }
    // Validate each opponent
    for (const oppId of opponentIds) {
      if (oppId === engineId) {
        return NextResponse.json({ error: "不能选择自己的引擎作为对手" }, { status: 400 });
      }
      const opp = getEngineById(oppId);
      if (!opp) {
        return NextResponse.json({ error: `对手引擎不存在: ${oppId}` }, { status: 404 });
      }
      if (opp.status === "disabled") {
        return NextResponse.json({ error: `引擎 ${opp.name} 已被禁用` }, { status: 403 });
      }
      if (opp.visibility !== "public" && opp.user_id !== user.id && user.role !== "admin") {
        return NextResponse.json({ error: `引擎 ${opp.name} 不可用` }, { status: 403 });
      }
    }
    opponents = opponentIds;
  } else {
    // ── Ranked mode: auto-match opponents ──
    const allEngines = getVisibleEngines();
    opponents = selectOpponents(engineId, engine.elo, user.id, gameCount, allEngines);
    if (opponents.length === 0) {
      return NextResponse.json({ error: "暂无可匹配的对手，请等待其他用户上传引擎" }, { status: 400 });
    }
  }

  // Load opening book
  const openingFens = loadOpeningFens();

  // Generate tournament name
  const oppNames = opponents.map((id) => getEngineById(id)!.name);
  const tag = label || "排位赛";
  const name = opponents.length === 1
    ? `${engine.name} vs ${oppNames[0]}`
    : `${engine.name} ${tag} (${opponents.length} 局)`;

  // Create tournament — gauntlet gets correct format
  const tournament = createTournament(
    user.id,
    name,
    resolvedTimeBase,
    resolvedTimeInc,
    1,
    "quick_match",
    isGauntlet ? "gauntlet" : "round_robin",
  );

  // Add all engines
  addEngineToTournament(tournament.id, engineId);
  for (const oppId of opponents) {
    addEngineToTournament(tournament.id, oppId);
  }

  // Pre-create games with random colors
  const gameIds: string[] = [];
  let fenIndex = 0;
  for (const oppId of opponents) {
    const color = randomColor();
    const [red, black] = color === "red" ? [engineId, oppId] : [oppId, engineId];
    const fen = openingFens.length > 0 ? openingFens[fenIndex++ % openingFens.length] : undefined;
    const game = createGame(tournament.id, red, black, fen);
    gameIds.push(game.id);
  }

  // Start runner
  const runner = new TournamentRunner(tournament.id);
  if (!registerRunner(tournament.id, runner)) {
    return NextResponse.json({ error: "启动失败" }, { status: 409 });
  }
  wireRunner(runner);
  runner.run().catch((err) => console.error("Quick match error:", err));

  logAudit("quick_match.start", user.id, "tournament", tournament.id, {
    mode: isGauntlet ? "gauntlet" : "matchmaking",
    game_count: opponents.length,
  });

  return NextResponse.json(
    {
      tournament,
      gameId: gameIds.length === 1 ? gameIds[0] : undefined,
      message: isGauntlet
        ? opponents.length === 1 ? "定级赛已开始" : `定级赛已开始 (${opponents.length} 局)`
        : opponents.length === 1 ? "对弈已开始" : "排位赛已开始",
    },
    { status: 201 },
  );
}

async function handleLegacyQuickMatch(
  body: { engineIds: string[]; timeBase?: number; timeInc?: number },
  user: { id: string; role: string },
) {
  const { engineIds } = body;
  const resolvedTimeBase = typeof body.timeBase === "number" && body.timeBase > 0 ? body.timeBase : 60;
  const resolvedTimeInc = typeof body.timeInc === "number" && body.timeInc >= 0 ? body.timeInc : 1;

  if (engineIds.length < 2) {
    return NextResponse.json({ error: "至少选择 2 个引擎" }, { status: 400 });
  }
  if (engineIds.length > 4) {
    return NextResponse.json({ error: "快速对弈最多 4 个引擎" }, { status: 400 });
  }

  const engineNames: string[] = [];
  for (const eid of engineIds) {
    const engine = getEngineById(eid);
    if (!engine) return NextResponse.json({ error: "引擎不存在" }, { status: 404 });
    if (engine.status === "disabled") return NextResponse.json({ error: `引擎 ${engine.name} 已被禁用` }, { status: 403 });
    if (engine.visibility !== "public" && engine.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: `引擎 ${engine.name} 不可用` }, { status: 403 });
    }
    engineNames.push(engine.name);
  }

  const name = engineIds.length === 2
    ? `${engineNames[0]} vs ${engineNames[1]}`
    : `快速对弈 (${engineNames.join(", ")})`;

  const tournament = createTournament(user.id, name, resolvedTimeBase, resolvedTimeInc, 1, "quick_match");

  for (const eid of engineIds) {
    addEngineToTournament(tournament.id, eid);
  }

  const runner = new TournamentRunner(tournament.id);
  if (!registerRunner(tournament.id, runner)) {
    return NextResponse.json({ error: "启动失败" }, { status: 409 });
  }
  wireRunner(runner);
  runner.run().catch((err) => console.error("Quick match error:", err));

  logAudit("quick_match.start", user.id, "tournament", tournament.id, {
    mode: "legacy",
    engine_count: engineIds.length,
  });

  return NextResponse.json({ tournament, message: "快速对弈已开始" }, { status: 201 });
}
