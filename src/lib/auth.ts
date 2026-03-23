import { cookies } from "next/headers";
import { verifyToken } from "@/server/auth";
import { getUserById } from "@/db/queries";
import type { User } from "@/lib/types";

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return getUserById(payload.userId) ?? null;
}
