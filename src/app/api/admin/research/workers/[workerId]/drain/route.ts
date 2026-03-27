import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import { getLeaseManager } from "@/server/distributed/lease-manager";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workerId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return denyUnauth();
  if (!isAdmin(user)) return denyForbidden();

  const { workerId } = await params;
  getLeaseManager().drainWorker(workerId);
  return NextResponse.json({ ok: true, workerId, draining: true });
}
