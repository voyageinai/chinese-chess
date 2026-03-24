import { NextResponse } from "next/server";
import { getLeaderboardWithDelta } from "@/db/queries";
import { sanitizeEngines } from "@/server/dto";

export async function GET() {
  try {
    const leaderboard = getLeaderboardWithDelta();
    // sanitizeEngines strips binary_path; the `owner` and `elo_delta` extra fields are preserved via spread
    const safe = sanitizeEngines(leaderboard as Parameters<typeof sanitizeEngines>[0]).map(
      (e, i) => ({ ...e, owner: leaderboard[i].owner, elo_delta: leaderboard[i].elo_delta }),
    );
    return NextResponse.json({ leaderboard: safe });
  } catch (error) {
    console.error("Get leaderboard error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
