import { NextRequest, NextResponse } from "next/server";
import { searchGames } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const engineId = searchParams.get("engineId") || undefined;
    const result = searchParams.get("result") as "red" | "black" | "draw" | undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
    const offset = (page - 1) * limit;

    const { games, total } = searchGames({ engineId, result: result || undefined, limit, offset });

    // Strip moves JSON from list view (too large)
    const lightweight = games.map(({ moves, ...rest }) => {
      void moves;
      return rest;
    });

    return NextResponse.json({
      games: lightweight,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Search games error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
