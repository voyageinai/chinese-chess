import { execFile } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { promisify } from "util";
import * as queries from "@/db/queries";
import { getEngineContentHash } from "./engine-server";
import type {
  ResearchHeartbeatRequest,
  ResearchResultReport,
  ResearchTask,
} from "./types";

const execFileAsync = promisify(execFile);
const LEASE_TTL_MS = parseInt(process.env.LEASE_TTL_MS || "120000", 10);

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function requireNumber(
  value: unknown,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function pollResearchTask(workerId: string): ResearchTask | null {
  const shard = queries.pollResearchShard(workerId);
  if (!shard || !shard.lease_id) return null;

  const jobParams = parseJsonObject(shard.job_params_json);
  const shardParams = parseJsonObject(shard.params_json);
  const teacherEngineId = String(
    jobParams.teacherEngineId ?? shardParams.teacherEngineId ?? "",
  );
  if (!teacherEngineId) {
    queries.failResearchShard(
      shard.id,
      shard.lease_id,
      `Shard ${shard.id} missing teacherEngineId`,
    );
    return null;
  }

  const teacherEngine = queries.getEngineById(teacherEngineId);
  const teacherHash = getEngineContentHash(teacherEngineId);
  if (!teacherEngine || !teacherHash) {
    queries.failResearchShard(
      shard.id,
      shard.lease_id,
      `Teacher engine unavailable for shard ${shard.id}`,
    );
    return null;
  }

  return {
    leaseId: shard.lease_id,
    jobId: shard.job_id,
    shardId: shard.id,
    shardIndex: shard.shard_index,
    kind: shard.job_kind,
    outputPath: shard.job_output_path,
    leaseExpiresAt: Date.now() + LEASE_TTL_MS,
    teacherEngine: {
      id: teacherEngine.id,
      name: teacherEngine.name,
      contentHash: teacherHash,
    },
    params: {
      positions: shard.positions,
      seed: shard.seed,
      outputFilename: `${shard.job_kind}_shard_${shard.shard_index}.npz`,
      teacherEngineId,
      movetime: requireNumber(jobParams.movetime, 80),
      selfplayMovetime: requireNumber(jobParams.selfplayMovetime, 50),
      analysisMovetime: requireNumber(jobParams.analysisMovetime, 80),
    },
  };
}

export function heartbeatResearchTask(
  shardId: string,
  body: ResearchHeartbeatRequest,
): { ok: boolean; leaseExpiresAt?: number } {
  const ok = queries.renewResearchShardLease(shardId, body.leaseId, body.workerId);
  if (!ok) return { ok: false };
  return { ok: true, leaseExpiresAt: Date.now() + LEASE_TTL_MS };
}

export function storeResearchArtifact(
  shardId: string,
  leaseId: string,
  filename: string,
  data: Buffer,
): { ok: boolean; path?: string; reason?: string } {
  const shard = queries.getResearchShardById(shardId);
  if (!shard || shard.lease_id !== leaseId || !shard.job_id) {
    return { ok: false, reason: "invalid_lease" };
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "artifact.npz";
  const shardDir = path.join(process.cwd(), "autoresearch", "jobs", shard.job_id, "shards");
  mkdirSync(shardDir, { recursive: true });

  const destPath = path.join(
    shardDir,
    `${String(shard.shard_index).padStart(3, "0")}-${shard.id}-${safeName}`,
  );
  writeFileSync(destPath, data);

  const recorded = queries.recordResearchShardUpload(shardId, leaseId, destPath);
  if (!recorded) {
    return { ok: false, reason: "upload_rejected" };
  }
  return { ok: true, path: destPath };
}

export async function handleResearchResult(
  shardId: string,
  report: ResearchResultReport,
): Promise<{ ok: boolean; reason?: string }> {
  if (report.status === "failed") {
    const failed = queries.failResearchShard(
      shardId,
      report.leaseId,
      report.error || "research shard failed",
    );
    return failed ? { ok: true } : { ok: false, reason: "invalid_lease" };
  }

  const shard = queries.completeResearchShard(
    shardId,
    report.leaseId,
    report.statsJson ?? null,
  );
  if (!shard) {
    return { ok: false, reason: "invalid_lease" };
  }

  await maybeFinalizeResearchJob(shard.job_id);
  return { ok: true };
}

export async function maybeFinalizeResearchJob(jobId: string): Promise<void> {
  const job = queries.getResearchJobById(jobId);
  if (!job) return;

  const shards = queries.getResearchShardsByJob(jobId);
  if (shards.length === 0) return;
  if (shards.some((shard) => shard.status === "failed")) {
    queries.markResearchJobFailed(jobId, "One or more shards failed");
    return;
  }
  if (shards.some((shard) => shard.status !== "completed" || !shard.uploaded_path)) {
    return;
  }
  if (!queries.tryStartResearchJobFinalization(jobId)) {
    return;
  }

  const mergeScript = path.join(process.cwd(), "scripts", "merge_research_shards.py");
  const outputPath = path.resolve(process.cwd(), job.output_path);
  const inputs = shards
    .map((shard) => shard.uploaded_path!)
    .sort((left, right) => left.localeCompare(right));

  mkdirSync(path.dirname(outputPath), { recursive: true });

  try {
    await execFileAsync(
      "python3",
      [mergeScript, "--kind", job.kind, "--output", outputPath, ...inputs],
      {
        cwd: process.cwd(),
        maxBuffer: 256 * 1024 * 1024,
      },
    );
    queries.markResearchJobCompleted(jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    queries.markResearchJobFailed(jobId, `Finalization failed: ${message}`);
  }
}
