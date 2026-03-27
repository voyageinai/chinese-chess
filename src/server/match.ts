import { UciEngine, type GoOptions } from "./uci";
import { parseFen, serializeFen } from "@/lib/fen";
import {
  generateMoves,
  applyMove,
  classifyBoardTerminal,
  isInCheck,
  isLegalMove,
} from "./rules";
import {
  adjudicateRepetition,
  buildForfeitVerdict,
  buildStaticVerdict,
  classifyChase,
  judgeNaturalMoveLimit,
  positionKey,
  type JudgeVerdict,
  type PlyMeta,
} from "./judge";
import { formatResultReason, stringifyResultDetail } from "@/lib/results";
import { ENGINE_MAX_NODES, INITIAL_FEN, squareToUci } from "@/lib/constants";
import { updateGameMoves } from "@/db/queries";
import type { StoredMove, ResultCode } from "@/lib/types";
import { EventEmitter } from "events";
export { adjudicateRepetition, type JudgeVerdict, type PlyMeta } from "./judge";

export interface MatchConfig {
  redEnginePath: string;
  blackEnginePath: string;
  timeBase: number; // ms
  timeInc: number; // ms
  gameId: string;
  startFen?: string;
  skipDbWrites?: boolean; // Worker mode: don't write to DB directly
}

export interface MatchResult {
  result: "red" | "black" | "draw";
  code: ResultCode;
  reason: string;
  detail: string | null;
  moves: StoredMove[];
  redTimeLeft: number;
  blackTimeLeft: number;
}

export class Match extends EventEmitter {
  private config: MatchConfig;
  private redEngine: UciEngine | null = null;
  private blackEngine: UciEngine | null = null;
  private aborted = false;

  constructor(config: MatchConfig) {
    super();
    this.config = config;
  }

  async run(): Promise<MatchResult> {
    const { gameId, redEnginePath, blackEnginePath, timeBase, timeInc } =
      this.config;

    let redTime = timeBase;
    let blackTime = timeBase;
    const storedMoves: StoredMove[] = [];
    let gameState = parseFen(this.config.startFen || INITIAL_FEN);

    // Unified repetition tracking
    const plyHistory: PlyMeta[] = [];
    const occurrencesByKey = new Map<string, number[]>();

    // Record initial position as ply 0
    const initKey = positionKey(gameState);
    occurrencesByKey.set(initKey, [0]);

    try {
      // 1. Init both engines
      this.redEngine = new UciEngine(redEnginePath);
      this.blackEngine = new UciEngine(blackEnginePath);

      try {
        await this.redEngine.init();
      } catch {
        return this.buildResultFromVerdict(
          buildForfeitVerdict("red", "engine_init_failed"),
          storedMoves,
          redTime,
          blackTime,
        );
      }

      try {
        await this.blackEngine.init();
      } catch {
        return this.buildResultFromVerdict(
          buildForfeitVerdict("black", "engine_init_failed"),
          storedMoves,
          redTime,
          blackTime,
        );
      }

      // Listen for engine crashes
      let redCrashed = false;
      let blackCrashed = false;
      this.redEngine.on("exit", () => {
        redCrashed = true;
      });
      this.blackEngine.on("exit", () => {
        blackCrashed = true;
      });
      this.redEngine.on("error", () => {
        redCrashed = true;
      });
      this.blackEngine.on("error", () => {
        blackCrashed = true;
      });

      // Forward engine thinking events for live PV display
      this.redEngine.on("thinking", (info) => {
        this.emit("engine_thinking", {
          gameId,
          side: "red" as const,
          ...info,
        });
      });
      this.blackEngine.on("thinking", (info) => {
        this.emit("engine_thinking", {
          gameId,
          side: "black" as const,
          ...info,
        });
      });

      // 2. Game loop
      while (!this.aborted) {
        const currentTurn = gameState.turn;
        const engine =
          currentTurn === "red" ? this.redEngine : this.blackEngine;

        // Check for engine crash before asking for a move
        if (
          (currentTurn === "red" && redCrashed) ||
          (currentTurn === "black" && blackCrashed)
        ) {
          return this.buildResultFromVerdict(
            buildForfeitVerdict(currentTurn, "engine_crash"),
            storedMoves,
            redTime,
            blackTime,
          );
        }

        // Build position command using current FEN (avoids coordinate system
        // mismatches between engines that use different rank numbering)
        const currentFen = serializeFen(gameState);
        const posCmd = `position fen ${currentFen}`;

        // Build go options: in Chinese chess UCI, red = white (wtime/winc)
        const goOptions: GoOptions = {
          wtime: redTime,
          btime: blackTime,
          winc: timeInc,
          binc: timeInc,
          maxNodes: ENGINE_MAX_NODES,
        };

        const moveStart = Date.now();

        let goResult;
        try {
          goResult = await engine.go(posCmd, goOptions);
        } catch {
          // Engine timed out or errored on go command
          return this.buildResultFromVerdict(
            buildForfeitVerdict(currentTurn, "engine_no_response"),
            storedMoves,
            redTime,
            blackTime,
          );
        }

        const elapsed = Date.now() - moveStart;

        // Subtract elapsed time
        if (currentTurn === "red") {
          redTime -= elapsed;
        } else {
          blackTime -= elapsed;
        }

        // Check for timeout (flag fall)
        if (currentTurn === "red" && redTime <= 0) {
          return this.buildResultFromVerdict(
            buildForfeitVerdict("red", "time_forfeit"),
            storedMoves,
            0,
            blackTime,
          );
        }
        if (currentTurn === "black" && blackTime <= 0) {
          return this.buildResultFromVerdict(
            buildForfeitVerdict("black", "time_forfeit"),
            storedMoves,
            redTime,
            0,
          );
        }

        const uciMove = goResult.bestmove;

        // Validate move format (4 chars for 0-based "h2e2", 4-6 for 1-based "h3e3" or "a10b10")
        if (
          !uciMove ||
          uciMove.length < 4 ||
          !/^[a-i]\d{1,2}[a-i]\d{1,2}$/.test(uciMove)
        ) {
          return this.buildResultFromVerdict(
            buildForfeitVerdict(currentTurn, "invalid_move", { move: uciMove ?? null }),
            storedMoves,
            redTime,
            blackTime,
          );
        }

        // Parse the UCI move using the engine's coordinate system
        const { from: fromSq, to: toSq } = engine.uciMoveToSquares(uciMove);

        // Validate move legality
        if (!isLegalMove(gameState, fromSq, toSq)) {
          return this.buildResultFromVerdict(
            buildForfeitVerdict(currentTurn, "illegal_move", { move: uciMove }),
            storedMoves,
            redTime,
            blackTime,
          );
        }

        // Add increment after move validation (not before, to avoid inflating time on illegal moves)
        if (currentTurn === "red") {
          redTime += timeInc;
        } else {
          blackTime += timeInc;
        }

        // Build the Move object for applyMove
        const legalMoves = generateMoves(gameState);
        const moveObj = legalMoves.find(
          (m) => m.from === fromSq && m.to === toSq,
        )!;
        const movingPiece = gameState.board[fromSq]!;

        // Apply the move
        gameState = applyMove(gameState, moveObj);
        const newFen = serializeFen(gameState);

        // Eval from engine is from ITS perspective; flip sign for black
        // (we always store from red's perspective)
        let evalScore: number | null = goResult.eval;
        if (evalScore !== null && currentTurn === "black") {
          evalScore = -evalScore;
        }

        // Normalize move to 0-based UCI format (a0-i9) for storage and frontend
        const canonicalMove = squareToUci(fromSq) + squareToUci(toSq);

        // Record the stored move
        const storedMove: StoredMove = {
          move: canonicalMove,
          fen: newFen,
          time_ms: elapsed,
          eval: evalScore,
          depth: goResult.depth,
        };
        storedMoves.push(storedMove);

        // Persist moves incrementally so new viewers see current state
        if (!this.config.skipDbWrites) {
          updateGameMoves(gameId, JSON.stringify(storedMoves), redTime, blackTime);
        }

        // Emit move event for WebSocket
        // movedAt lets the client compensate for network delay
        this.emit("move", {
          gameId,
          move: canonicalMove,
          fen: newFen,
          eval: evalScore,
          depth: goResult.depth,
          nodes: goResult.nodes,
          pv: goResult.pv,
          redTime,
          blackTime,
          timeMs: elapsed,
          ply: storedMoves.length,
          movedAt: Date.now(),
        });

        // --- Board-level termination (eat-king / checkmate / stalemate) ---
        const boardTerminal = classifyBoardTerminal(gameState, currentTurn);
        if (boardTerminal) {
          return this.buildResult(
            boardTerminal.winner,
            boardTerminal.kind,
            boardTerminal.kind === "king_capture"
              ? { side: boardTerminal.loser }
              : null,
            storedMoves,
            redTime,
            blackTime,
          );
        }

        // --- Unified repetition adjudicator ---
        const key = positionKey(gameState);
        const opponentColor = gameState.turn; // side to move next
        const gaveCheck = isInCheck(gameState, opponentColor);
        const chaseKind = classifyChase(gameState, currentTurn, moveObj);

        const plyIndex = storedMoves.length; // 1-based ply (ply 0 = initial position)
        plyHistory.push({
          key,
          mover: currentTurn,
          move: canonicalMove,
          movingPieceKind: movingPiece.kind,
          gaveCheck,
          chaseKind,
        });

        if (!occurrencesByKey.has(key)) {
          occurrencesByKey.set(key, []);
        }
        const occurrences = occurrencesByKey.get(key)!;
        occurrences.push(plyIndex);

        const verdict = adjudicateRepetition(occurrences, plyHistory);
        if (verdict) {
          return this.buildResultFromVerdict(
            verdict,
            storedMoves,
            redTime,
            blackTime,
          );
        }

        const naturalMoveVerdict = judgeNaturalMoveLimit(gameState);
        if (naturalMoveVerdict) {
          return this.buildResultFromVerdict(
            naturalMoveVerdict,
            storedMoves,
            redTime,
            blackTime,
          );
        }
      }

      // If aborted
      return this.buildResultFromVerdict(
        buildStaticVerdict("draw", "game_aborted"),
        storedMoves,
        redTime,
        blackTime,
      );
    } finally {
      this.cleanup();
    }
  }

  abort(): void {
    this.aborted = true;
  }

  private buildResultFromVerdict(
    verdict: JudgeVerdict,
    moves: StoredMove[],
    redTimeLeft: number,
    blackTimeLeft: number,
  ): MatchResult {
    return {
      result: verdict.result,
      code: verdict.code,
      reason: verdict.reason,
      detail: verdict.detail,
      moves,
      redTimeLeft,
      blackTimeLeft,
    };
  }

  private buildResult(
    result: "red" | "black" | "draw",
    code: ResultCode,
    detail: Record<string, string | number | boolean | null> | null,
    moves: StoredMove[],
    redTimeLeft: number,
    blackTimeLeft: number,
  ): MatchResult {
    return {
      result,
      code,
      reason: formatResultReason(code, detail ?? undefined),
      detail: stringifyResultDetail(detail),
      moves,
      redTimeLeft,
      blackTimeLeft,
    };
  }

  private cleanup(): void {
    if (this.redEngine) {
      this.redEngine.quit();
      this.redEngine = null;
    }
    if (this.blackEngine) {
      this.blackEngine.quit();
      this.blackEngine = null;
    }
  }
}
