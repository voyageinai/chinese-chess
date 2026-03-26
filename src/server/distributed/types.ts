import type { ResultCode } from "@/lib/types";

// ---------------------------------------------------------------------------
// Lease
// ---------------------------------------------------------------------------

export interface Lease {
  leaseId: string;
  gameId: string;
  workerId: string;
  expiresAt: number; // Date.now() + TTL
  grantedAt: number;
}

// ---------------------------------------------------------------------------
// Task (returned to Worker on poll)
// ---------------------------------------------------------------------------

export interface EngineRef {
  id: string;
  name: string;
  contentHash: string; // sha256:<hex>
}

export interface WorkerTask {
  leaseId: string;
  gameId: string;
  tournamentId: string;
  redEngine: EngineRef;
  blackEngine: EngineRef;
  timeBase: number; // ms
  timeInc: number; // ms
  startFen: string | null;
  leaseExpiresAt: number;
}

// ---------------------------------------------------------------------------
// Worker → Master request payloads
// ---------------------------------------------------------------------------

export interface PollRequest {
  workerId: string;
}

export interface HeartbeatRequest {
  leaseId: string;
  workerId: string;
  ply: number;
}

export interface MoveReport {
  leaseId: string;
  move: {
    move: string;
    fen: string;
    time_ms: number;
    eval: number | null;
    depth: number | null;
  };
  ply: number;
  redTime: number;
  blackTime: number;
  movedAt: number;
}

export interface ThinkingReport {
  leaseId: string;
  gameId: string;
  side: "red" | "black";
  depth: number | null;
  eval: number | null;
  nodes: number | null;
  pv: string | null;
}

export interface ResultReport {
  leaseId: string;
  result: "red" | "black" | "draw";
  code: ResultCode;
  reason: string;
  detail: string | null;
  moves: string; // JSON stringified StoredMove[]
  redTimeLeft: number;
  blackTimeLeft: number;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface LeaseOkResponse {
  ok: true;
  leaseExpiresAt: number;
}

export interface LeaseExpiredResponse {
  ok: false;
  reason: "lease_expired";
}
