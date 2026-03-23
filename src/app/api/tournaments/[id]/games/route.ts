import { NextResponse } from "next/server";
import { getTournamentById, getGamesByTournament } from "@/db/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const tournament = getTournamentById(id);

    if (!tournament) {
      return NextResponse.json(
        { error: "Tournament not found" },
        { status: 404 },
      );
    }

    const games = getGamesByTournament(id);
    return NextResponse.json({ games });
  } catch (error) {
    console.error("Get tournament games error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
