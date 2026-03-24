import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getTournamentById } from "@/db/queries";
import { getRunner } from "@/server/tournament";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import { logAudit } from "@/server/audit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();
    if (!isAdmin(user)) return denyForbidden();

    const { id } = await params;
    const tournament = getTournamentById(id);

    if (!tournament) {
      return NextResponse.json(
        { error: "Tournament not found" },
        { status: 404 },
      );
    }

    if (tournament.status !== "running") {
      return NextResponse.json(
        { error: "Only running tournaments can be cancelled" },
        { status: 400 },
      );
    }

    const runner = getRunner(id);
    if (runner) {
      runner.abort();
    }

    logAudit("tournament.cancel", user.id, "tournament", id, {
      name: tournament.name,
    });

    return NextResponse.json({ success: true, message: "Tournament cancellation requested" });
  } catch (error) {
    console.error("Admin cancel tournament error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
