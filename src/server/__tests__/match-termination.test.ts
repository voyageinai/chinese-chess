import { describe, it, expect } from "vitest";
import {
  adjudicateRepetition,
  type PlyMeta,
} from "../match";
import { judgeNaturalMoveLimit } from "../judge";
import { parseFen } from "@/lib/fen";

function meta(
  mover: "red" | "black",
  key: string,
  gaveCheck: boolean,
  chaseKind: "none" | "standard" | "exempt" = "none",
): PlyMeta {
  return {
    key,
    mover,
    move: "a0a1",
    movingPieceKind: mover === "red" ? "r" : "c",
    gaveCheck,
    chaseKind,
  };
}

describe("adjudicateRepetition", () => {
  it("returns null when position has occurred fewer than 3 times", () => {
    const plyHistory: PlyMeta[] = [
      meta("red", "pos1 w", true),
      meta("black", "pos2 b", false),
    ];
    expect(adjudicateRepetition([0, 2], plyHistory)).toBeNull();
  });

  it("returns repetition draw when neither side forces check or chase", () => {
    const plyHistory: PlyMeta[] = [
      meta("red", "pos1 w", false),
      meta("black", "pos2 b", false),
      meta("red", "pos3 w", false),
      meta("black", "pos1 b", false),
      meta("red", "pos4 w", false),
      meta("black", "pos5 b", false),
      meta("red", "pos6 w", false),
      meta("black", "pos1 b", false),
    ];
    const occurrences = [0, 4, 8];

    const result = adjudicateRepetition(occurrences, plyHistory);
    expect(result).toEqual({
      result: "draw",
      code: "repetition",
      reason: "Repeated position",
      detail: null,
    });
  });

  it("detects perpetual check by one side (black checks every move)", () => {
    const plyHistory: PlyMeta[] = [
      meta("red", "a w", false),
      meta("black", "b b", true),
      meta("red", "c w", false),
      meta("black", "a b", true),
      meta("red", "d w", false),
      meta("black", "e b", true),
      meta("red", "f w", false),
      meta("black", "a b", true),
    ];
    const occurrences = [0, 4, 8];

    const result = adjudicateRepetition(occurrences, plyHistory);
    expect(result).toEqual({
      result: "red",
      code: "perpetual_check",
      reason: "Black lost by perpetual check",
      detail: JSON.stringify({ side: "black" }),
    });
  });

  it("detects perpetual check by red", () => {
    const plyHistory: PlyMeta[] = [
      meta("red", "x w", true),
      meta("black", "y b", false),
      meta("red", "z w", true),
      meta("black", "p b", false),
      meta("red", "x w", true),
      meta("black", "y b", false),
      meta("red", "z w", true),
      meta("black", "p b", false),
    ];
    const occurrences = [0, 4, 8];

    const result = adjudicateRepetition(occurrences, plyHistory);
    expect(result).toEqual({
      result: "black",
      code: "perpetual_check",
      reason: "Red lost by perpetual check",
      detail: JSON.stringify({ side: "red" }),
    });
  });

  it("returns draw for mutual perpetual check", () => {
    const plyHistory: PlyMeta[] = [
      meta("red", "a w", true),
      meta("black", "b b", true),
      meta("red", "c w", true),
      meta("black", "a b", true),
      meta("red", "b w", true),
      meta("black", "c b", true),
      meta("red", "a w", true),
      meta("black", "a b", true),
    ];
    const occurrences = [0, 4, 8];

    const result = adjudicateRepetition(occurrences, plyHistory);
    expect(result).toEqual({
      result: "draw",
      code: "mutual_perpetual_check",
      reason: "Mutual perpetual check",
      detail: null,
    });
  });

  it("detects perpetual chase by one side", () => {
    const plyHistory: PlyMeta[] = [
      meta("red", "a w", false),
      meta("black", "b b", false, "standard"),
      meta("red", "c w", false),
      meta("black", "a b", false, "standard"),
      meta("red", "d w", false),
      meta("black", "e b", false, "standard"),
      meta("red", "f w", false),
      meta("black", "a b", false, "standard"),
    ];
    const occurrences = [0, 4, 8];

    const result = adjudicateRepetition(occurrences, plyHistory);
    expect(result).toEqual({
      result: "red",
      code: "perpetual_chase",
      reason: "Black lost by perpetual chase",
      detail: JSON.stringify({ side: "black" }),
    });
  });

  it("keeps exempt king or pawn chase as draw by repetition", () => {
    const plyHistory: PlyMeta[] = [
      meta("red", "a w", false, "exempt"),
      meta("black", "b b", false),
      meta("red", "c w", false, "exempt"),
      meta("black", "a b", false),
      meta("red", "d w", false, "exempt"),
      meta("black", "e b", false),
      meta("red", "f w", false, "exempt"),
      meta("black", "a b", false),
    ];
    const occurrences = [0, 4, 8];

    const result = adjudicateRepetition(occurrences, plyHistory);
    expect(result).toEqual({
      result: "draw",
      code: "repetition",
      reason: "Repeated position",
      detail: null,
    });
  });

  it("does not trigger repetition verdict without three occurrences", () => {
    const plyHistory: PlyMeta[] = [
      meta("red", "pos1 w", false),
      meta("black", "pos2 b", true),
      meta("red", "pos3 w", false),
      meta("black", "pos4 b", true),
      meta("red", "pos5 w", false),
      meta("black", "pos6 b", true),
    ];

    expect(adjudicateRepetition([0], plyHistory)).toBeNull();
    expect(adjudicateRepetition([0, 3], plyHistory)).toBeNull();
  });
});

describe("judgeNaturalMoveLimit", () => {
  it("draws when halfmove clock reaches the fixed limit", () => {
    const state = parseFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 100 1");
    expect(judgeNaturalMoveLimit(state)).toEqual({
      result: "draw",
      code: "natural_move_limit",
      reason: "Natural move limit",
      detail: JSON.stringify({ limit: 100 }),
    });
  });

  it("does nothing before the limit", () => {
    const state = parseFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 99 1");
    expect(judgeNaturalMoveLimit(state)).toBeNull();
  });
});
