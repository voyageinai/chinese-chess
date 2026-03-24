import { createAuditLog } from "@/db/queries";

/**
 * Log an audit event. Synchronous (SQLite), safe to call in transactions.
 */
export function logAudit(
  action: string,
  actorId: string,
  targetType: string | null,
  targetId: string | null,
  details: Record<string, unknown> = {},
): void {
  createAuditLog(action, actorId, targetType, targetId, details);
}
