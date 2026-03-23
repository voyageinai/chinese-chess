import { describe, it, expect } from "vitest";
import {
  generateMoves,
  isLegalMove,
  isInCheck,
  isCheckmate,
  isStalemate,
  applyMove,
} from "../rules";
import { parseFen } from "@/lib/fen";
import { INITIAL_FEN, uciToSquare } from "@/lib/constants";

describe("generateMoves", () => {
  it("generates moves from initial position", () => {
    const state = parseFen(INITIAL_FEN);
    const moves = generateMoves(state);
    // Red has 44 legal moves in starting position
    expect(moves.length).toBe(44);
  });

  it("generates rook moves correctly", () => {
    // Kings on different columns to avoid flying general restricting rook
    const state = parseFen("3k5/9/9/9/9/9/9/4R4/9/4K4 w - - 0 1");
    const moves = generateMoves(state);
    const rookSq = uciToSquare("e2");
    const rookMoves = moves.filter((m) => m.from === rookSq);
    expect(rookMoves.length).toBeGreaterThan(10);
  });

  it("cannon captures require a screen piece", () => {
    // Black king off column e so cannon has no capture target behind the pawn screen
    const state = parseFen("3k5/9/9/9/4p4/9/9/4C4/9/4K4 w - - 0 1");
    const moves = generateMoves(state);
    const cannonSq = uciToSquare("e2");
    const cannonMoves = moves.filter((m) => m.from === cannonSq);
    const captures = cannonMoves.filter((m) => m.capture);
    expect(captures).toHaveLength(0);
  });

  it("cannon captures with screen piece", () => {
    const state = parseFen("4k4/9/9/9/4P4/9/9/4C4/9/4K4 w - - 0 1");
    const moves = generateMoves(state);
    const cannonSq = uciToSquare("e2");
    const cannonMoves = moves.filter((m) => m.from === cannonSq);
    const captures = cannonMoves.filter((m) => m.capture);
    expect(captures.length).toBeGreaterThanOrEqual(1);
  });

  it("king stays within palace", () => {
    // Pawn on e5 blocks flying general so king can move to all 3 palace squares
    const state = parseFen("4k4/9/9/9/4p4/9/9/9/9/4K4 w - - 0 1");
    const moves = generateMoves(state);
    const kingSq = uciToSquare("e0");
    const kingMoves = moves.filter((m) => m.from === kingSq);
    expect(kingMoves.length).toBe(3);
  });

  it("elephant cannot cross river", () => {
    const state = parseFen("4k4/9/9/9/9/9/9/9/9/2E1K1E2 w - - 0 1");
    const moves = generateMoves(state);
    const elephantSq = uciToSquare("c0");
    const eMoves = moves.filter((m) => m.from === elephantSq);
    for (const m of eMoves) {
      expect(Math.floor(m.to / 9)).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("isInCheck", () => {
  it("detects check by rook", () => {
    const state = parseFen("4k4/9/9/9/9/9/9/4r4/9/4K4 w - - 0 1");
    expect(isInCheck(state, "red")).toBe(true);
  });

  it("detects flying general rule", () => {
    const state = parseFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
    expect(isInCheck(state, "red")).toBe(true);
    expect(isInCheck(state, "black")).toBe(true);
  });

  it("no check in initial position", () => {
    const state = parseFen(INITIAL_FEN);
    expect(isInCheck(state, "red")).toBe(false);
  });
});

describe("isCheckmate", () => {
  it("detects simple checkmate", () => {
    // Rook on a9 covers entire rank 0, rook on e8 gives check on column;
    // all king escapes are covered or blocked by flying general
    const state = parseFen("R3k4/4R4/9/9/9/9/9/9/9/4K4 b - - 0 1");
    expect(isCheckmate(state)).toBe(true);
  });

  it("initial position is not checkmate", () => {
    const state = parseFen(INITIAL_FEN);
    expect(isCheckmate(state)).toBe(false);
  });
});

describe("applyMove", () => {
  it("applies a move and switches turn", () => {
    const state = parseFen(INITIAL_FEN);
    const from = uciToSquare("h2");
    const to = uciToSquare("e2");
    const newState = applyMove(state, { from, to });
    expect(newState.board[to]).toEqual({ color: "red", kind: "c" });
    expect(newState.board[from]).toBeNull();
    expect(newState.turn).toBe("black");
  });
});
