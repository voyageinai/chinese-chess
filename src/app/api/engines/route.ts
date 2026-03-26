import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { mkdir, writeFile, chmod, rm } from "fs/promises";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { createEngine, getEnginesByUser, getVisibleEngines } from "@/db/queries";
import { sanitizeEngine, sanitizeEngines } from "@/server/dto";
import { logAudit } from "@/server/audit";
import { UciEngine } from "@/server/uci";
import { INITIAL_FEN } from "@/lib/constants";
import { parseFen } from "@/lib/fen";
import { isLegalMove } from "@/server/rules";

const MAX_FILE_SIZE = parseInt(process.env.MAX_ENGINE_SIZE || "52428800", 10); // 50MB default

/**
 * Verify engine: UCI handshake + coordinate system compatibility.
 * Spawns the engine, does init (uci/uciok/isready/readyok + variant detection),
 * then plays one probe move from the initial position to validate coordinates.
 * Returns null on success, or a Chinese error message on failure.
 */
async function verifyEngine(enginePath: string): Promise<string | null> {
  const engine = new UciEngine(enginePath);

  try {
    // Phase 1: UCI handshake (init handles uci→uciok, UCI_Variant detection, isready→readyok)
    try {
      await engine.init();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Timeout")) {
        return "引擎未在 10 秒内完成 UCI 握手，请检查引擎是否正确实现了 UCI 协议";
      }
      return `引擎初始化失败: ${msg}`;
    }

    // Phase 2: Coordinate system probe — play one move from initial position
    const probeOptions = { wtime: 10000, btime: 10000, winc: 0, binc: 0 };
    const posCmd = `position fen ${INITIAL_FEN}`;

    let goResult;
    try {
      goResult = await engine.go(posCmd, probeOptions);
    } catch {
      return "引擎未能在初始局面返回着法，请检查引擎是否支持标准 UCI go 命令";
    }

    const uciMove = goResult.bestmove;
    if (!uciMove || !/^[a-i]\d{1,2}[a-i]\d{1,2}$/.test(uciMove)) {
      return `引擎返回无效着法格式: ${uciMove}，期望格式如 h2e2 或 h3e3`;
    }

    // Parse move through engine's coordinate system and validate
    const { from, to } = engine.uciMoveToSquares(uciMove);
    const gameState = parseFen(INITIAL_FEN);

    // Layered diagnostics
    const piece = gameState.board[from];
    if (!piece) {
      return `坐标系不兼容: 引擎着法 ${uciMove} 对应的起始格为空。` +
        `本平台支持 Pikafish 坐标（rank 0 = 红方底线）和 Fairy-Stockfish 坐标（rank 1 = 红方底线）`;
    }
    if (piece.color !== "red") {
      return `坐标系不兼容: 引擎着法 ${uciMove} 试图移动黑方棋子（应为红方走子）。` +
        `可能引擎的 rank 编号与本平台约定相反。` +
        `本平台支持 Pikafish 坐标（rank 0 = 红方底线）和 Fairy-Stockfish 坐标（rank 1 = 红方底线）`;
    }
    if (!isLegalMove(gameState, from, to)) {
      return `引擎在初始局面返回非法着法: ${uciMove}，请检查引擎走子逻辑是否正确`;
    }

    return null; // All checks passed
  } finally {
    engine.quit();
  }
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
