import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEngineById, updateEngineStatus } from "@/db/queries";
import { denyUnauth, denyForbidden, isAdmin } from "@/server/permissions";
import { logAudit } from "@/server/audit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();
    if (!isAdmin(user)) return denyForbidden();

    const { id } = await params;
    const engine = getEngineById(id);

    if (!engine) {
      return NextResponse.json(
        { error: "Engine not found" },
        { status: 404 },
      );
    }

    const body = await request.json();

    if (body.status !== "active" && body.status !== "disabled") {
      return NextResponse.json(
        { error: "Invalid status. Must be 'active' or 'disabled'" },
        { status: 400 },
      );
    }

    if (body.status === engine.status) {
      return NextResponse.json(
        { error: "Engine already has this status" },
        { status: 400 },
      );
    }

    updateEngineStatus(id, body.status);

    const action = body.status === "disabled" ? "engine.disable" : "engine.enable";
    logAudit(action, user.id, "engine", id, {
      name: engine.name,
      reason: body.reason || "",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin update engine error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
