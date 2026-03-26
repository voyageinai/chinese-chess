#!/usr/bin/env npx tsx

import * as queries from "../src/db/queries";

interface Options {
  positions: number;
  workers: number;
  seed: number;
  policyMovetime: number;
  selfplayMovetime: number;
  analysisMovetime: number;
  policyOutput: string;
  balancedOutput: string;
  maxTime: number | null;
  wait: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const read = (name: string, fallback: string) => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
  };
  return {
    positions: parseInt(read("positions", "20000"), 10),
    workers: parseInt(read("workers", "4"), 10),
    seed: parseInt(read("seed", "42"), 10),
    policyMovetime: parseInt(read("policy-movetime", "80"), 10),
    selfplayMovetime: parseInt(read("selfplay-movetime", "50"), 10),
    analysisMovetime: parseInt(read("analysis-movetime", "80"), 10),
    policyOutput: read("policy-output", "autoresearch/models/policy_v12_20k.npz"),
    balancedOutput: read("balanced-output", "autoresearch/models/balanced_v2_20k.npz"),
    maxTime: read("max-time", "") ? parseInt(read("max-time", ""), 10) : null,
    wait: args.includes("--wait"),
  };
}

function summarize(jobId: string): string {
  const job = queries.getResearchJobById(jobId);
  const shards = queries.getResearchShardsByJob(jobId);
  if (!job) return `${jobId}: missing`;
  const counts = { pending: 0, running: 0, completed: 0, failed: 0 };
  for (const shard of shards) counts[shard.status] += 1;
  return `${job.kind} ${job.id} ${job.status} | pending=${counts.pending} running=${counts.running} completed=${counts.completed} failed=${counts.failed}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs();
  if (opts.positions <= 0) throw new Error("--positions must be >= 1");
  if (opts.workers <= 0) throw new Error("--workers must be >= 1");

  const teacher = queries.getEngineByName("Pikafish");
  if (!teacher) {
    throw new Error("Pikafish engine not found in DB");
  }

  const policyJob = queries.createResearchJob({
    kind: "policy",
    outputPath: opts.policyOutput,
    positions: opts.positions,
    shardCount: opts.workers,
    seed: opts.seed,
    params: {
      teacherEngineId: teacher.id,
      movetime: opts.policyMovetime,
      ...(opts.maxTime != null ? { maxTime: opts.maxTime } : {}),
    },
  });
  const balancedJob = queries.createResearchJob({
    kind: "balanced",
    outputPath: opts.balancedOutput,
    positions: opts.positions,
    shardCount: opts.workers,
    seed: opts.seed + 100000,
    params: {
      teacherEngineId: teacher.id,
      selfplayMovetime: opts.selfplayMovetime,
      analysisMovetime: opts.analysisMovetime,
      ...(opts.maxTime != null ? { maxTime: opts.maxTime } : {}),
    },
  });

  console.log("Queued distributed research jobs:");
  console.log(`  policy   ${policyJob.id} -> ${policyJob.output_path}`);
  console.log(`  balanced ${balancedJob.id} -> ${balancedJob.output_path}`);

  if (!opts.wait) return;

  const jobIds = [policyJob.id, balancedJob.id];
  while (true) {
    const snapshots = jobIds.map((jobId) => ({
      jobId,
      job: queries.getResearchJobById(jobId),
    }));
    for (const snap of snapshots) {
      console.log(summarize(snap.jobId));
    }
    console.log("");

    if (snapshots.every((snap) => snap.job && ["completed", "failed"].includes(snap.job.status))) {
      break;
    }
    await sleep(5000);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
