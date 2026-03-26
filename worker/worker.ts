import { loadConfig } from "./config";
import { ApiClient } from "./api-client";
import { EngineCache } from "./engine-cache";
import { executeTask } from "./runner";

const config = loadConfig();
const apiClient = new ApiClient(config.masterUrl, config.workerSecret, config.workerId);
const engineCache = new EngineCache(config.engineCacheDir, apiClient);

let shuttingDown = false;

console.log(
  `[worker] Starting ${config.workerId} | master=${config.masterUrl} | concurrency=${config.maxConcurrentMatches}`,
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
    const task = await apiClient.pollTask();
    if (!task) {
      // No work available, back off with jitter
      await sleep(config.pollIntervalMs + Math.random() * 1000);
      continue;
    }

    console.log(
      `[worker:${slot}] Game ${task.gameId} | ${task.redEngine.name} vs ${task.blackEngine.name}`,
    );

    try {
      await executeTask(task, apiClient, engineCache, config);
      console.log(`[worker:${slot}] Game ${task.gameId} completed`);
    } catch (err) {
      console.error(`[worker:${slot}] Game ${task.gameId} failed:`, err);
    }
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
