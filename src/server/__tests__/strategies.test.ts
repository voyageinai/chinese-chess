import { describe, it, expect } from "vitest";
import { GauntletStrategy } from "../strategies/gauntlet";
import { KnockoutStrategy } from "../strategies/knockout";
import { RoundRobinStrategy } from "../strategies/round-robin";
import { SwissStrategy } from "../strategies/swiss";
import { createStrategy } from "../strategies";
import type { Standing } from "../strategies";

describe("createStrategy", () => {
  it("creates round_robin strategy", () => {
    const s = createStrategy("round_robin");
    expect(s.format).toBe("round_robin");
    expect(s.isRoundBased()).toBe(false);
  });

  it("creates gauntlet strategy", () => {
    const s = createStrategy("gauntlet");
    expect(s.format).toBe("gauntlet");
    expect(s.isRoundBased()).toBe(false);
  });

  it("creates knockout strategy", () => {
    const s = createStrategy("knockout");
    expect(s.format).toBe("knockout");
    expect(s.isRoundBased()).toBe(true);
  });

  it("creates swiss strategy", () => {
    const s = createStrategy("swiss");
    expect(s.format).toBe("swiss");
    expect(s.isRoundBased()).toBe(true);
  });
});

describe("GauntletStrategy", () => {
  const gauntlet = new GauntletStrategy();

  it("challenger plays every opponent, not opponents vs each other", () => {
    const pairings = gauntlet.generateAllPairings!(
      ["challenger", "A", "B", "C"],
      { rounds: 1 },
    );
    // 3 opponents × 2 games (swap colors) = 6
    expect(pairings).toHaveLength(6);

    // All pairings involve the challenger
    for (const p of pairings) {
      expect(p.red === "challenger" || p.black === "challenger").toBe(true);
    }

    // No games between A, B, C
    const nonChallenger = pairings.filter(
      (p) => p.red !== "challenger" && p.black !== "challenger",
    );
    expect(nonChallenger).toHaveLength(0);
  });

  it("uses challengerEngineId from config", () => {
    const pairings = gauntlet.generateAllPairings!(
      ["A", "B", "C"],
      { rounds: 1, challengerEngineId: "B" },
    );
    // B vs A and B vs C = 4 games
    expect(pairings).toHaveLength(4);
    for (const p of pairings) {
      expect(p.red === "B" || p.black === "B").toBe(true);
    }
  });

  it("color-swapped pairs share the same startFen", () => {
    const fens = ["fen1", "fen2"];
    const pairings = gauntlet.generateAllPairings!(
      ["challenger", "A", "B"],
      { rounds: 1, openingFens: fens },
    );
    // Group by pair
    const pairs = new Map<string, string[]>();
    for (const p of pairings) {
      const key = [p.red, p.black].sort().join("|");
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key)!.push(p.startFen ?? "none");
    }
    for (const [, fenList] of pairs) {
      expect(fenList[0]).toBe(fenList[1]);
    }
  });

  it("handles multiple rounds", () => {
    const pairings = gauntlet.generateAllPairings!(
      ["challenger", "A", "B"],
      { rounds: 3 },
    );
    // 2 opponents × 2 colors × 3 rounds = 12
    expect(pairings).toHaveLength(12);
  });
});

describe("KnockoutStrategy", () => {
  const knockout = new KnockoutStrategy();

  it("generates first round pairings for 4 engines", () => {
    const pairings = knockout.generateNextRound!({
      round: 1,
      totalRounds: 2,
      engineIds: ["A", "B", "C", "D"],
      standings: [],
      completedGames: [],
    });
    // 4 engines → 2 matchups × 2 games = 4
    expect(pairings).toHaveLength(4);
  });

  it("generates first round pairings for 3 engines (1 bye)", () => {
    const pairings = knockout.generateNextRound!({
      round: 1,
      totalRounds: 2,
      engineIds: ["A", "B", "C"],
      standings: [],
      completedGames: [],
    });
    // bracket size 4, 1 bye → only 2 engines play → 1 matchup × 2 games = 2
    expect(pairings).toHaveLength(2);
    // A gets bye (top seed), B vs C play
    const participants = new Set(pairings!.flatMap(p => [p.red, p.black]));
    expect(participants.has("A")).toBe(false);
    expect(participants.has("B")).toBe(true);
    expect(participants.has("C")).toBe(true);
  });

  it("advances winners to next round", () => {
    // Round 1: A vs D (A wins), B vs C (B wins)
    const pairings = knockout.generateNextRound!({
      round: 2,
      totalRounds: 2,
      engineIds: ["A", "B", "C", "D"],
      standings: [],
      completedGames: [
        { redId: "A", blackId: "D", result: "red" },
        { redId: "D", blackId: "A", result: "black" },
        { redId: "B", blackId: "C", result: "red" },
        { redId: "C", blackId: "B", result: "black" },
      ],
    });
    // A and B advance → 1 matchup × 2 games = 2
    expect(pairings).toHaveLength(2);
    const participants = new Set(pairings!.flatMap(p => [p.red, p.black]));
    expect(participants.has("A")).toBe(true);
    expect(participants.has("B")).toBe(true);
    expect(participants.has("C")).toBe(false);
    expect(participants.has("D")).toBe(false);
  });

  it("4 engines: tournament needs exactly 2 rounds (log2(4))", () => {
    // Round 1: 2 matchups (4 games)
    const r1 = knockout.generateNextRound!({
      round: 1,
      totalRounds: 2,
      engineIds: ["A", "B", "C", "D"],
      standings: [],
      completedGames: [],
    });
    expect(r1).toHaveLength(4);

    // Round 2 (final): A beat D, B beat C → A vs B
    const r2 = knockout.generateNextRound!({
      round: 2,
      totalRounds: 2,
      engineIds: ["A", "B", "C", "D"],
      standings: [],
      completedGames: [
        { redId: "A", blackId: "D", result: "red" },
        { redId: "D", blackId: "A", result: "black" },
        { redId: "B", blackId: "C", result: "red" },
        { redId: "C", blackId: "B", result: "black" },
      ],
    });
    expect(r2).toHaveLength(2); // 1 matchup × 2 games
    const finalPlayers = new Set(r2!.flatMap(p => [p.red, p.black]));
    expect(finalPlayers).toEqual(new Set(["A", "B"]));
  });
});

describe("RoundRobinStrategy", () => {
  const rr = new RoundRobinStrategy();

  it("delegates to generateRoundRobinPairings", () => {
    const pairings = rr.generateAllPairings!(["A", "B", "C"], { rounds: 1 });
    // C(3,2) = 3 pairs × 2 games = 6
    expect(pairings).toHaveLength(6);
  });
});

describe("SwissStrategy", () => {
  const swiss = new SwissStrategy();

  function makeStanding(id: string, score: number, opponents: string[] = [], colors: ("red" | "black")[] = []): Standing {
    return {
      engineId: id, score, wins: 0, losses: 0, draws: 0,
      opponents, colorHistory: colors,
    };
  }

  it("pairs same-score engines first", () => {
    const pairings = swiss.generateNextRound!({
      round: 2,
      totalRounds: 4,
      engineIds: ["A", "B", "C", "D"],
      standings: [
        makeStanding("A", 2), makeStanding("B", 2),
        makeStanding("C", 0), makeStanding("D", 0),
      ],
      completedGames: [],
    });
    expect(pairings).not.toBeNull();
    // 2 matchups × 2 games = 4
    expect(pairings).toHaveLength(4);
    // A(2) should be paired with B(2), C(0) with D(0)
    const matchups = new Set<string>();
    for (const p of pairings!) {
      matchups.add([p.red, p.black].sort().join("|"));
    }
    expect(matchups.has("A|B")).toBe(true);
    expect(matchups.has("C|D")).toBe(true);
  });

  it("avoids repeat opponents when possible", () => {
    const pairings = swiss.generateNextRound!({
      round: 2,
      totalRounds: 4,
      engineIds: ["A", "B", "C", "D"],
      standings: [
        makeStanding("A", 1, ["B"]), makeStanding("B", 1, ["A"]),
        makeStanding("C", 1, ["D"]), makeStanding("D", 1, ["C"]),
      ],
      completedGames: [],
    });
    expect(pairings).not.toBeNull();
    const matchups = new Set<string>();
    for (const p of pairings!) {
      matchups.add([p.red, p.black].sort().join("|"));
    }
    // Should avoid A-B and C-D since they already played
    expect(matchups.has("A|B")).toBe(false);
    expect(matchups.has("C|D")).toBe(false);
  });

  it("handles odd number of engines (one gets bye)", () => {
    const pairings = swiss.generateNextRound!({
      round: 1,
      totalRounds: 3,
      engineIds: ["A", "B", "C"],
      standings: [
        makeStanding("A", 0), makeStanding("B", 0), makeStanding("C", 0),
      ],
      completedGames: [],
    });
    // 1 matchup × 2 games = 2 (one engine gets bye)
    expect(pairings).toHaveLength(2);
    const participants = new Set(pairings!.flatMap(p => [p.red, p.black]));
    expect(participants.size).toBe(2); // only 2 engines play
  });

  it("returns null when round exceeds totalRounds", () => {
    const pairings = swiss.generateNextRound!({
      round: 5,
      totalRounds: 4,
      engineIds: ["A", "B"],
      standings: [makeStanding("A", 2), makeStanding("B", 2)],
      completedGames: [],
    });
    expect(pairings).toBeNull();
  });

  it("color-swapped pairs share same FEN", () => {
    const pairings = swiss.generateNextRound!({
      round: 1,
      totalRounds: 4,
      engineIds: ["A", "B", "C", "D"],
      standings: [
        makeStanding("A", 0), makeStanding("B", 0),
        makeStanding("C", 0), makeStanding("D", 0),
      ],
      completedGames: [],
      openingFens: ["fen1", "fen2"],
    });
    // Each matchup's 2 games should share the same FEN
    const byPair = new Map<string, string[]>();
    for (const p of pairings!) {
      const key = [p.red, p.black].sort().join("|");
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key)!.push(p.startFen ?? "none");
    }
    for (const [, fens] of byPair) {
      expect(fens[0]).toBe(fens[1]);
    }
  });
});
