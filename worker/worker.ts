import { loadConfig } from "./config";
import { ApiClient } from "./api-client";
import { EngineCache } from "./engine-cache";
import { executeTask } from "./runner";
import { executeResearchTask } from "./research-runner";

const config = loadConfig();
const apiClient = new ApiClient(config.masterUrl, config.workerSecret, config.workerId);
const engineCache = new EngineCache(config.engineCacheDir, apiClient);

let shuttingDown = false;
let activeResearch = 0;
const maxConcurrentResearch = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_RESEARCH || "1", 10),
);

console.log(
  `[worker] Starting ${config.workerId} | master=${config.masterUrl} | concurrency=${config.maxConcurrentMatches} | research=${maxConcurrentResearch}`,
);

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[worker] SIGTERM received, finishing current matches...");
  shuttingDown = true;
});
process.on("SIGINT", () => {
  console.log("[worker] SIGINT received, finishing current matches...");
  shuttingDown = true;
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function workerLoop(slot: number): Promise<void> {
  while (!shuttingDown) {
    const matchTask = await apiClient.pollTask();
    if (matchTask) {
      console.log(
        `[worker:${slot}] Game ${matchTask.gameId} | ${matchTask.redEngine.name} vs ${matchTask.blackEngine.name}`,
      );

      try {
        await executeTask(matchTask, apiClient, engineCache, config);
        console.log(`[worker:${slot}] Game ${matchTask.gameId} completed`);
      } catch (err) {
        console.error(`[worker:${slot}] Game ${matchTask.gameId} failed:`, err);
      }
      continue;
    }

    if (activeResearch < maxConcurrentResearch) {
      const researchTask = await apiClient.pollResearchTask();
      if (researchTask) {
        activeResearch++;
        console.log(
          `[worker:${slot}] Research ${researchTask.kind} shard ${researchTask.shardId} | positions=${researchTask.params.positions} (research ${activeResearch}/${maxConcurrentResearch})`,
        );
        try {
          await executeResearchTask(researchTask, apiClient, engineCache, config);
          console.log(`[worker:${slot}] Research shard ${researchTask.shardId} completed`);
        } catch (err) {
          console.error(`[worker:${slot}] Research shard ${researchTask.shardId} failed:`, err);
        } finally {
          activeResearch--;
        }
        continue;
      }
    }

    // No work available, back off with jitter
    await sleep(config.pollIntervalMs + Math.random() * 1000);
  }

  console.log(`[worker:${slot}] Stopped`);
}

// Launch concurrent worker loops
const loops: Promise<void>[] = [];
for (let i = 0; i < config.maxConcurrentMatches; i++) {
  loops.push(workerLoop(i));
}

Promise.all(loops).then(() => {
  console.log("[worker] All loops stopped, exiting");
  process.exit(0);
});
