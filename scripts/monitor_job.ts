#!/usr/bin/env npx tsx
import * as queries from "../src/db/queries";

const jobId = process.argv[2] || "O1tiHHxp351Pewk_YxAQO";

function check() {
  const job = queries.getResearchJobById(jobId);
  const shards = queries.getResearchShardsByJob(jobId);
  const now = new Date();

  console.log(`\n═══ ${now.toLocaleString()} ═══`);
  console.log(`Job ${jobId} | status: ${job?.status}`);

  let allDone = true;
  for (const s of shards) {
    const nowSec = Math.floor(Date.now() / 1000);
    const claimedSec = typeof s.claimed_at === "number" ? s.claimed_at : 0;
    const elapsed = claimedSec > 0 ? nowSec - claimedSec : 0;
    const elapsedStr =
      elapsed > 0
        ? `${Math.floor(elapsed / 3600)}h${Math.floor((elapsed % 3600) / 60)}m`
        : "-";
    const hbSec = typeof s.last_heartbeat_at === "number" ? s.last_heartbeat_at : 0;
    const hbAgo = hbSec > 0 ? nowSec - hbSec : -1;
    const hbStr = hbAgo >= 0 ? `${hbAgo}s ago` : "-";
    const stats = s.stats_json ? JSON.parse(s.stats_json) : null;
    const extra = stats?.stdoutTail
      ? ` | last: ${stats.stdoutTail.split("\n").filter(Boolean).pop()?.slice(0, 80)}`
      : "";

    console.log(
      `  shard ${s.shard_index} | ${s.status.padEnd(9)} | ${(s.worker_id || "-").padEnd(12)} | elapsed: ${elapsedStr.padEnd(8)} | hb: ${hbStr.padEnd(8)}${extra}`,
    );

    if (s.status !== "completed" && s.status !== "failed") allDone = false;
  }

  if (allDone) {
    console.log(`\n✓ All shards done. Job final status: ${job?.status}`);
    if (job?.status === "completed") {
      console.log(`  Output: ${job.output_path}`);
    } else if (job?.error_text) {
      console.log(`  Error: ${job.error_text}`);
    }
    process.exit(0);
  }
}

check();
setInterval(check, 60000);
