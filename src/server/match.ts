import { UciEngine, type GoOptions } from "./uci";
import { parseFen, serializeFen } from "@/lib/fen";
import {
  generateMoves,
  applyMove,
  isCheckmate,
  isStalemate,
  isInCheck,
  isLegalMove,
} from "./rules";
import { INITIAL_FEN, uciToSquare, squareToUci } from "@/lib/constants";
import { updateGameMoves } from "@/db/queries";
import type { Color, StoredMove, GameState, Move } from "@/lib/types";
import { EventEmitter } from "events";

export interface MatchConfig {
  redEnginePath: string;
  blackEnginePath: string;
  timeBase: number; // ms
  timeInc: number; // ms
  gameId: string;
}

export interface MatchResult {
  result: "red" | "black" | "draw";
  reason: string;
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
    let gameState = parseFen(INITIAL_FEN);

    // Position repetition tracking (key = FEN board+turn portions)
    const positionCounts = new Map<string, number>();
    // Consecutive check tracking for perpetual check rule
    const consecutiveChecks = { red: 0, black: 0 };

    const positionKey = (state: GameState): string => {
      const fen = serializeFen(state);
      // Use board layout + turn (first two FEN fields) as the key
      const parts = fen.split(" ");
      return parts[0] + " " + parts[1];
    };

    // Record initial position
    const initKey = positionKey(gameState);
    positionCounts.set(initKey, 1);

    try {
      // 1. Init both engines
      this.redEngine = new UciEngine(redEnginePath);
      this.blackEngine = new UciEngine(blackEnginePath);

      try {
        await this.redEngine.init();
      } catch {
        return {
          result: "black",
          reason: "Red engine failed to initialize",
          moves: storedMoves,
          redTimeLeft: redTime,
          blackTimeLeft: blackTime,
        };
      }

      try {
        await this.blackEngine.init();
      } catch {
        return {
          result: "red",
          reason: "Black engine failed to initialize",
          moves: storedMoves,
          redTimeLeft: redTime,
          blackTimeLeft: blackTime,
        };
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
          return this.buildResult(
            currentTurn === "red" ? "black" : "red",
            `${currentTurn} engine crashed`,
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
        };

        const moveStart = Date.now();

        let goResult;
        try {
          goResult = await engine.go(posCmd, goOptions);
        } catch {
          // Engine timed out or errored on go command
          return this.buildResult(
            currentTurn === "red" ? "black" : "red",
            `${currentTurn} engine failed to respond`,
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
          return this.buildResult(
            "black",
            "Red lost on time",
            storedMoves,
            0,
            blackTime,
          );
        }
        if (currentTurn === "black" && blackTime <= 0) {
          return this.buildResult(
            "red",
            "Black lost on time",
            storedMoves,
            redTime,
            0,
          );
        }

        // Add increment after the move
        if (currentTurn === "red") {
          redTime += timeInc;
        } else {
          blackTime += timeInc;
        }

        const uciMove = goResult.bestmove;

        // Validate move format (4 chars for 0-based "h2e2", 4-6 for 1-based "h3e3" or "a10b10")
        if (!uciMove || uciMove.length < 4 || !/^[a-i]\d{1,2}[a-i]\d{1,2}$/.test(uciMove)) {
          return this.buildResult(
            currentTurn === "red" ? "black" : "red",
            `${currentTurn} engine returned invalid move: ${uciMove}`,
            storedMoves,
            redTime,
            blackTime,
          );
        }

        // Parse the UCI move using the engine's coordinate system
        const { from: fromSq, to: toSq } = engine.uciMoveToSquares(uciMove);

        // Validate move legality
        if (!isLegalMove(gameState, fromSq, toSq)) {
          return this.buildResult(
            currentTurn === "red" ? "black" : "red",
            `${currentTurn} engine made illegal move: ${uciMove}`,
            storedMoves,
            redTime,
            blackTime,
          );
        }

        // Build the Move object for applyMove
        const legalMoves = generateMoves(gameState);
        const moveObj = legalMoves.find(
          (m) => m.from === fromSq && m.to === toSq,
        )!;

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
        };
        storedMoves.push(storedMove);

        // Persist moves incrementally so new viewers see current state
        updateGameMoves(gameId, JSON.stringify(storedMoves), redTime, blackTime);

        // Emit move event for WebSocket
        // movedAt lets the client compensate for network delay
        this.emit("move", {
          gameId,
          move: canonicalMove,
          fen: newFen,
          eval: evalScore,
          redTime,
          blackTime,
          timeMs: elapsed,
          ply: storedMoves.length,
          movedAt: Date.now(),
        });

        // --- Check termination conditions ---

        // Checkmate: the side to move (after applyMove) is checkmated
        if (isCheckmate(gameState)) {
          // currentTurn made the move that checkmated the opponent
          return this.buildResult(
            currentTurn,
            "Checkmate",
            storedMoves,
            redTime,
            blackTime,
          );
        }

        // Stalemate: the side to move has no legal moves but is not in check
        if (isStalemate(gameState)) {
          return this.buildResult(
            "draw",
            "Stalemate",
            storedMoves,
            redTime,
            blackTime,
          );
        }

        // Perpetual check detection:
        // Track consecutive checks by the side that just moved
        const opponentColor = gameState.turn; // side to move next
        if (isInCheck(gameState, opponentColor)) {
          consecutiveChecks[currentTurn]++;
        } else {
          consecutiveChecks[currentTurn] = 0;
        }

        // 3 consecutive checks = perpetual check, the checking side loses
        if (consecutiveChecks[currentTurn] >= 3) {
          return this.buildResult(
            currentTurn === "red" ? "black" : "red",
            `${currentTurn} lost by perpetual check`,
            storedMoves,
            redTime,
            blackTime,
          );
        }

        // Threefold repetition
        const key = positionKey(gameState);
        const count = (positionCounts.get(key) ?? 0) + 1;
        positionCounts.set(key, count);
        if (count >= 3) {
          return this.buildResult(
            "draw",
            "Threefold repetition",
            storedMoves,
            redTime,
            blackTime,
          );
        }

        // 120 halfmove draw rule (no captures for 120 half-moves)
        if (gameState.halfmoveClock >= 120) {
          return this.buildResult(
            "draw",
            "120-move rule",
            storedMoves,
            redTime,
            blackTime,
          );
        }
      }

      // If aborted
      return this.buildResult(
        "draw",
        "Game aborted",
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

  private buildResult(
    result: "red" | "black" | "draw",
    reason: string,
    moves: StoredMove[],
    redTimeLeft: number,
    blackTimeLeft: number,
  ): MatchResult {
    return { result, reason, moves, redTimeLeft, blackTimeLeft };
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
