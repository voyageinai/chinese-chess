import { NextResponse } from "next/server";

export function getWorkerSecret(): string {
  return process.env.WORKER_SECRET || "";
}

export function isDistributedEnabled(): boolean {
  return getWorkerSecret().length > 0;
}

export function validateWorkerAuth(request: Request): boolean {
  const secret = getWorkerSecret();
  if (!secret) return false;
  return request.headers.get("x-worker-secret") === secret;
}

export function denyWorkerAuth(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
