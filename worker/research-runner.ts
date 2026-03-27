import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import type { ApiClient } from "./api-client";
import type { EngineCache } from "./engine-cache";
import type { ResearchTask } from "../src/server/distributed/types";
import type { WorkerConfig } from "./config";

function tail(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

/** Parse the last PROGRESS line from stdout for real-time position/game counts. */
function parseProgress(stdout: string): { positions: number; games: number } {
  let positions = 0;
  let games = 0;
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/PROGRESS:\s*positions=(\d+)\s+games=(\d+)/);
    if (match) {
      positions = parseInt(match[1], 10);
      games = parseInt(match[2], 10);
      break;
    }
  }
  return { positions, games };
}

function buildCommand(
  task: ResearchTask,
  teacherPath: string,
  outputPath: string,
): { cmd: string; args: string[] } {
  if (task.kind === "policy") {
    return {
      cmd: "python3",
      args: [
        "scripts/generate_policy.py",
        "--positions",
        String(task.params.positions),
        "--movetime",
        String(task.params.movetime ?? 80),
        "--workers",
        "1",
        "--seed",
        String(task.params.seed),
        "--engine",
        teacherPath,
        "--output",
        outputPath,
        "--output-mode",
        "shard",
      ],
    };
  }

  const balancedArgs = [
    "scripts/generate_balanced_data.py",
    "--positions",
    String(task.params.positions),
    "--selfplay-movetime",
    String(task.params.selfplayMovetime ?? 50),
    "--analysis-movetime",
    String(task.params.analysisMovetime ?? 80),
    "--workers",
    "1",
    "--seed",
    String(task.params.seed),
    "--engine",
    teacherPath,
    "--output",
    outputPath,
  ];
  if (task.params.maxTime != null) {
    balancedArgs.push("--max-time", String(task.params.maxTime));
  }
  return { cmd: "python3", args: balancedArgs };
}

export async function executeResearchTask(
  task: ResearchTask,
  apiClient: ApiClient,
  engineCache: EngineCache,
  config: WorkerConfig,
): Promise<void> {
  let teacherPath: string;
  try {
    teacherPath = await engineCache.ensureEngine(task.teacherEngine);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await apiClient.reportResearchResult(task.shardId, {
      leaseId: task.leaseId,
      status: "failed",
      error: `failed to prepare teacher engine: ${message}`,
    });
    return;
  }

  const workDir = path.resolve(config.researchTempDir, task.jobId);
  mkdirSync(workDir, { recursive: true });
  const outputPath = path.join(workDir, `${task.shardId}.npz`);

  const { cmd, args } = buildCommand(task, teacherPath, outputPath);
  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let leaseValid = true;
  let gracefulStop = false;
  let progress = 0;
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const heartbeatTimer = setInterval(async () => {
    progress += 1;
    const { positions, games } = parseProgress(stdout);
    const result = await apiClient.heartbeatResearch(task.shardId, {
      leaseId: task.leaseId,
      workerId: config.workerId,
      progress,
      positionsCollected: positions,
      gamesPlayed: games,
    });

    if (!result.ok) {
      leaseValid = false;
      child.kill("SIGTERM");
      clearInterval(heartbeatTimer);
      return;
    }

    // Already stopping gracefully — keep heartbeats alive but skip commands
    if (gracefulStop) return;

    if (result.command === "stop") {
      console.log(`[research] Received stop command for shard ${task.shardId}, graceful shutdown`);
      gracefulStop = true;
      child.kill("SIGTERM");
      // Do NOT clearInterval — keep heartbeats to hold the lease while Python saves
      return;
    }

    if (result.command === "cancel") {
      console.log(`[research] Received cancel command for shard ${task.shardId}, killing`);
      leaseValid = false;
      child.kill("SIGKILL");
      clearInterval(heartbeatTimer);
      return;
    }
  }, config.heartbeatIntervalMs);

  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        // Graceful stop via SIGTERM exits with non-zero but that's expected
        if (gracefulStop && (signal === "SIGTERM" || code === null)) {
          resolve();
          return;
        }
        reject(
          new Error(
            `research shard exited code=${code ?? "null"} signal=${signal ?? "null"}`,
          ),
        );
      });
    });
  } catch (error) {
    clearInterval(heartbeatTimer);
    if (!leaseValid) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await apiClient.reportResearchResult(task.shardId, {
      leaseId: task.leaseId,
      status: "failed",
      error: `${message}\n${tail(stderr)}`.trim(),
    });
    return;
  } finally {
    clearInterval(heartbeatTimer);
  }

  if (!leaseValid) {
    return;
  }
  if (!existsSync(outputPath)) {
    await apiClient.reportResearchResult(task.shardId, {
      leaseId: task.leaseId,
      status: "failed",
      error: `research shard produced no artifact at ${outputPath}`,
    });
    return;
  }

  const data = readFileSync(outputPath);
  const uploaded = await apiClient.uploadResearchArtifact(
    task.shardId,
    task.leaseId,
    path.basename(outputPath),
    data,
  );
  if (!uploaded) {
    await apiClient.reportResearchResult(task.shardId, {
      leaseId: task.leaseId,
      status: "failed",
      error: "failed to upload research artifact",
    });
    return;
  }

  await apiClient.reportResearchResult(task.shardId, {
    leaseId: task.leaseId,
    status: "completed",
    resultType: gracefulStop ? "partial" : "full",
    statsJson: JSON.stringify({
      bytes: data.length,
      stdoutTail: tail(stdout),
      stderrTail: tail(stderr),
    }),
  });
}
