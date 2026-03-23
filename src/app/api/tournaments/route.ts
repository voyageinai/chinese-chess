import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getTournaments, createTournament } from "@/db/queries";

export async function GET() {
  try {
    const tournaments = getTournaments();
    return NextResponse.json({ tournaments });
  } catch (error) {
    console.error("Get tournaments error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      );
    }

    const { name, timeBase, timeInc, rounds } = await request.json();

    if (!name || timeBase == null || timeInc == null) {
      return NextResponse.json(
        { error: "Missing required fields: name, timeBase, timeInc" },
        { status: 400 },
      );
    }

    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Tournament name must be a non-empty string" },
        { status: 400 },
      );
    }

    if (typeof timeBase !== "number" || !Number.isFinite(timeBase) || timeBase <= 0) {
      return NextResponse.json(
        { error: "timeBase must be a positive number" },
        { status: 400 },
      );
    }

    if (typeof timeInc !== "number" || !Number.isFinite(timeInc) || timeInc < 0) {
      return NextResponse.json(
        { error: "timeInc must be a non-negative number" },
        { status: 400 },
      );
    }

    if (
      rounds != null &&
      (typeof rounds !== "number" || !Number.isFinite(rounds) || rounds <= 0)
    ) {
      return NextResponse.json(
        { error: "rounds must be a positive number" },
        { status: 400 },
      );
    }

    const tournament = createTournament(
      user.id,
      name.trim(),
      timeBase,
      timeInc,
      rounds ?? 1,
    );

    return NextResponse.json({ tournament }, { status: 201 });
  } catch (error) {
    console.error("Create tournament error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
