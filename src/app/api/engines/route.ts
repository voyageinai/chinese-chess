import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { mkdir, writeFile, chmod } from "fs/promises";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { createEngine, getEnginesByUser } from "@/db/queries";

const MAX_FILE_SIZE = parseInt(process.env.MAX_ENGINE_SIZE || "52428800", 10); // 50MB default

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      );
    }

    const engines = getEnginesByUser(user.id);
    return NextResponse.json({ engines });
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

    const engineId = nanoid();
    const filename = file.name || "engine";
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
    await chmod(binaryPath, 0o755);

    const engine = createEngine(user.id, name.trim(), binaryPath);

    return NextResponse.json({ engine }, { status: 201 });
  } catch (error) {
    console.error("Upload engine error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
