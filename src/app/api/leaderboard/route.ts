import { NextResponse } from "next/server";
import { getLeaderboard } from "@/db/queries";

export async function GET() {
  try {
    const leaderboard = getLeaderboard();
    return NextResponse.json({ leaderboard });
  } catch (error) {
    console.error("Get leaderboard error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
