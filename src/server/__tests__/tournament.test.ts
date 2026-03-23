import { describe, it, expect } from "vitest";
import { generateRoundRobinPairings } from "../tournament";

describe("generateRoundRobinPairings", () => {
  it("generates correct number of pairings for 3 engines", () => {
    const pairings = generateRoundRobinPairings(["A", "B", "C"], 2);
    expect(pairings).toHaveLength(6); // 3 pairs x 2 rounds
  });

  it("generates correct number of pairings for 4 engines", () => {
    const pairings = generateRoundRobinPairings(["A", "B", "C", "D"], 1);
    expect(pairings).toHaveLength(6); // 6 pairs x 1 round
  });

  it("each pair plays equal red and black", () => {
    const pairings = generateRoundRobinPairings(["A", "B"], 2);
    expect(pairings).toHaveLength(2);
    const asRed = pairings.filter((p) => p.red === "A" && p.black === "B");
    const asBlack = pairings.filter((p) => p.red === "B" && p.black === "A");
    expect(asRed.length).toBe(1);
    expect(asBlack.length).toBe(1);
  });

  it("generates zero pairings for a single engine", () => {
    const pairings = generateRoundRobinPairings(["A"], 2);
    expect(pairings).toHaveLength(0);
  });

  it("generates correct pairings for 5 engines with 4 rounds", () => {
    const pairings = generateRoundRobinPairings(
      ["A", "B", "C", "D", "E"],
      4,
    );
    // C(5,2) = 10 pairs, 4 rounds each = 40
    expect(pairings).toHaveLength(40);
  });

  it("alternates colors correctly across rounds", () => {
    const pairings = generateRoundRobinPairings(["X", "Y"], 4);
    expect(pairings).toHaveLength(4);
    // Round 0 (even): X=red, Y=black
    expect(pairings[0]).toEqual({ red: "X", black: "Y" });
    // Round 1 (odd): Y=red, X=black
    expect(pairings[1]).toEqual({ red: "Y", black: "X" });
    // Round 2 (even): X=red, Y=black
    expect(pairings[2]).toEqual({ red: "X", black: "Y" });
    // Round 3 (odd): Y=red, X=black
    expect(pairings[3]).toEqual({ red: "Y", black: "X" });
  });
});
