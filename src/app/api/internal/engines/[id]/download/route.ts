export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { validateWorkerAuth, denyWorkerAuth, isDistributedEnabled } from "@/server/distributed/auth";
import {
  getEngineContentHash,
  getEngineFilename,
  isEngineDirectory,
  packEngineFiles,
} from "@/server/distributed/engine-server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDistributedEnabled()) {
    return NextResponse.json({ error: "Distributed mode not enabled" }, { status: 503 });
  }
  if (!validateWorkerAuth(request)) return denyWorkerAuth();

  const { id: engineId } = await params;

  const contentHash = getEngineContentHash(engineId);
  if (!contentHash) {
    return NextResponse.json({ error: "Engine not found" }, { status: 404 });
  }

  // Conditional download: if client has matching hash, skip
  const url = new URL(request.url);
  const clientHash = url.searchParams.get("hash");
  if (clientHash === contentHash) {
    return new NextResponse(null, { status: 304 });
  }

  const filename = getEngineFilename(engineId);
  const isDir = isEngineDirectory(engineId);
  const data = packEngineFiles(engineId);

  if (!data) {
    return NextResponse.json({ error: "Failed to read engine files" }, { status: 500 });
  }

  return new NextResponse(data as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Content-Hash": contentHash,
      "X-Engine-Filename": filename || "engine",
      "X-Engine-Is-Directory": isDir ? "true" : "false",
    },
  });
}
