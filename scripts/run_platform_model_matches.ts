#!/usr/bin/env -S npx tsx

import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../src/db/index";
import {
  addEngineToTournament,
  createEngine,
  createTournament,
  getAllEngines,
  getEngineById,
  getGamesByTournament,
  getTournamentById,
  getTournamentEntries,
} from "../src/db/queries";
import { TournamentRunner, registerRunner } from "../src/server/tournament";

const SYSTEM_USER_ID = "__system__";
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const QUICK_TIME_BASE = parsePositiveInt(process.env.QUICK_TIME_BASE, 3);
const ARENA_TIME_BASE = parsePositiveInt(process.env.ARENA_TIME_BASE, 2);
const TIME_INC = parsePositiveInt(process.env.TIME_INC, 0);

type EngineSpec = {
  slug: string;
  name: string;
  binaryPath: string;
};

type TournamentSummary = {
  id: string;
  name: string;
  status: string;
  time_control: string;
  standings: Array<{
    rank: number | null;
    engine: string;
    score: number;
    wins: number;
    losses: number;
    draws: number;
  }>;
  games: Array<{
    id: string;
    red: string;
    black: string;
    result: string | null;
    reason: string | null;
  }>;
};

const ENGINE_SPECS: EngineSpec[] = [
  {
    slug: "v16_pikafish_small",
    name: "XiangqiModelV16PikafishSmall",
    binaryPath: path.resolve("engines/xiangqi_model_v16_pikafish_small.py"),
  },
  {
    slug: "v16_fairy_classic_small",
    name: "XiangqiModelV16FairyClassicSmall",
    binaryPath: path.resolve("engines/xiangqi_model_v16_fairy_classic_small.py"),
  },
  {
    slug: "v6",
    name: "XiangqiModelV6",
    binaryPath: path.resolve("engines/xiangqi_model_v6.py"),
  },
  {
    slug: "v13",
    name: "XiangqiModelV13",
    binaryPath: path.resolve("engines/xiangqi_model_v13.py"),
  },
  {
    slug: "v14",
    name: "XiangqiModelV14",
    binaryPath: path.resolve("engines/xiangqi_model_v14.py"),
  },
];

function timestampTag(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function ensureEngine(spec: EngineSpec): string {
  const db = getDb();
  const existing = getAllEngines().find(
    (engine) => path.resolve(engine.binary_path) === spec.binaryPath,
  );
  if (existing) {
    db.prepare(
      "UPDATE engines SET name = ?, user_id = ?, visibility = 'public', status = 'active' WHERE id = ?",
    ).run(spec.name, SYSTEM_USER_ID, existing.id);
    return existing.id;
  }

  const created = createEngine(SYSTEM_USER_ID, spec.name, spec.binaryPath, "public");
  db.prepare("UPDATE engines SET status = 'active' WHERE id = ?").run(created.id);
  return created.id;
}

function computeTournamentWdl(tournamentId: string): Map<string, { wins: number; losses: number; draws: number }> {
  const tally = new Map<string, { wins: number; losses: number; draws: number }>();
  for (const game of getGamesByTournament(tournamentId)) {
    for (const engineId of [game.red_engine_id, game.black_engine_id]) {
      if (!tally.has(engineId)) {
        tally.set(engineId, { wins: 0, losses: 0, draws: 0 });
      }
    }
    if (game.result === "red") {
      tally.get(game.red_engine_id)!.wins += 1;
      tally.get(game.black_engine_id)!.losses += 1;
    } else if (game.result === "black") {
      tally.get(game.black_engine_id)!.wins += 1;
      tally.get(game.red_engine_id)!.losses += 1;
    } else if (game.result === "draw") {
      tally.get(game.red_engine_id)!.draws += 1;
      tally.get(game.black_engine_id)!.draws += 1;
    }
  }
  return tally;
}

function summarizeTournament(tournamentId: string): TournamentSummary {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) {
    throw new Error(`Tournament ${tournamentId} not found`);
  }

  const wdl = computeTournamentWdl(tournamentId);
  const standings = getTournamentEntries(tournamentId)
    .map((entry) => {
      const engine = getEngineById(entry.engine_id);
      const result = wdl.get(entry.engine_id) ?? { wins: 0, losses: 0, draws: 0 };
      return {
        rank: entry.final_rank,
        engine: engine?.name ?? entry.engine_id,
        score: entry.score,
        wins: result.wins,
        losses: result.losses,
        draws: result.draws,
      };
    })
    .sort((a, b) => {
      const rankA = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.rank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return b.score - a.score;
    });

  const games = getGamesByTournament(tournamentId).map((game) => ({
    id: game.id,
    red: getEngineById(game.red_engine_id)?.name ?? game.red_engine_id,
    black: getEngineById(game.black_engine_id)?.name ?? game.black_engine_id,
    result: game.result,
    reason: game.result_reason,
  }));

  return {
    id: tournament.id,
    name: tournament.name,
    status: tournament.status,
    time_control: `${tournament.time_control_base}+${tournament.time_control_inc}`,
    standings,
    games,
  };
}

async function runTournament(
  name: string,
  type: "tournament" | "quick_match",
  engineIds: string[],
  timeBase: number,
): Promise<string> {
  const tournament = createTournament(
    SYSTEM_USER_ID,
    name,
    timeBase,
    TIME_INC,
    1,
    type,
    "round_robin",
  );
  for (const engineId of engineIds) {
    addEngineToTournament(tournament.id, engineId);
  }

  const runner = new TournamentRunner(tournament.id);
  if (!registerRunner(tournament.id, runner)) {
    throw new Error(`Runner already registered for ${tournament.id}`);
  }

  runner.on("game_end", (msg: { gameId: string; result: string; reason: string }) => {
    console.log(`[game_end] ${msg.gameId} ${msg.result} ${msg.reason}`);
  });
  runner.on("tournament_end", (msg: { tournamentId: string }) => {
    console.log(`[tournament_end] ${msg.tournamentId}`);
  });

  await runner.run();
  return tournament.id;
}

async function main(): Promise<void> {
  getDb();

  for (const spec of ENGINE_SPECS) {
    if (!fs.existsSync(spec.binaryPath)) {
      throw new Error(`Missing engine binary: ${spec.binaryPath}`);
    }
  }

  const engineIds = new Map<string, string>();
  const eloBefore = new Map<string, number>();
  for (const spec of ENGINE_SPECS) {
    const id = ensureEngine(spec);
    engineIds.set(spec.slug, id);
    eloBefore.set(spec.slug, getEngineById(id)!.elo);
  }

  const tag = timestampTag();
  const quickTournamentId = await runTournament(
    `V16 Small Quick Match ${tag}`,
    "quick_match",
    [
      engineIds.get("v16_pikafish_small")!,
      engineIds.get("v16_fairy_classic_small")!,
    ],
    QUICK_TIME_BASE,
  );

  const arenaTournamentId = await runTournament(
    `V16 vs V6 V13 V14 ${tag}`,
    "tournament",
    ENGINE_SPECS.map((spec) => engineIds.get(spec.slug)!),
    ARENA_TIME_BASE,
  );

  const summary = {
    generated_at: new Date().toISOString(),
    quick_match: summarizeTournament(quickTournamentId),
    round_robin: summarizeTournament(arenaTournamentId),
    engine_elo_delta: ENGINE_SPECS.map((spec) => {
      const engine = getEngineById(engineIds.get(spec.slug)!)!;
      return {
        engine: spec.name,
        elo_before: eloBefore.get(spec.slug),
        elo_after: engine.elo,
        delta: Math.round(engine.elo - (eloBefore.get(spec.slug) ?? engine.elo)),
      };
    }),
  };

  const summaryPath = path.resolve("models", `platform_match_summary_${tag}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(JSON.stringify({ ...summary, summary_path: summaryPath }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
