import { NextResponse } from "next/server";
import { getGameById, getEngineById } from "@/db/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const game = getGameById(id);

    if (!game) {
      return NextResponse.json(
        { error: "Game not found" },
        { status: 404 },
      );
    }

    const redEngine = getEngineById(game.red_engine_id);
    const blackEngine = getEngineById(game.black_engine_id);

    return NextResponse.json({
      game,
      redEngine: redEngine ?? null,
      blackEngine: blackEngine ?? null,
    });
  } catch (error) {
    console.error("Get game error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
