import { describe, it, expect } from "vitest";
import { selectOpponents, randomColor } from "../matchmaking";
import type { MatchCandidate } from "../matchmaking";

const engines: MatchCandidate[] = [
  { id: "A", elo: 1500, user_id: "u1" },
  { id: "B", elo: 1600, user_id: "u2" },
  { id: "C", elo: 1400, user_id: "u2" },
  { id: "D", elo: 1800, user_id: "u3" },
  { id: "E", elo: 1200, user_id: "u3" },
  { id: "F", elo: 1500, user_id: "u1" }, // same user as A
];

describe("selectOpponents", () => {
  it("excludes all engines owned by the same user", () => {
    // u1 owns A and F. Selecting for A should never return F.
    for (let i = 0; i < 50; i++) {
      const result = selectOpponents("A", 1500, "u1", 4, engines);
      expect(result).not.toContain("A");
      expect(result).not.toContain("F");
    }
  });

  it("never returns duplicates", () => {
    const result = selectOpponents("A", 1500, "u1", 4, engines);
    expect(new Set(result).size).toBe(result.length);
  });

  it("returns at most candidates.length opponents", () => {
    // u1 has A and F. Candidates = B, C, D, E (4 engines).
    const result = selectOpponents("A", 1500, "u1", 10, engines);
    expect(result.length).toBe(4);
  });

  it("returns empty array when no candidates", () => {
    const solo: MatchCandidate[] = [
      { id: "X", elo: 1500, user_id: "u1" },
      { id: "Y", elo: 1600, user_id: "u1" },
    ];
    const result = selectOpponents("X", 1500, "u1", 3, solo);
    expect(result).toEqual([]);
  });

  it("excludes disabled engines", () => {
    const withDisabled: MatchCandidate[] = [
      { id: "A", elo: 1500, user_id: "u1" },
      { id: "B", elo: 1500, user_id: "u2", status: "disabled" },
      { id: "C", elo: 1500, user_id: "u3" },
    ];
    for (let i = 0; i < 20; i++) {
      const result = selectOpponents("A", 1500, "u1", 2, withDisabled);
      expect(result).not.toContain("B");
      expect(result).toContain("C");
    }
  });

  it("favors Elo-close engines (statistical)", () => {
    // A(1500) should pick B(1600) more often than D(1800)
    const counts: Record<string, number> = { B: 0, C: 0, D: 0, E: 0 };
    for (let i = 0; i < 200; i++) {
      const result = selectOpponents("A", 1500, "u1", 1, engines);
      counts[result[0]]++;
    }
    // B(1600, diff=100) and C(1400, diff=100) should be picked more than D(1800, diff=300)
    expect(counts["B"] + counts["C"]).toBeGreaterThan(counts["D"] + counts["E"]);
  });
});

describe("randomColor", () => {
  it("returns only red or black", () => {
    for (let i = 0; i < 100; i++) {
      const color = randomColor();
      expect(["red", "black"]).toContain(color);
    }
  });
});
