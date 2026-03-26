import { UciEngine } from "@/server/uci";
import { INITIAL_FEN } from "@/lib/constants";
import { parseFen } from "@/lib/fen";
import { isLegalMove } from "@/server/rules";

/**
 * Verify engine: UCI handshake + coordinate system compatibility.
 * Spawns the engine, does init (uci/uciok/isready/readyok + variant detection),
 * then plays one probe move from the initial position to validate coordinates.
 * Returns null on success, or a Chinese error message on failure.
 */
export async function verifyEngine(enginePath: string): Promise<string | null> {
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
