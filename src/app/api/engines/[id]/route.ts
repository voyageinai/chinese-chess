import { NextResponse } from "next/server";
import { rm } from "fs/promises";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { getEngineById, deleteEngine, isEngineReferenced } from "@/db/queries";
import { sanitizeEngine } from "@/server/dto";
import { denyUnauth, denyForbidden, canManageEngine } from "@/server/permissions";
import { logAudit } from "@/server/audit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const engine = getEngineById(id);

    if (!engine) {
      return NextResponse.json(
        { error: "Engine not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ engine: sanitizeEngine(engine) });
  } catch (error) {
    console.error("Get engine error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return denyUnauth();

    const { id } = await params;
    const engine = getEngineById(id);

    if (!engine) {
      return NextResponse.json(
        { error: "Engine not found" },
        { status: 404 },
      );
    }

    if (!canManageEngine(user, engine)) return denyForbidden();

    if (isEngineReferenced(id)) {
      return NextResponse.json(
        { error: "Engine is already used by tournaments or games and cannot be deleted" },
        { status: 409 },
      );
    }

    // Remove binary files
    try {
      const engineDir = path.dirname(engine.binary_path);
      await rm(engineDir, { recursive: true, force: true });
    } catch {
      // Directory may already be gone; continue with DB cleanup
    }

    // Remove DB record
    deleteEngine(id);

    logAudit("engine.delete", user.id, "engine", id, {
      name: engine.name,
      admin_action: engine.user_id !== user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete engine error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
