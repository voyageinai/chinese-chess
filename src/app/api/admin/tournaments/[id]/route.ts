import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getTournamentById, deleteTournament } from "@/db/queries";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import { logAudit } from "@/server/audit";

export async function DELETE(
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

    if (tournament.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending tournaments can be deleted" },
        { status: 400 },
      );
    }

    deleteTournament(id);

    logAudit("tournament.delete", user.id, "tournament", id, {
      name: tournament.name,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin delete tournament error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
