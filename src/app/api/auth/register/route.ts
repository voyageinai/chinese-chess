import { NextResponse } from "next/server";
import { hashPassword, signToken, validateInviteCode } from "@/server/auth";
import { createUser, getUserByUsername } from "@/db/queries";

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

    if (!validateInviteCode(inviteCode)) {
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
