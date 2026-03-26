#!/usr/bin/env npx tsx
/**
 * CLI tool for sandbox engine testing against the distributed cluster.
 *
 * Usage:
 *   npx tsx scripts/cli-test.ts \
 *     --engine ./my-engine.py \
 *     --against "Pikafish,CaiMZ-3.6" \
 *     --games 6 \
 *     --tc 30+1 \
 *     --master https://chess.chatpig.space \
 *     --secret zhumadian666
 *
 * Environment variables (alternative to flags):
 *   MASTER_URL, WORKER_SECRET
 */

import { readFileSync, statSync } from "fs";
import path from "path";
import WebSocket from "ws";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      opts[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return {
    enginePath: opts.engine || "",
    against: opts.against || "",
    games: parseInt(opts.games || "2", 10),
    tc: opts.tc || "60+1",
    masterUrl: (opts.master || process.env.MASTER_URL || "").replace(/\/$/, ""),
    secret: opts.secret || process.env.WORKER_SECRET || "",
    name: opts.name || "",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(msg: string): never {
  console.error(`\x1b[31m错误: ${msg}\x1b[0m`);
  process.exit(1);
}

function parseTc(tc: string): { base: number; inc: number } {
  const m = tc.match(/^(\d+)\+(\d+)$/);
  if (!m) fail(`时间控制格式错误: "${tc}", 应为 "秒+增量" 如 "60+1"`);
  return { base: parseInt(m[1], 10), inc: parseInt(m[2], 10) };
}

async function api(
  masterUrl: string,
  secret: string,
  path: string,
  method: string,
  body?: FormData | string,
): Promise<Response> {
  const headers: Record<string, string> = { "x-worker-secret": secret };
  if (typeof body === "string") headers["content-type"] = "application/json";
  return fetch(`${masterUrl}${path}`, { method, headers, body });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  if (!opts.enginePath) fail("缺少 --engine 参数");
  if (!opts.against) fail("缺少 --against 参数 (对手引擎名，逗号分隔)");
  if (!opts.masterUrl) fail("缺少 --master 参数或 MASTER_URL 环境变量");
  if (!opts.secret) fail("缺少 --secret 参数或 WORKER_SECRET 环境变量");

  const { base, inc } = parseTc(opts.tc);

  // Resolve engine file
  const engineAbsPath = path.resolve(opts.enginePath);
  try {
    statSync(engineAbsPath);
  } catch {
    fail(`引擎文件不存在: ${engineAbsPath}`);
  }
  const engineFilename = path.basename(engineAbsPath);
  const engineName = opts.name || engineFilename.replace(/\.[^.]+$/, "");

  console.log(`引擎: ${engineName} (${engineAbsPath})`);
  console.log(`时间: ${base}+${inc}s | 每对手 ${opts.games} 局`);

  // Step 1: Resolve opponent IDs by name
  console.log("\n查找对手引擎...");
  const enginesRes = await api(opts.masterUrl, opts.secret, "/api/internal/sandbox/engines", "GET");

  // The engines endpoint doesn't exist yet for internal — use the public endpoint
  // Actually let's query the public engines list
  const enginesListRes = await fetch(`${opts.masterUrl}/api/engines`);
  if (!enginesListRes.ok) fail("无法获取引擎列表");
  const enginesList = await enginesListRes.json();
  const allEngines: { id: string; name: string; elo: number }[] =
    (enginesList.engines || enginesList || []);

  const againstNames = opts.against.split(",").map((s) => s.trim()).filter(Boolean);
  const opponentIds: string[] = [];

  for (const name of againstNames) {
    const match = allEngines.find(
      (e) => e.name === name || e.name.toLowerCase() === name.toLowerCase(),
    );
    if (!match) {
      console.log(`  可用引擎: ${allEngines.map((e) => e.name).join(", ")}`);
      fail(`找不到对手引擎: "${name}"`);
    }
    opponentIds.push(match.id);
    console.log(`  ${match.name} (Elo ${match.elo})`);
  }

  // Step 2: Upload engine and create sandbox test
  console.log("\n上传引擎到集群...");
  const fileBuffer = readFileSync(engineAbsPath);
  const formData = new FormData();
  formData.append("engine", new Blob([fileBuffer]), engineFilename);
  formData.append("engineName", engineName);
  formData.append("opponentIds", opponentIds.join(","));
  formData.append("games", String(opts.games));
  formData.append("timeBase", String(base));
  formData.append("timeInc", String(inc));

  const createRes = await fetch(`${opts.masterUrl}/api/internal/sandbox/test`, {
    method: "POST",
    headers: { "x-worker-secret": opts.secret },
    body: formData,
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    fail(`创建测试失败: ${err}`);
  }

  const testInfo = await createRes.json();
  console.log(`测试已创建: ${testInfo.gameCount} 局, ${testInfo.timeControl}`);
  console.log(`锦标赛ID: ${testInfo.tournamentId}`);

  // Step 3: Connect WebSocket and stream results
  const wsUrl = opts.masterUrl.replace(/^http/, "ws") + "/ws";
  const ws = new WebSocket(wsUrl);

  const engineId = testInfo.engineId;
  const gameResults: { gameId: string; result: string; code: string; detail: string }[] = [];
  let gameCount = 0;

  // Build engine name lookup
  const nameMap = new Map<string, string>();
  nameMap.set(engineId, engineName);
  for (let i = 0; i < opponentIds.length; i++) {
    nameMap.set(opponentIds[i], againstNames[i]);
  }

  ws.on("open", () => {
    // Subscribe to all games for this tournament
    // We'll filter by tournament events
  });

  const startTime = Date.now();

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "game_start" && msg.gameId) {
        // We'll track by game_end
      }

      if (msg.type === "game_end" && msg.gameId) {
        gameResults.push({
          gameId: msg.gameId,
          result: msg.result,
          code: msg.code,
          detail: msg.detail,
        });
        gameCount++;

        // Determine display
        const total = testInfo.gameCount;
        const code = msg.code || "";
        const resultText =
          msg.result === "red" ? "红胜" : msg.result === "black" ? "黑胜" : "和棋";

        console.log(
          `[${gameCount}/${total}] ${resultText} (${code})`,
        );

        if (gameCount >= total) {
          // All done — wait a moment for cleanup then show report
          setTimeout(() => showReport(), 1000);
        }
      }

      if (msg.type === "tournament_end") {
        if (gameCount < testInfo.gameCount) {
          // Tournament ended early — show what we have
          setTimeout(() => showReport(), 500);
        }
      }
    } catch {
      // ignore
    }
  });

  function showReport() {
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Fetch final results from API
    fetch(`${opts.masterUrl}/api/internal/sandbox/${testInfo.tournamentId}`, {
      headers: { "x-worker-secret": opts.secret },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        console.log("\n" + "═".repeat(50));

        if (data) {
          // Calculate W/L/D from perspective of our engine
          let wins = 0, losses = 0, draws = 0;
          const oppStats = new Map<string, { w: number; l: number; d: number }>();

          for (const g of data.games) {
            const isRed = g.redEngineId === engineId;
            const oppId = isRed ? g.blackEngineId : g.redEngineId;

            if (!oppStats.has(oppId)) oppStats.set(oppId, { w: 0, l: 0, d: 0 });
            const s = oppStats.get(oppId)!;

            if (g.result === "draw") {
              draws++;
              s.d++;
            } else if (
              (g.result === "red" && isRed) ||
              (g.result === "black" && !isRed)
            ) {
              wins++;
              s.w++;
            } else if (g.result) {
              losses++;
              s.l++;
            }
          }

          const total = wins + losses + draws;
          const pct = total > 0 ? ((wins + draws * 0.5) / total * 100).toFixed(1) : "0.0";

          console.log(`  结果: +${wins} =${draws} -${losses} (${pct}%)`);
          console.log();

          for (const [oppId, s] of oppStats) {
            const oppName = nameMap.get(oppId) || oppId.slice(0, 10);
            const oppTotal = s.w + s.l + s.d;
            const oppScore = s.w + s.d * 0.5;
            console.log(`  vs ${oppName.padEnd(20)} ${oppScore}/${oppTotal}  (+${s.w} =${s.d} -${s.l})`);
          }

          // Elo estimation (simple)
          if (total >= 4) {
            const score = (wins + draws * 0.5) / total;
            const eloDiff = score === 1 ? 400 : score === 0 ? -400 :
              Math.round(-400 * Math.log10(1 / score - 1));
            const margin = Math.round(400 / Math.sqrt(total));
            console.log(`\n  Elo估算: ${eloDiff >= 0 ? "+" : ""}${eloDiff} ±${margin} (相对对手平均水平)`);
          }
        }

        console.log(`\n  耗时: ${elapsed}s`);
        console.log("  线上无痕 (sandbox 自动清理)");
        console.log("═".repeat(50));

        ws.close();
        process.exit(0);
      })
      .catch(() => {
        console.log(`\n完成 (${elapsed}s). 线上无痕.`);
        ws.close();
        process.exit(0);
      });
  }

  // Timeout safety
  const maxWait = (base * 2 + 60) * testInfo.gameCount * 1000;
  setTimeout(() => {
    if (gameCount < testInfo.gameCount) {
      console.log("\n超时，输出已有结果...");
      showReport();
    }
  }, maxWait);

  ws.on("error", (err) => {
    console.error("WebSocket 错误:", err.message);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
