export const SYSTEM_USER_ID = "__system__";
export const SANDBOX_USER_ID = "__sandbox__";

export const SERVICE_USER_IDS = [SYSTEM_USER_ID, SANDBOX_USER_ID] as const;

export function isServiceUserId(userId: string): boolean {
  return userId === SYSTEM_USER_ID || userId === SANDBOX_USER_ID;
}
