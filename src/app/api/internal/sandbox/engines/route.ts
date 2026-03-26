export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import { getVisibleEngines } from "@/db/queries";
import { sanitizeEngines } from "@/server/dto";

export async function GET(request: Request) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  return NextResponse.json({
    engines: sanitizeEngines(getVisibleEngines()),
  });
}
