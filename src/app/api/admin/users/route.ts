import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAllUsers } from "@/db/queries";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();
    if (!isAdmin(user)) return denyForbidden();

    const users = getAllUsers();
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Admin get users error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
