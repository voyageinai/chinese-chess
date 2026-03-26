export interface WorkerConfig {
  masterUrl: string;
  workerSecret: string;
  workerId: string;
  maxConcurrentMatches: number;
  engineCacheDir: string;
  researchTempDir: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
}

export function loadConfig(): WorkerConfig {
  const masterUrl = process.env.MASTER_URL;
  if (!masterUrl) {
    throw new Error("MASTER_URL is required (e.g. http://10.0.0.1:3000)");
  }

  const workerSecret = process.env.WORKER_SECRET;
  if (!workerSecret) {
    throw new Error("WORKER_SECRET is required");
  }

  return {
    masterUrl: masterUrl.replace(/\/$/, ""), // strip trailing slash
    workerSecret,
    workerId: process.env.WORKER_ID || `worker-${process.pid}`,
    maxConcurrentMatches: Math.max(
      1,
      parseInt(process.env.MAX_CONCURRENT_MATCHES || "2", 10),
    ),
    engineCacheDir: process.env.WORKER_ENGINE_CACHE_DIR || "./data/engine-cache",
    researchTempDir: process.env.WORKER_RESEARCH_TEMP_DIR || "./data/research-cache",
    pollIntervalMs: 3000,
    heartbeatIntervalMs: 15000,
  };
}
