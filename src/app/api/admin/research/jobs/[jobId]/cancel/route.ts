import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import * as queries from "@/db/queries";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return denyUnauth();
  if (!isAdmin(user)) return denyForbidden();

  const { jobId } = await params;
  const job = queries.getResearchJobById(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const affected = queries.setJobPendingCommand(jobId, "cancel");
  return NextResponse.json({ ok: true, shardsAffected: affected });
}
