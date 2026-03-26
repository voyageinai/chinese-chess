import { NextRequest, NextResponse } from "next/server";
import { searchGames } from "@/db/queries";
import { RESULT_CODE_LABELS_ZH } from "@/lib/results";
import type { EngineOutcome } from "@/lib/results";
import type { ResultCode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const engineId = searchParams.get("engineId") || undefined;
    const rawResult = searchParams.get("result");
    const rawOutcome = searchParams.get("outcome");
    const rawResultCode = searchParams.get("resultCode");
    const result =
      rawResult === "red" || rawResult === "black" || rawResult === "draw"
        ? rawResult
        : undefined;
    const outcome =
      rawOutcome === "win" || rawOutcome === "loss" || rawOutcome === "draw"
        ? (rawOutcome as EngineOutcome)
        : undefined;
    const resultCode =
      rawResultCode && rawResultCode in RESULT_CODE_LABELS_ZH
        ? (rawResultCode as ResultCode)
        : undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
    const offset = (page - 1) * limit;

    if (rawResult && !result) {
      return NextResponse.json({ error: "Invalid result filter" }, { status: 400 });
    }
    if (rawOutcome && !outcome) {
      return NextResponse.json({ error: "Invalid outcome filter" }, { status: 400 });
    }
    if (rawResultCode && !resultCode) {
      return NextResponse.json({ error: "Invalid resultCode filter" }, { status: 400 });
    }
    if (outcome && !engineId) {
      return NextResponse.json(
        { error: "Outcome filter requires engineId" },
        { status: 400 },
      );
    }

    const { games, total } = searchGames({
      engineId,
      result,
      outcome,
      resultCode,
      limit,
      offset,
    });

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
