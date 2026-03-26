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

describe("KnockoutStrategy (bracket-based)", () => {
  const knockout = new KnockoutStrategy();

  it("initBracket: 4 engines → 2 round-1 matches ready", () => {
    const bracket = knockout.initBracket(["A", "B", "C", "D"]);
    const ready = knockout.getReadyMatches(bracket);
    expect(ready).toHaveLength(2);
    // Classic seeding: A vs D, B vs C
    const r1 = bracket.matches.filter(m => m.round === 1);
    expect(r1[0].engineA).toBe("A");
    expect(r1[0].engineB).toBe("D");
    expect(r1[1].engineA).toBe("B");
    expect(r1[1].engineB).toBe("C");
  });

  it("initBracket: 3 engines → 1 bye for A, B vs C play", () => {
    const bracket = knockout.initBracket(["A", "B", "C"]);
    const ready = knockout.getReadyMatches(bracket);
    expect(ready).toHaveLength(1);
    // A gets bye
    const byeMatch = bracket.matches.find(m => m.isBye);
    expect(byeMatch?.winner).toBe("A");
    // B vs C is the ready match
    expect(ready[0].engineA).toBe("B");
    expect(ready[0].engineB).toBe("C");
  });

  it("resolveMatch: winners advance to final", () => {
    const bracket = knockout.initBracket(["A", "B", "C", "D"]);
    // A beats D, B beats C
    knockout.resolveMatch(bracket, 1, 0, "A", false);
    knockout.resolveMatch(bracket, 1, 1, "B", false);

    const final = bracket.matches.find(m => m.round === 2);
    expect(final?.engineA).toBe("A");
    expect(final?.engineB).toBe("B");

    const ready = knockout.getReadyMatches(bracket);
    expect(ready).toHaveLength(1);
    expect(ready[0].round).toBe(2);
  });

  it("4 engines: complete 2-round tournament lifecycle", () => {
    const bracket = knockout.initBracket(["A", "B", "C", "D"]);
    expect(bracket.totalRounds).toBe(2);

    // Round 1
    let ready = knockout.getReadyMatches(bracket);
    expect(ready).toHaveLength(2);
    ready[0].gameIds = ["g1", "g2"];
    ready[1].gameIds = ["g3", "g4"];

    knockout.resolveMatch(bracket, 1, 0, "A", false);
    knockout.resolveMatch(bracket, 1, 1, "B", false);

    // Final
    ready = knockout.getReadyMatches(bracket);
    expect(ready).toHaveLength(1);
    const finalPlayers = new Set([ready[0].engineA, ready[0].engineB]);
    expect(finalPlayers).toEqual(new Set(["A", "B"]));

    ready[0].gameIds = ["g5", "g6"];
    knockout.resolveMatch(bracket, 2, 0, "A", false);
    expect(knockout.isComplete(bracket)).toBe(true);
    expect(knockout.getChampion(bracket)).toBe("A");
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
