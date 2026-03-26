import { nanoid } from "nanoid";
import { resetGameStarted } from "@/db/queries";
import type { Lease } from "./types";

const LEASE_TTL_MS = parseInt(process.env.LEASE_TTL_MS || "120000", 10); // 2 min
const SWEEP_INTERVAL_MS = parseInt(
  process.env.LEASE_SWEEP_INTERVAL_MS || "30000",
  10,
); // 30s

export class LeaseManager {
  private leases = new Map<string, Lease>(); // gameId → Lease
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

  /** Sweep expired leases and reset their games for re-dispatch. */
  private expireStale(): void {
    const now = Date.now();
    for (const [gameId, lease] of this.leases) {
      if (lease.expiresAt < now) {
        console.log(
          `[lease] Expired: game=${gameId} worker=${lease.workerId} (stale ${Math.round((now - lease.expiresAt) / 1000)}s)`,
        );
        this.leases.delete(gameId);
        try {
          resetGameStarted(gameId);
        } catch (err) {
          console.error(`[lease] Failed to reset game ${gameId}:`, err);
        }
      }
    }
  }

  /** Get current lease count (for monitoring). */
  get activeCount(): number {
    return this.leases.size;
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
