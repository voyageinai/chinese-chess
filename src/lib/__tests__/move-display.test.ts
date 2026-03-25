import { describe, expect, it } from "vitest";
import { analyzeMoveDisplay, extractPvHeadMove } from "../move-display";

describe("analyzeMoveDisplay", () => {
  it("detects captures from the previous position", () => {
    const meta = analyzeMoveDisplay(
      "4k4/9/9/9/4p4/9/9/9/4R4/4K4 w - - 0 1",
      "e1e5",
    );

    expect(meta).toMatchObject({
      side: "red",
      movingPiece: "r",
      capturedPiece: "p",
      isCapture: true,
    });
  });

  it("detects checks and highlights the checked king", () => {
    const meta = analyzeMoveDisplay(
      "4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1",
      "e1e4",
    );

    expect(meta).toMatchObject({
      side: "red",
      isCheck: true,
      checkedKing: [0, 4],
    });
  });

  it("returns null when the origin square is empty", () => {
    expect(
      analyzeMoveDisplay("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1", "e1e4"),
    ).toBeNull();
  });
});

describe("extractPvHeadMove", () => {
  it("returns the first uci move from a pv line", () => {
    expect(extractPvHeadMove("h2e2 e9e8 e2e7")).toBe("h2e2");
  });

  it("ignores non-move tokens", () => {
    expect(extractPvHeadMove("depth 12 pv h2e2 e9e8")).toBe("h2e2");
  });

  it("returns null when no move token exists", () => {
    expect(extractPvHeadMove("score cp 34 nodes 1234")).toBeNull();
  });
});
