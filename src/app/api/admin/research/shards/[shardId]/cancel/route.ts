import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import * as queries from "@/db/queries";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ shardId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return denyUnauth();
  if (!isAdmin(user)) return denyForbidden();

  const { shardId } = await params;
  const ok = queries.setShardPendingCommand(shardId, "cancel");
  if (!ok) {
    return NextResponse.json({ error: "Shard not found or not running" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
