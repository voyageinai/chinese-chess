import { NextResponse } from "next/server";

const WORKER_SECRET = process.env.WORKER_SECRET || "";

export function isDistributedEnabled(): boolean {
  return WORKER_SECRET.length > 0;
}

export function validateWorkerAuth(request: Request): boolean {
  if (!WORKER_SECRET) return false;
  return request.headers.get("x-worker-secret") === WORKER_SECRET;
}

export function denyWorkerAuth(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
