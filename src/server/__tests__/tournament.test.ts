import { describe, it, expect } from "vitest";
import { generateRoundRobinPairings } from "../tournament";

describe("generateRoundRobinPairings", () => {
  it("generates 2 games per pair per round (color swap)", () => {
    const pairings = generateRoundRobinPairings(["A", "B"], 1);
    expect(pairings).toHaveLength(2); // 1 pair * 1 round * 2 games
  });

  it("generates correct number of pairings for 3 engines, 2 rounds", () => {
    const pairings = generateRoundRobinPairings(["A", "B", "C"], 2);
    // C(3,2)=3 pairs * 2 rounds * 2 games = 12
    expect(pairings).toHaveLength(12);
  });

  it("generates correct number of pairings for 4 engines, 1 round", () => {
    const pairings = generateRoundRobinPairings(["A", "B", "C", "D"], 1);
    // C(4,2)=6 pairs * 1 round * 2 games = 12
    expect(pairings).toHaveLength(12);
  });

  it("each pair plays equal red and black", () => {
    const pairings = generateRoundRobinPairings(["A", "B"], 2);
    expect(pairings).toHaveLength(4);
    const aRedVsB = pairings.filter(
      (p) => p.red === "A" && p.black === "B",
    ).length;
    const bRedVsA = pairings.filter(
      (p) => p.red === "B" && p.black === "A",
    ).length;
    expect(aRedVsB).toBe(2);
    expect(bRedVsA).toBe(2);
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
    // C(5,2)=10 pairs * 4 rounds * 2 games = 80
    expect(pairings).toHaveLength(80);
  });

  it("global color balance: each engine plays equal red and black", () => {
    const engines = ["A", "B", "C", "D"];
    const pairings = generateRoundRobinPairings(engines, 1);
    expect(pairings).toHaveLength(12);

    for (const e of engines) {
      const asRed = pairings.filter((p) => p.red === e).length;
      const asBlack = pairings.filter((p) => p.black === e).length;
      expect(asRed).toBe(asBlack);
    }
  });

  it("color balance holds with odd number of engines", () => {
    const engines = ["A", "B", "C", "D", "E"];
    const pairings = generateRoundRobinPairings(engines, 1);
    // C(5,2)=10 pairs * 2 = 20
    expect(pairings).toHaveLength(20);

    for (const e of engines) {
      const asRed = pairings.filter((p) => p.red === e).length;
      const asBlack = pairings.filter((p) => p.black === e).length;
      expect(asRed).toBe(asBlack);
    }
  });

  it("every pair of engines plays both colors", () => {
    const engines = ["A", "B", "C"];
    const pairings = generateRoundRobinPairings(engines, 1);

    for (let i = 0; i < engines.length; i++) {
      for (let j = i + 1; j < engines.length; j++) {
        const eRed = pairings.filter(
          (p) => p.red === engines[i] && p.black === engines[j],
        ).length;
        const eBlack = pairings.filter(
          (p) => p.red === engines[j] && p.black === engines[i],
        ).length;
        expect(eRed).toBe(1);
        expect(eBlack).toBe(1);
      }
    }
  });
});
