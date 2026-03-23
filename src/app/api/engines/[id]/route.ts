import { NextResponse } from "next/server";
import { rm } from "fs/promises";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { getEngineById, deleteEngine } from "@/db/queries";

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

    return NextResponse.json({ engine });
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
    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      );
    }

    const { id } = await params;
    const engine = getEngineById(id);

    if (!engine) {
      return NextResponse.json(
        { error: "Engine not found" },
        { status: 404 },
      );
    }

    // Only owner or admin can delete
    if (engine.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 },
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete engine error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
