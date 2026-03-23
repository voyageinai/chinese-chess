import { NextResponse } from "next/server";
import { verifyPassword, signToken } from "@/server/auth";
import { getUserByUsername } from "@/db/queries";

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Missing required fields: username, password" },
        { status: 400 },
      );
    }

    const userRow = getUserByUsername(username);
    if (!userRow) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 },
      );
    }

    const valid = await verifyPassword(password, userRow.password);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 },
      );
    }

    const token = signToken({ userId: userRow.id, role: userRow.role });

    const { password: _, ...user } = userRow;
    const response = NextResponse.json({ user: { id: user.id, username: user.username, role: user.role } });
    response.cookies.set("token", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
