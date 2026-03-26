import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { mkdir, writeFile, chmod, rm } from "fs/promises";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { createEngine, getEnginesByUser, getVisibleEngines } from "@/db/queries";
import { sanitizeEngine, sanitizeEngines } from "@/server/dto";
import { logAudit } from "@/server/audit";
import { verifyEngine } from "@/server/engine-validation";

const MAX_FILE_SIZE = parseInt(process.env.MAX_ENGINE_SIZE || "52428800", 10); // 50MB default

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      );
    }

    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    const status = url.searchParams.get("status");

    if (status !== null && status !== "active" && status !== "disabled") {
      return NextResponse.json(
        { error: "Invalid status. Must be 'active' or 'disabled'" },
        { status: 400 },
      );
    }

    const engines =
      scope === "owned"
        ? getEnginesByUser(user.id, status ?? undefined)
        : getVisibleEngines();
    return NextResponse.json({ engines: sanitizeEngines(engines) });
  } catch (error) {
    console.error("Get engines error:", error);
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

    const formData = await request.formData();
    const name = formData.get("name") as string;
    const file = formData.get("file") as File;

    if (!name || !file) {
      return NextResponse.json(
        { error: "Missing required fields: name, file" },
        { status: 400 },
      );
    }

    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Engine name must be a non-empty string" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE} bytes` },
        { status: 413 },
      );
    }

    const filename = file.name || "engine";

    const engineId = nanoid();
    const engineDir = path.join(
      process.cwd(),
      "data",
      "engines",
      user.id,
      engineId,
    );

    await mkdir(engineDir, { recursive: true });

    const binaryPath = path.join(engineDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(binaryPath, buffer);
    // Ensure the file is executable (needed for native binaries;
    // harmless for .py/.js which are spawned via interpreter)
    await chmod(binaryPath, 0o755);

    // Verify engine: UCI handshake + coordinate system compatibility
    const verifyError = await verifyEngine(binaryPath);
    if (verifyError) {
      // Clean up uploaded files on failure
      await rm(engineDir, { recursive: true, force: true });
      return NextResponse.json(
        { error: verifyError },
        { status: 422 },
      );
    }

    const engine = createEngine(user.id, name.trim(), binaryPath, "public");

    logAudit("engine.upload", user.id, "engine", engine.id, {
      name: name.trim(),
      file_size: file.size,
    });

    return NextResponse.json({ engine: sanitizeEngine(engine) }, { status: 201 });
  } catch (error) {
    console.error("Upload engine error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
