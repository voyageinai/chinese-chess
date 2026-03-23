import { describe, it, expect } from "vitest";
import { parseFen, serializeFen } from "../fen";
import { INITIAL_FEN, BOARD_SIZE } from "../constants";

describe("parseFen", () => {
  it("parses initial position", () => {
    const state = parseFen(INITIAL_FEN);
    expect(state.board).toHaveLength(BOARD_SIZE);
    expect(state.turn).toBe("red");
    expect(state.halfmoveClock).toBe(0);
    expect(state.fullmoveNumber).toBe(1);
  });

  it("places pieces correctly in initial position", () => {
    const state = parseFen(INITIAL_FEN);
    // row 0 (top): r h e a k a e h r (black)
    expect(state.board[0]).toEqual({ color: "black", kind: "r" });
    expect(state.board[4]).toEqual({ color: "black", kind: "k" });
    // row 9 (bottom): R H E A K A E H R (red)
    expect(state.board[81]).toEqual({ color: "red", kind: "r" });
    expect(state.board[85]).toEqual({ color: "red", kind: "k" });
    // row 2: cannons at col 1 and col 7
    expect(state.board[2 * 9 + 1]).toEqual({ color: "black", kind: "c" });
    expect(state.board[2 * 9 + 7]).toEqual({ color: "black", kind: "c" });
  });

  it("parses black-to-move FEN", () => {
    const fen = "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR b - - 1 1";
    const state = parseFen(fen);
    expect(state.turn).toBe("black");
    expect(state.halfmoveClock).toBe(1);
  });
});

describe("serializeFen", () => {
  it("roundtrips initial position", () => {
    const state = parseFen(INITIAL_FEN);
    expect(serializeFen(state)).toBe(INITIAL_FEN);
  });

  it("roundtrips a mid-game position", () => {
    const fen = "r1eakae1r/9/1c2h2c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2H2C1/9/R1EAKAE1R w - - 4 3";
    const state = parseFen(fen);
    expect(serializeFen(state)).toBe(fen);
  });
});
