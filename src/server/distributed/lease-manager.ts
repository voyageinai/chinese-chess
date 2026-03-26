import { nanoid } from "nanoid";
import { resetGameStarted } from "@/db/queries";
import type { Lease } from "./types";

const LEASE_TTL_MS = parseInt(process.env.LEASE_TTL_MS || "120000", 10); // 2 min
const SWEEP_INTERVAL_MS = parseInt(
  process.env.LEASE_SWEEP_INTERVAL_MS || "30000",
  10,
); // 30s

// Workers that haven't been seen for this long are considered offline
const WORKER_OFFLINE_MS = 60_000; // 60s

// ---------------------------------------------------------------------------
// Worker stats (in-memory, resets on master restart)
// ---------------------------------------------------------------------------

export interface WorkerStats {
  workerId: string;
  lastSeenAt: number;
  completedGames: number;
  /** Current ply counts reported by heartbeats, keyed by gameId */
  currentPly: Map<string, number>;
}

export interface WorkerMonitoringInfo {
  id: string;
  status: "online" | "idle" | "offline";
  currentGames: string[];
  lastSeenAt: number;
  completedGames: number;
}

export interface LeaseMonitoringInfo {
  gameId: string;
  leaseId: string;
  workerId: string;
  grantedAt: number;
  expiresAt: number;
  ply: number;
}

export interface DistributedMonitoringData {
  enabled: boolean;
  workers: WorkerMonitoringInfo[];
  leases: LeaseMonitoringInfo[];
  stats: {
    totalWorkers: number;
    onlineWorkers: number;
    activeLeases: number;
  };
}

// ---------------------------------------------------------------------------
// LeaseManager
// ---------------------------------------------------------------------------

export class LeaseManager {
  private leases = new Map<string, Lease>(); // gameId → Lease
  private workerStats = new Map<string, WorkerStats>(); // workerId → stats
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.sweepTimer = setInterval(() => this.expireStale(), SWEEP_INTERVAL_MS);
    console.log(
      `[lease] Started (ttl=${LEASE_TTL_MS}ms, sweep=${SWEEP_INTERVAL_MS}ms)`,
    );
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Create a lease for a game. Returns null if game already has an active lease. */
  create(gameId: string, workerId: string): Lease | null {
    const existing = this.leases.get(gameId);
    if (existing && existing.expiresAt > Date.now()) {
      return null; // active lease exists
    }
    const lease: Lease = {
      leaseId: nanoid(),
      gameId,
      workerId,
      expiresAt: Date.now() + LEASE_TTL_MS,
      grantedAt: Date.now(),
    };
    this.leases.set(gameId, lease);
    return lease;
  }

  /** Renew an existing lease. Returns new expiry or null if invalid/expired. */
  renew(gameId: string, leaseId: string): number | null {
    const lease = this.leases.get(gameId);
    if (!lease || lease.leaseId !== leaseId) return null;
    if (lease.expiresAt < Date.now()) {
      this.leases.delete(gameId);
      return null;
    }
    lease.expiresAt = Date.now() + LEASE_TTL_MS;
    return lease.expiresAt;
  }

  /** Validate that a lease is active and matches. */
  validate(gameId: string, leaseId: string): boolean {
    const lease = this.leases.get(gameId);
    if (!lease || lease.leaseId !== leaseId) return false;
    return lease.expiresAt > Date.now();
  }

  /** Release a lease (game completed). */
  release(gameId: string, leaseId: string): void {
    const lease = this.leases.get(gameId);
    if (lease && lease.leaseId === leaseId) {
      this.leases.delete(gameId);
    }
  }

  /** Get a lease by gameId (for reading workerId before release). */
  getLease(gameId: string): Lease | null {
    return this.leases.get(gameId) ?? null;
  }

  /** Check if a game has an active lease. */
  hasActiveLease(gameId: string): boolean {
    const lease = this.leases.get(gameId);
    if (!lease) return false;
    if (lease.expiresAt < Date.now()) {
      this.leases.delete(gameId);
      return false;
    }
    return true;
  }

  // ── Worker tracking ─────────────────────────────────────────────────

  /** Record a worker interaction (poll, heartbeat, result). */
  trackWorker(workerId: string): void {
    let stats = this.workerStats.get(workerId);
    if (!stats) {
      stats = { workerId, lastSeenAt: Date.now(), completedGames: 0, currentPly: new Map() };
      this.workerStats.set(workerId, stats);
    }
    stats.lastSeenAt = Date.now();
  }

  /** Record heartbeat ply for a game. */
  trackHeartbeat(workerId: string, gameId: string, ply: number): void {
    this.trackWorker(workerId);
    const stats = this.workerStats.get(workerId)!;
    stats.currentPly.set(gameId, ply);
  }

  /** Record game completion by a worker. */
  trackCompletion(workerId: string, gameId: string): void {
    this.trackWorker(workerId);
    const stats = this.workerStats.get(workerId)!;
    stats.completedGames++;
    stats.currentPly.delete(gameId);
  }

  // ── Monitoring ──────────────────────────────────────────────────────

  /** Build monitoring data snapshot for the admin API. */
  getMonitoringData(): DistributedMonitoringData {
    const now = Date.now();

    // Build set of workerIds that currently hold leases
    const workerLeaseMap = new Map<string, string[]>(); // workerId → gameIds
    for (const lease of this.leases.values()) {
      if (lease.expiresAt > now) {
        const games = workerLeaseMap.get(lease.workerId) || [];
        games.push(lease.gameId);
        workerLeaseMap.set(lease.workerId, games);
      }
    }

    // Workers
    const workers: WorkerMonitoringInfo[] = [];
    for (const stats of this.workerStats.values()) {
      const currentGames = workerLeaseMap.get(stats.workerId) || [];
      let status: "online" | "idle" | "offline";
      if (now - stats.lastSeenAt > WORKER_OFFLINE_MS) {
        status = "offline";
      } else if (currentGames.length > 0) {
        status = "online";
      } else {
        status = "idle";
      }
      workers.push({
        id: stats.workerId,
        status,
        currentGames,
        lastSeenAt: stats.lastSeenAt,
        completedGames: stats.completedGames,
      });
    }
    // Sort: online first, then idle, then offline
    const statusOrder = { online: 0, idle: 1, offline: 2 };
    workers.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    // Leases
    const leases: LeaseMonitoringInfo[] = [];
    for (const lease of this.leases.values()) {
      if (lease.expiresAt > now) {
        const workerStat = this.workerStats.get(lease.workerId);
        leases.push({
          gameId: lease.gameId,
          leaseId: lease.leaseId,
          workerId: lease.workerId,
          grantedAt: lease.grantedAt,
          expiresAt: lease.expiresAt,
          ply: workerStat?.currentPly.get(lease.gameId) ?? 0,
        });
      }
    }

    const onlineWorkers = workers.filter((w) => w.status !== "offline").length;

    return {
      enabled: true,
      workers,
      leases,
      stats: {
        totalWorkers: workers.length,
        onlineWorkers,
        activeLeases: leases.length,
      },
    };
  }

  /** Get current lease count (for monitoring). */
  get activeCount(): number {
    return this.leases.size;
  }

  /** Sweep expired leases and reset their games for re-dispatch. */
  private expireStale(): void {
    const now = Date.now();
    for (const [gameId, lease] of this.leases) {
      if (lease.expiresAt < now) {
        console.log(
          `[lease] Expired: game=${gameId} worker=${lease.workerId} (stale ${Math.round((now - lease.expiresAt) / 1000)}s)`,
        );
        this.leases.delete(gameId);
        // Clean from worker ply tracking
        const stats = this.workerStats.get(lease.workerId);
        if (stats) stats.currentPly.delete(gameId);
        try {
          resetGameStarted(gameId);
        } catch (err) {
          console.error(`[lease] Failed to reset game ${gameId}:`, err);
        }
      }
    }
  }
}

// Singleton
let instance: LeaseManager | null = null;

export function getLeaseManager(): LeaseManager {
  if (!instance) {
    instance = new LeaseManager();
  }
  return instance;
}

export function initLeaseManager(): LeaseManager {
  const mgr = getLeaseManager();
  mgr.start();
  return mgr;
}
