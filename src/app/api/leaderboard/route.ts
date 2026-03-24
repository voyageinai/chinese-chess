import { NextResponse } from "next/server";
import { getLeaderboard } from "@/db/queries";
import { sanitizeEngines } from "@/server/dto";

export async function GET() {
  try {
    const leaderboard = getLeaderboard();
    // sanitizeEngines strips binary_path; the `owner` extra field is preserved via spread
    const safe = sanitizeEngines(leaderboard as Parameters<typeof sanitizeEngines>[0]).map(
      (e, i) => ({ ...e, owner: leaderboard[i].owner }),
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
