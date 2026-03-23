import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { mkdir, writeFile, chmod, rm } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { getCurrentUser } from "@/lib/auth";
import { createEngine, getEnginesByUser, getVisibleEngines } from "@/db/queries";

const MAX_FILE_SIZE = parseInt(process.env.MAX_ENGINE_SIZE || "52428800", 10); // 50MB default
const SCRIPT_EXTENSIONS = [".py", ".js"];

/**
 * Verify that an engine can start and complete UCI handshake within timeout.
 * Returns null on success, or an error message on failure.
 */
async function verifyUciHandshake(enginePath: string, timeoutMs = 10000): Promise<string | null> {
  const ext = path.extname(enginePath).toLowerCase();
  let cmd: string;
  let args: string[];
  if (ext === ".py") { cmd = "python3"; args = [enginePath]; }
  else if (ext === ".js") { cmd = "node"; args = [enginePath]; }
  else { cmd = enginePath; args = []; }

  return new Promise((resolve) => {
    let resolved = false;
    const done = (result: string | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { proc.kill(); } catch {}
      resolve(result);
    };

    const proc = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.dirname(enginePath),
    });

    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString().slice(0, 500); });

    const timer = setTimeout(() => {
      done("引擎未在 10 秒内响应 uciok，请检查引擎是否正确实现了 UCI 协议");
    }, timeoutMs);

    proc.on("error", (err) => {
      done(`引擎启动失败: ${err.message}`);
    });

    proc.on("exit", (code) => {
      if (!resolved) {
        done(`引擎异常退出 (exit code ${code})${stderr ? ": " + stderr.trim() : ""}`);
      }
    });

    let buffer = "";
    proc.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      if (buffer.includes("uciok")) {
        done(null);
      }
    });

    proc.stdin?.write("uci\n");
  });
}

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
    const engines =
      scope === "owned" ? getEnginesByUser(user.id) : getVisibleEngines();
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

    const ext = path.extname(filename).toLowerCase();
    if (!SCRIPT_EXTENSIONS.includes(ext)) {
      // Binary files need executable permission
      await chmod(binaryPath, 0o755);
    }

    // Verify engine can complete UCI handshake before registering
    const verifyError = await verifyUciHandshake(binaryPath);
    if (verifyError) {
      // Clean up uploaded files on failure
      await rm(engineDir, { recursive: true, force: true });
      return NextResponse.json(
        { error: verifyError },
        { status: 422 },
      );
    }

    const engine = createEngine(user.id, name.trim(), binaryPath, "public");

    return NextResponse.json({ engine }, { status: 201 });
  } catch (error) {
    console.error("Upload engine error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
