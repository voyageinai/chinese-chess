import { NextResponse } from "next/server";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { createInviteCode, getInviteCodes } from "@/db/queries";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import { logAudit } from "@/server/audit";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();
    if (!isAdmin(user)) return denyForbidden();

    const invites = getInviteCodes();
    return NextResponse.json({ invites });
  } catch (error) {
    console.error("Admin get invites error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();
    if (!isAdmin(user)) return denyForbidden();

    const body = await request.json().catch(() => ({}));
    const expiresInDays = body.expiresInDays ?? 7;

    const code = crypto.randomBytes(16).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInDays * 86400;

    createInviteCode(code, user.id, expiresAt);

    logAudit("invite.create", user.id, null, null, {
      expires_in_days: expiresInDays,
    });

    return NextResponse.json({ code, expiresAt }, { status: 201 });
  } catch (error) {
    console.error("Admin create invite error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
