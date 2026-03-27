import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import * as queries from "@/db/queries";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return denyUnauth();
  if (!isAdmin(user)) return denyForbidden();

  const jobs = queries.listResearchJobs(50);
  const jobsWithProgress = jobs.map((job) => {
    const shards = queries.getResearchShardsByJob(job.id);
    const totalPositions = shards.reduce((sum, s) => sum + s.positions, 0);
    const collectedPositions = shards.reduce((sum, s) => sum + s.progress_positions, 0);
    const counts = { pending: 0, running: 0, completed: 0, failed: 0 };
    for (const s of shards) counts[s.status as keyof typeof counts] += 1;
    return { ...job, shardCounts: counts, totalPositions, collectedPositions };
  });

  return NextResponse.json({ jobs: jobsWithProgress });
}
