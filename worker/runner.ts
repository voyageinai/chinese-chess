import { Match, type MatchResult } from "../src/server/match";
import { buildStaticVerdict } from "../src/server/judge";
import type { ApiClient } from "./api-client";
import type { EngineCache } from "./engine-cache";
import type { WorkerTask, ResultReport, MoveReport } from "../src/server/distributed/types";
import type { WorkerConfig } from "./config";

export async function executeTask(
  task: WorkerTask,
  apiClient: ApiClient,
  engineCache: EngineCache,
  config: WorkerConfig,
): Promise<void> {
  // 1. Ensure engine files are cached locally
  const redPath = await engineCache.ensureEngine(task.redEngine);
  const blackPath = await engineCache.ensureEngine(task.blackEngine);

  // 2. Create Match (skipDbWrites since we report to master)
  const match = new Match({
    redEnginePath: redPath,
    blackEnginePath: blackPath,
    timeBase: task.timeBase,
    timeInc: task.timeInc,
    gameId: task.gameId,
    startFen: task.startFen || undefined,
    skipDbWrites: true,
  });

  // 3. Heartbeat timer
  let currentPly = 0;
  let leaseValid = true;
  const heartbeatInterval = setInterval(async () => {
    const ok = await apiClient.heartbeat(
      task.gameId,
      task.leaseId,
      currentPly,
    );
    if (!ok) {
      console.log(
        `[runner] Lease expired for game ${task.gameId}, aborting`,
      );
      leaseValid = false;
      match.abort();
      clearInterval(heartbeatInterval);
    }
  }, config.heartbeatIntervalMs);

  // 4. Wire up move reporting
  match.on("move", (moveData) => {
    currentPly = moveData.ply;
    const report: MoveReport = {
      leaseId: task.leaseId,
      move: {
        move: moveData.move,
        fen: moveData.fen,
        time_ms: moveData.timeMs,
        eval: moveData.eval ?? null,
        depth: moveData.depth ?? null,
      },
      ply: moveData.ply,
      redTime: moveData.redTime,
      blackTime: moveData.blackTime,
      movedAt: moveData.movedAt,
    };
    // Fire and forget — don't block the match loop
    apiClient.reportMove(task.gameId, report).then((ok) => {
      if (!ok) {
        leaseValid = false;
        match.abort();
        clearInterval(heartbeatInterval);
      }
    });
  });

  // 5. Wire up thinking reporting (throttled: skip if previous not done)
  let thinkingInFlight = false;
  match.on("engine_thinking", (data) => {
    if (thinkingInFlight) return;
    thinkingInFlight = true;
    apiClient
      .reportThinking(task.gameId, {
        leaseId: task.leaseId,
        gameId: task.gameId,
        side: data.side,
        depth: data.depth ?? null,
        eval: data.eval ?? null,
        nodes: data.nodes ?? null,
        pv: data.pv ?? null,
      })
      .finally(() => {
        thinkingInFlight = false;
      });
  });

  // 6. Run the match
  let result: MatchResult;
  try {
    result = await match.run();
  } catch (err) {
    console.error(`[runner] Match ${task.gameId} threw:`, err);
    const verdict = buildStaticVerdict("draw", "internal_error");
    result = {
      result: verdict.result,
      code: verdict.code,
      reason: verdict.reason,
      detail: verdict.detail,
      moves: [],
      redTimeLeft: 0,
      blackTimeLeft: 0,
    };
  } finally {
    clearInterval(heartbeatInterval);
  }

  // 7. Report result (skip if lease was already expired)
  if (!leaseValid) {
    console.log(
      `[runner] Skipping result report for ${task.gameId} (lease expired)`,
    );
    return;
  }

  const report: ResultReport = {
    leaseId: task.leaseId,
    result: result.result,
    code: result.code,
    reason: result.reason,
    detail: result.detail,
    moves: JSON.stringify(result.moves),
    redTimeLeft: result.redTimeLeft,
    blackTimeLeft: result.blackTimeLeft,
  };

  const ok = await apiClient.reportResult(task.gameId, report);
  if (!ok) {
    console.error(
      `[runner] Failed to report result for game ${task.gameId}`,
    );
  }
}
