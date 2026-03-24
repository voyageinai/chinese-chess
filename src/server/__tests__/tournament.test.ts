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

  // --- Opening FEN tests ---

  it("color-swapped pair shares the same startFen", () => {
    const fens = [
      "rneakaenr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNEAKAENR w - - 0 1",
      "rneakaenr/9/1c5c1/p1p1p1p1p/9/2P6/P3P1P1P/1C5C1/9/RNEAKAENR b - - 0 1",
    ];
    const pairings = generateRoundRobinPairings(["A", "B"], 1, fens);
    expect(pairings).toHaveLength(2);
    // Both games must have a startFen
    expect(pairings[0].startFen).toBeDefined();
    expect(pairings[1].startFen).toBeDefined();
    // Only one pair of engines => both games share the same FEN
    // (shuffle doesn't change FEN assignment, only order)
    expect(pairings[0].startFen).toBe(pairings[1].startFen);
    // The two games should have swapped colors
    const reds = new Set(pairings.map(p => p.red));
    expect(reds.size).toBe(2); // each engine plays red once
  });

  it("empty opening book results in undefined startFen", () => {
    const pairings = generateRoundRobinPairings(["A", "B"], 1);
    expect(pairings).toHaveLength(2);
    expect(pairings[0].startFen).toBeUndefined();
    expect(pairings[1].startFen).toBeUndefined();
  });

  it("openingFens cycle when games > FENs", () => {
    const fens = ["fen1", "fen2"];
    // 3 engines, 1 round => C(3,2)=3 pairs => 3 color-swap pairs, each needs 1 FEN
    const pairings = generateRoundRobinPairings(["A", "B", "C"], 1, fens);
    expect(pairings).toHaveLength(6); // 3 pairs * 2 games

    // Every pairing must have a startFen from the provided list
    for (const p of pairings) {
      expect(fens).toContain(p.startFen);
    }

    // Group pairings by their engine pair (order-independent) to find color-swap pairs
    const pairMap = new Map<string, typeof pairings>();
    for (const p of pairings) {
      const key = [p.red, p.black].sort().join("-");
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key)!.push(p);
    }

    // Each color-swap pair must share the same FEN
    for (const [, group] of pairMap) {
      expect(group).toHaveLength(2);
      expect(group[0].startFen).toBe(group[1].startFen);
    }

    // With 3 pairs and 2 FENs, we must see both FENs used (cycling)
    const allFens = pairings.map(p => p.startFen!);
    expect(allFens).toContain("fen1");
    expect(allFens).toContain("fen2");
  });

  it("existing tests still pass with 2 args (no openingFens)", () => {
    const pairings = generateRoundRobinPairings(["A", "B", "C"], 1);
    expect(pairings).toHaveLength(6);
    for (const p of pairings) {
      expect(p.startFen).toBeUndefined();
    }
  });
});
