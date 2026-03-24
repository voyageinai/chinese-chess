import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAllEngines } from "@/db/queries";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import { sanitizeEngines } from "@/server/dto";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();
    if (!isAdmin(user)) return denyForbidden();

    const engines = getAllEngines();
    return NextResponse.json({ engines: sanitizeEngines(engines) });
  } catch (error) {
    console.error("Admin get engines error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
