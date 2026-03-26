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
 * Options:
 *   --engine   引擎可执行文件路径 (必需)
 *   --against  对手引擎名，逗号分隔 (必需)
 *   --games    每个对手的对局数，自动取偶数 (默认 2)
 *   --tc       时间控制 "秒+增量" (默认 60+1)
 *   --master   集群 master URL (或 MASTER_URL 环境变量)
 *   --secret   worker 密钥 (或 WORKER_SECRET 环境变量)
 *   --name     引擎显示名 (默认取文件名)
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
  apiPath: string,
  method: string,
  body?: FormData | string,
): Promise<Response> {
  const headers: Record<string, string> = { "x-worker-secret": secret };
  if (typeof body === "string") headers["content-type"] = "application/json";
  return fetch(`${masterUrl}${apiPath}`, { method, headers, body });
}

// ---------------------------------------------------------------------------
// WebSocket with reconnect
// ---------------------------------------------------------------------------

interface WsOptions {
  url: string;
  onMessage: (msg: Record<string, unknown>) => void;
  onConnected?: () => void;
  maxRetries?: number;
}

function createReconnectingWs(options: WsOptions): { close: () => void; connected: Promise<void> } {
  const { url, onMessage, onConnected, maxRetries = 3 } = options;
  let retries = 0;
  let ws: WebSocket;
  let closed = false;
  let resolveConnected: () => void;
  const connected = new Promise<void>((r) => { resolveConnected = r; });

  function connect() {
    ws = new WebSocket(url);

    ws.on("open", () => {
      retries = 0; // reset on successful connection
      resolveConnected();
      onConnected?.();
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        onMessage(msg);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      if (closed) return;
      if (retries < maxRetries) {
        const delay = Math.pow(2, retries + 1) * 1000; // 2s, 4s, 8s
        retries++;
        console.log(`\x1b[33mWebSocket 断连，${delay / 1000}s 后重连 (${retries}/${maxRetries})...\x1b[0m`);
        setTimeout(connect, delay);
      } else {
        console.error("\x1b[31mWebSocket 重连失败，已达最大重试次数\x1b[0m");
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket 错误:", err.message);
    });
  }

  connect();

  return {
    close() {
      closed = true;
      ws?.close();
    },
    connected,
  };
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

  const gamesPerOpponent = opts.games;

  // Step 1: Resolve opponent IDs by name
  console.log("\n查找对手引擎...");
  const enginesRes = await api(opts.masterUrl, opts.secret, "/api/internal/sandbox/engines", "GET");
  if (!enginesRes.ok) {
    fail(`无法获取内部引擎列表: ${await enginesRes.text()}`);
  }
  const enginesList = await enginesRes.json();
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

  console.log(`\n引擎: ${engineName} (${engineAbsPath})`);
  console.log(`时间: ${base}+${inc}s | 每对手 ${gamesPerOpponent} 局, 共 ${gamesPerOpponent * againstNames.length} 局`);

  // Step 2: Connect WebSocket FIRST, then create test (avoid missing early events)
  const wsUrl = opts.masterUrl.replace(/^http/, "ws") + "/ws";

  // Local result accumulation — no dependency on API fetch
  interface GameResult {
    gameId: string;
    redEngineId: string;
    blackEngineId: string;
    result: string;
    code: string;
    detail: string;
  }
  const gameResults: GameResult[] = [];
  let gameCount = 0;
  let reportShown = false;
  let totalGames = 0;
  let engineId = "";
  let tournamentId = "";

  // Build engine name lookup (will be enriched after test creation)
  const nameMap = new Map<string, string>();
  for (let i = 0; i < opponentIds.length; i++) {
    nameMap.set(opponentIds[i], againstNames[i]);
  }

  const startTime = Date.now();

  const wsHandle = createReconnectingWs({
    url: wsUrl,
    onMessage(msg) {
      // Filter: only process events for our tournament
      if (msg.tournamentId && msg.tournamentId !== tournamentId) return;

      if (msg.type === "game_start" && msg.tournamentId === tournamentId) {
        const red = nameMap.get(msg.redEngineId as string) || "?";
        const black = nameMap.get(msg.blackEngineId as string) || "?";
        console.log(`\x1b[2m  开始: ${red} (红) vs ${black} (黑)\x1b[0m`);
      }

      if (msg.type === "game_end" && msg.tournamentId === tournamentId) {
        gameResults.push({
          gameId: msg.gameId as string,
          redEngineId: msg.redEngineId as string,
          blackEngineId: msg.blackEngineId as string,
          result: msg.result as string,
          code: msg.code as string,
          detail: msg.detail as string,
        });
        gameCount++;

        // Determine display
        const code = (msg.code as string) || "";
        const resultText =
          msg.result === "red" ? "红胜" : msg.result === "black" ? "黑胜" : "和棋";

        // Show which engine won from our perspective
        const isRed = msg.redEngineId === engineId;
        const ourResult =
          msg.result === "draw" ? "=" :
          ((msg.result === "red" && isRed) || (msg.result === "black" && !isRed)) ? "+" : "-";
        const marker = ourResult === "+" ? "\x1b[32m+\x1b[0m" : ourResult === "-" ? "\x1b[31m-\x1b[0m" : "\x1b[33m=\x1b[0m";

        console.log(
          `[${gameCount}/${totalGames}] ${marker} ${resultText} (${code})`,
        );

        if (gameCount >= totalGames) {
          showReport();
        }
      }

      if (msg.type === "tournament_end" && msg.tournamentId === tournamentId) {
        if (!reportShown) {
          showReport();
        }
      }
    },
  });

  // Wait for WebSocket to connect before creating the test
  await wsHandle.connected;

  // Step 3: Upload engine and create sandbox test
  console.log("\n上传引擎到集群...");
  const fileBuffer = readFileSync(engineAbsPath);
  const formData = new FormData();
  formData.append("engine", new Blob([fileBuffer]), engineFilename);
  formData.append("engineName", engineName);
  formData.append("opponentIds", opponentIds.join(","));
  formData.append("games", String(gamesPerOpponent));
  formData.append("timeBase", String(base));
  formData.append("timeInc", String(inc));

  const createRes = await fetch(`${opts.masterUrl}/api/internal/sandbox/test`, {
    method: "POST",
    headers: { "x-worker-secret": opts.secret },
    body: formData,
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    wsHandle.close();
    fail(`创建测试失败: ${err}`);
  }

  const testInfo = await createRes.json();
  totalGames = testInfo.gameCount;
  engineId = testInfo.engineId;
  tournamentId = testInfo.tournamentId;
  nameMap.set(engineId, engineName);

  console.log(`测试已创建: ${totalGames} 局, ${testInfo.timeControl}`);
  console.log(`锦标赛ID: ${tournamentId}`);

  // Timeout safety — account for potential concurrency (default 2)
  const concurrency = parseInt(process.env.MAX_CONCURRENT_MATCHES || "2", 10);
  const maxWait = (base * 2 + 60) * Math.ceil(totalGames / concurrency) * 1000;
  setTimeout(() => {
    if (!reportShown) {
      console.log("\n超时，输出已有结果...");
      showReport();
    }
  }, maxWait);

  function showReport() {
    if (reportShown) return;
    reportShown = true;

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log("\n" + "═".repeat(50));

    // Calculate W/L/D from locally accumulated results
    let wins = 0, losses = 0, draws = 0;
    const oppStats = new Map<string, { w: number; l: number; d: number }>();

    for (const g of gameResults) {
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

    // Elo estimation (simple logistic)
    if (total >= 4) {
      const score = (wins + draws * 0.5) / total;
      const eloDiff = score === 1 ? 400 : score === 0 ? -400 :
        Math.round(-400 * Math.log10(1 / score - 1));
      const margin = Math.round(400 / Math.sqrt(total));
      console.log(`\n  Elo估算: ${eloDiff >= 0 ? "+" : ""}${eloDiff} ±${margin} (相对对手平均水平)`);
    }

    console.log(`\n  耗时: ${elapsed}s`);
    console.log("  线上无痕 (sandbox 自动清理)");
    console.log("═".repeat(50));

    wsHandle.close();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
