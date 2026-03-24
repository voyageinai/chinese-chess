import { NextResponse } from "next/server";
import type { User, Engine, Tournament } from "@/lib/types";
import { countActiveAdmins, getUserById } from "@/db/queries";

const SYSTEM_USER_ID = "__system__";

// ── Response helpers ──────────────────────────────────────────────────

export function denyUnauth(): NextResponse {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export function denyForbidden(msg = "Forbidden"): NextResponse {
  return NextResponse.json({ error: msg }, { status: 403 });
}

// ── Role checks ───────────────────────────────────────────────────────

export function isAdmin(user: User): boolean {
  return user.role === "admin";
}

export function canManageEngine(user: User, engine: Engine): boolean {
  return engine.user_id === user.id || isAdmin(user);
}

export function canManageTournament(user: User, tournament: Tournament): boolean {
  return tournament.owner_id === user.id || isAdmin(user);
}

// ── Safety checks ─────────────────────────────────────────────────────

/**
 * Check if it's safe to demote or ban the target user.
 * Returns false if doing so would remove the last active human admin.
 */
export function canModifyAdmin(targetUserId: string): boolean {
  if (targetUserId === SYSTEM_USER_ID) return false;
  const target = getUserById(targetUserId);
  if (!target || target.role !== "admin") return true; // not an admin, safe
  return countActiveAdmins() > 1;
}

/**
 * Check if the target user is the system user (cannot be modified).
 */
export function isSystemUser(userId: string): boolean {
  return userId === SYSTEM_USER_ID;
}
