import { NextResponse } from "next/server";
import { hashPassword, signToken, validateInviteCode } from "@/server/auth";
import { createUser, getUserByUsername, getInviteCodeByCode, useInviteCode as markInviteCodeUsed } from "@/db/queries";
import { logAudit } from "@/server/audit";

export async function POST(request: Request) {
  try {
    const { username, password, inviteCode } = await request.json();

    if (!username || !password || !inviteCode) {
      return NextResponse.json(
        { error: "Missing required fields: username, password, inviteCode" },
        { status: 400 },
      );
    }

    if (typeof username !== "string" || username.length < 2 || username.length > 32) {
      return NextResponse.json(
        { error: "Username must be between 2 and 32 characters" },
        { status: 400 },
      );
    }

    if (typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }

    // Check invite code: try DB codes first, then fall back to env var
    const dbCode = getInviteCodeByCode(inviteCode);
    const isDbCode = dbCode && !dbCode.used_by && dbCode.expires_at > Math.floor(Date.now() / 1000);
    const isEnvCode = validateInviteCode(inviteCode);

    if (!isDbCode && !isEnvCode) {
      return NextResponse.json(
        { error: "Invalid invite code" },
        { status: 403 },
      );
    }

    const existing = getUserByUsername(username);
    if (existing) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);
    const user = createUser(username, passwordHash);

    // Mark DB invite code as used (atomic — useInviteCode checks used_by IS NULL)
    if (isDbCode) {
      markInviteCodeUsed(inviteCode, user.id);
    }

    logAudit("user.register", user.id, "user", user.id, {
      username,
      invite_type: isDbCode ? "db" : "env",
    });

    const token = signToken({ userId: user.id, role: user.role });

    const response = NextResponse.json({ user });
    response.cookies.set("token", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
