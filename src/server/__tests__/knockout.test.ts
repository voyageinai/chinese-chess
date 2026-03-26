import { describe, it, expect } from "vitest";
import { KnockoutStrategy, generateBracketPositions } from "../strategies/knockout";
import type { BracketData, BracketMatch } from "../strategies/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEngineIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `engine_${i + 1}`);
}

function findMatch(bracket: BracketData, round: number, position: number): BracketMatch {
  const m = bracket.matches.find((m) => m.round === round && m.position === position);
  if (!m) throw new Error(`No match at round ${round} pos ${position}`);
  return m;
}

// ---------------------------------------------------------------------------
// generateBracketPositions
// ---------------------------------------------------------------------------

describe("generateBracketPositions", () => {
  it("size 2: [0, 1]", () => {
    expect(generateBracketPositions(2)).toEqual([0, 1]);
  });

  it("size 4: [0, 3, 1, 2] → seeds 1v4, 2v3", () => {
    expect(generateBracketPositions(4)).toEqual([0, 3, 1, 2]);
  });

  it("size 8: [0,7,3,4,1,6,2,5] → seeds 1v8, 4v5, 2v7, 3v6", () => {
    const pos = generateBracketPositions(8);
    expect(pos).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
  });

  it("size 16: seed 1 and 2 in opposite halves", () => {
    const pos = generateBracketPositions(16);
    expect(pos).toHaveLength(16);
    // Seed 1 (index 0) should be in the first half (positions 0-7)
    const idx0 = pos.indexOf(0);
    const idx1 = pos.indexOf(1);
    expect(idx0).toBeLessThan(8);
    expect(idx1).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// initBracket
// ---------------------------------------------------------------------------

describe("KnockoutStrategy.initBracket", () => {
  const strategy = new KnockoutStrategy();

  it("2 engines: 1 match, no byes", () => {
    const bracket = strategy.initBracket(makeEngineIds(2));
    expect(bracket.bracketSize).toBe(2);
    expect(bracket.totalRounds).toBe(1);
    expect(bracket.matches).toHaveLength(1); // bracketSize - 1

    const final = findMatch(bracket, 1, 0);
    expect(final.engineA).toBe("engine_1");
    expect(final.engineB).toBe("engine_2");
    expect(final.isBye).toBe(false);
    expect(final.winner).toBeNull();
  });

  it("4 engines: classic seeding (1v4, 2v3)", () => {
    const bracket = strategy.initBracket(makeEngineIds(4));
    expect(bracket.bracketSize).toBe(4);
    expect(bracket.totalRounds).toBe(2);
    expect(bracket.matches).toHaveLength(3); // 2 + 1

    // Round 1: (1v4), (2v3)
    const m0 = findMatch(bracket, 1, 0);
    expect(m0.engineA).toBe("engine_1");
    expect(m0.engineB).toBe("engine_4");

    const m1 = findMatch(bracket, 1, 1);
    expect(m1.engineA).toBe("engine_2");
    expect(m1.engineB).toBe("engine_3");

    // Round 2 (final): empty, waiting
    const final = findMatch(bracket, 2, 0);
    expect(final.engineA).toBeNull();
    expect(final.engineB).toBeNull();
  });

  it("8 engines: seed 1 and 2 in opposite halves", () => {
    const bracket = strategy.initBracket(makeEngineIds(8));
    expect(bracket.bracketSize).toBe(8);
    expect(bracket.totalRounds).toBe(3);
    expect(bracket.matches).toHaveLength(7); // 4 + 2 + 1

    // Round 1 pairs: (1v8), (4v5), (2v7), (3v6)
    const m0 = findMatch(bracket, 1, 0);
    expect(m0.engineA).toBe("engine_1");
    expect(m0.engineB).toBe("engine_8");

    const m1 = findMatch(bracket, 1, 1);
    expect(m1.engineA).toBe("engine_4");
    expect(m1.engineB).toBe("engine_5");

    const m2 = findMatch(bracket, 1, 2);
    expect(m2.engineA).toBe("engine_2");
    expect(m2.engineB).toBe("engine_7");

    const m3 = findMatch(bracket, 1, 3);
    expect(m3.engineA).toBe("engine_3");
    expect(m3.engineB).toBe("engine_6");
  });

  it("3 engines: 1 bye for seed 1", () => {
    const bracket = strategy.initBracket(makeEngineIds(3));
    expect(bracket.bracketSize).toBe(4);
    expect(bracket.totalRounds).toBe(2);

    // Round 1 pos 0: seed 1 vs seed 4 (doesn't exist) → bye
    const m0 = findMatch(bracket, 1, 0);
    expect(m0.isBye).toBe(true);
    expect(m0.winner).toBe("engine_1");
    expect(m0.engineA).toBe("engine_1");
    expect(m0.engineB).toBeNull();

    // Round 1 pos 1: seed 2 vs seed 3
    const m1 = findMatch(bracket, 1, 1);
    expect(m1.isBye).toBe(false);
    expect(m1.engineA).toBe("engine_2");
    expect(m1.engineB).toBe("engine_3");

    // Round 2: engine_1 already propagated
    const final = findMatch(bracket, 2, 0);
    expect(final.engineA).toBe("engine_1");
    expect(final.engineB).toBeNull(); // waiting for m1 winner
  });

  it("6 engines: 2 byes for seeds 1 and 2", () => {
    const bracket = strategy.initBracket(makeEngineIds(6));
    expect(bracket.bracketSize).toBe(8);
    expect(bracket.totalRounds).toBe(3);

    // Seeds 7 and 8 don't exist → byes
    // Seed positions [0,7,3,4,1,6,2,5]: seed 8 at pos 1, seed 7 at pos 5
    // pos 0: seed 1 vs seed 8(bye) → bye
    const m0 = findMatch(bracket, 1, 0);
    expect(m0.isBye).toBe(true);
    expect(m0.winner).toBe("engine_1");

    // pos 2: seed 2 vs seed 7(bye) → bye
    const m2 = findMatch(bracket, 1, 2);
    expect(m2.isBye).toBe(true);
    expect(m2.winner).toBe("engine_2");

    // Count actual matches (not byes) in round 1
    const r1Byes = bracket.matches.filter((m) => m.round === 1 && m.isBye);
    expect(r1Byes).toHaveLength(2);
  });

  it("5 engines: 3 byes, cascading propagation", () => {
    const bracket = strategy.initBracket(makeEngineIds(5));
    expect(bracket.bracketSize).toBe(8);
    expect(bracket.totalRounds).toBe(3);

    // Seeds 6,7,8 don't exist → 3 byes
    const byes = bracket.matches.filter((m) => m.round === 1 && m.isBye);
    expect(byes).toHaveLength(3);

    // With 3 byes cascading, check that round 2 has at least one match
    // with both engines known (from two bye winners feeding into it)
    const r2Ready = bracket.matches.filter(
      (m) => m.round === 2 && m.engineA !== null && m.engineB !== null && !m.isBye,
    );
    expect(r2Ready.length).toBeGreaterThanOrEqual(1);
  });

  it("7 engines: 1 bye", () => {
    const bracket = strategy.initBracket(makeEngineIds(7));
    expect(bracket.bracketSize).toBe(8);
    const byes = bracket.matches.filter((m) => m.round === 1 && m.isBye);
    expect(byes).toHaveLength(1);
  });

  it("total match count = bracketSize - 1", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 16]) {
      const bracket = strategy.initBracket(makeEngineIds(n));
      expect(bracket.matches).toHaveLength(bracket.bracketSize - 1);
    }
  });

  it("throws for < 2 engines", () => {
    expect(() => strategy.initBracket(makeEngineIds(1))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getReadyMatches
// ---------------------------------------------------------------------------

describe("KnockoutStrategy.getReadyMatches", () => {
  const strategy = new KnockoutStrategy();

  it("4 engines: 2 matches ready after init", () => {
    const bracket = strategy.initBracket(makeEngineIds(4));
    const ready = strategy.getReadyMatches(bracket);
    expect(ready).toHaveLength(2);
    expect(ready.every((m) => m.round === 1)).toBe(true);
  });

  it("3 engines: 1 match ready after init (non-bye)", () => {
    const bracket = strategy.initBracket(makeEngineIds(3));
    const ready = strategy.getReadyMatches(bracket);
    expect(ready).toHaveLength(1);
    expect(ready[0].isBye).toBe(false);
  });

  it("5 engines: round 2 match is ready from cascading byes", () => {
    const bracket = strategy.initBracket(makeEngineIds(5));
    const ready = strategy.getReadyMatches(bracket);
    // Should include at least 1 round-2 match (from cascading byes)
    // plus 1 round-1 match (the only real first-round matchup)
    const r1Ready = ready.filter((m) => m.round === 1);
    const r2Ready = ready.filter((m) => m.round === 2);
    expect(r1Ready.length).toBe(1);
    expect(r2Ready.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// resolveMatch + propagation
// ---------------------------------------------------------------------------

describe("KnockoutStrategy.resolveMatch", () => {
  const strategy = new KnockoutStrategy();

  it("winner propagates to next round (even position → engineA)", () => {
    const bracket = strategy.initBracket(makeEngineIds(4));

    // Resolve round 1 pos 0: engine_1 wins
    strategy.resolveMatch(bracket, 1, 0, "engine_1", false);

    const final = findMatch(bracket, 2, 0);
    expect(final.engineA).toBe("engine_1");
    expect(final.engineB).toBeNull(); // still waiting for pos 1
  });

  it("winner propagates (odd position → engineB)", () => {
    const bracket = strategy.initBracket(makeEngineIds(4));

    // Resolve round 1 pos 1: engine_2 wins
    strategy.resolveMatch(bracket, 1, 1, "engine_2", false);

    const final = findMatch(bracket, 2, 0);
    expect(final.engineA).toBeNull();
    expect(final.engineB).toBe("engine_2");
  });

  it("both semis resolved → final ready", () => {
    const bracket = strategy.initBracket(makeEngineIds(4));

    strategy.resolveMatch(bracket, 1, 0, "engine_1", false);
    strategy.resolveMatch(bracket, 1, 1, "engine_3", false);

    const final = findMatch(bracket, 2, 0);
    expect(final.engineA).toBe("engine_1");
    expect(final.engineB).toBe("engine_3");

    const ready = strategy.getReadyMatches(bracket);
    expect(ready).toHaveLength(1);
    expect(ready[0].round).toBe(2);
  });

  it("tiebreak flag is stored", () => {
    const bracket = strategy.initBracket(makeEngineIds(4));
    strategy.resolveMatch(bracket, 1, 0, "engine_1", true);

    const m = findMatch(bracket, 1, 0);
    expect(m.tiebreak).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// determineMatchWinner
// ---------------------------------------------------------------------------

describe("KnockoutStrategy.determineMatchWinner", () => {
  const strategy = new KnockoutStrategy();
  const seeds = makeEngineIds(8);

  it("clear winner: engine with more points", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_1", engineB: "engine_8",
      winner: null, isBye: false, tiebreak: false, gameIds: [],
    };
    // engine_8 wins both games (as red in g1, as black in g2)
    const games = [
      { result: "red" as const, redId: "engine_8", blackId: "engine_1" },
      { result: "black" as const, redId: "engine_1", blackId: "engine_8" },
    ];
    const { winner, tiebreak } = strategy.determineMatchWinner(match, games, seeds);
    expect(winner).toBe("engine_8");
    expect(tiebreak).toBe(false);
  });

  it("2-game tie (1-1): needs decider → winner is null", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_1", engineB: "engine_8",
      winner: null, isBye: false, tiebreak: false, gameIds: [],
    };
    const games = [
      { result: "red" as const, redId: "engine_1", blackId: "engine_8" },
      { result: "red" as const, redId: "engine_8", blackId: "engine_1" },
    ];
    // 1-1 after 2 games → needs decider
    const { winner, tiebreak } = strategy.determineMatchWinner(match, games, seeds);
    expect(winner).toBeNull();
    expect(tiebreak).toBe(false);
  });

  it("2-game tie (two draws): needs decider → winner is null", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_4", engineB: "engine_5",
      winner: null, isBye: false, tiebreak: false, gameIds: [],
    };
    const games = [
      { result: "draw" as const, redId: "engine_4", blackId: "engine_5" },
      { result: "draw" as const, redId: "engine_5", blackId: "engine_4" },
    ];
    // 0.5-0.5 after 2 games → needs decider
    const { winner, tiebreak } = strategy.determineMatchWinner(match, games, seeds);
    expect(winner).toBeNull();
    expect(tiebreak).toBe(false);
  });

  it("3-game decider: decisive result", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_1", engineB: "engine_8",
      winner: null, isBye: false, tiebreak: false, gameIds: [],
    };
    // 1-1 after regular, then engine_8 wins decider as black
    const games = [
      { result: "red" as const, redId: "engine_1", blackId: "engine_8" },
      { result: "red" as const, redId: "engine_8", blackId: "engine_1" },
      { result: "black" as const, redId: "engine_8", blackId: "engine_1" },
    ];
    // engine_1: 1 (G1) + 0 (G2) + 1 (G3 black win) = 2
    // engine_8: 0 (G1) + 1 (G2) + 0 (G3) = 1
    const { winner, tiebreak } = strategy.determineMatchWinner(match, games, seeds);
    expect(winner).toBe("engine_1");
    expect(tiebreak).toBe(false);
  });

  it("3-game decider: draw in decider → 1.5-1.5 → higher seed wins", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_1", engineB: "engine_8",
      winner: null, isBye: false, tiebreak: false, gameIds: [],
    };
    // 1-1 after regular, then decider draws → 1.5-1.5
    const games = [
      { result: "red" as const, redId: "engine_1", blackId: "engine_8" },
      { result: "red" as const, redId: "engine_8", blackId: "engine_1" },
      { result: "draw" as const, redId: "engine_8", blackId: "engine_1" },
    ];
    const { winner, tiebreak } = strategy.determineMatchWinner(match, games, seeds);
    expect(winner).toBe("engine_1"); // higher seed (index 0)
    expect(tiebreak).toBe(true);
  });

  it("3-game decider: three draws → 1.5-1.5 → higher seed wins", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_4", engineB: "engine_5",
      winner: null, isBye: false, tiebreak: false, gameIds: [],
    };
    const games = [
      { result: "draw" as const, redId: "engine_4", blackId: "engine_5" },
      { result: "draw" as const, redId: "engine_5", blackId: "engine_4" },
      { result: "draw" as const, redId: "engine_5", blackId: "engine_4" },
    ];
    // 1.5-1.5 → higher seed engine_4 (index 3 < index 4)
    const { winner, tiebreak } = strategy.determineMatchWinner(match, games, seeds);
    expect(winner).toBe("engine_4");
    expect(tiebreak).toBe(true);
  });

  it("3-game decider: lower seed wins decider as red", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_1", engineB: "engine_8",
      winner: null, isBye: false, tiebreak: false, gameIds: [],
    };
    // 1-1 after regular, then engine_8 (lower seed) wins decider as red
    const games = [
      { result: "red" as const, redId: "engine_1", blackId: "engine_8" },
      { result: "red" as const, redId: "engine_8", blackId: "engine_1" },
      { result: "red" as const, redId: "engine_8", blackId: "engine_1" },
    ];
    // engine_1: 1 + 0 + 0 = 1, engine_8: 0 + 1 + 1 = 2
    const { winner, tiebreak } = strategy.determineMatchWinner(match, games, seeds);
    expect(winner).toBe("engine_8");
    expect(tiebreak).toBe(false);
  });

  it("2-0 sweep", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_3", engineB: "engine_6",
      winner: null, isBye: false, tiebreak: false, gameIds: [],
    };
    const games = [
      { result: "red" as const, redId: "engine_3", blackId: "engine_6" },
      { result: "black" as const, redId: "engine_6", blackId: "engine_3" },
    ];
    const { winner, tiebreak } = strategy.determineMatchWinner(match, games, seeds);
    expect(winner).toBe("engine_3");
    expect(tiebreak).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isComplete + getChampion
// ---------------------------------------------------------------------------

describe("KnockoutStrategy.isComplete", () => {
  const strategy = new KnockoutStrategy();

  it("incomplete bracket", () => {
    const bracket = strategy.initBracket(makeEngineIds(4));
    expect(strategy.isComplete(bracket)).toBe(false);
  });

  it("complete after all matches resolved", () => {
    const bracket = strategy.initBracket(makeEngineIds(4));
    strategy.resolveMatch(bracket, 1, 0, "engine_1", false);
    strategy.resolveMatch(bracket, 1, 1, "engine_3", false);
    expect(strategy.isComplete(bracket)).toBe(false);

    strategy.resolveMatch(bracket, 2, 0, "engine_1", false);
    expect(strategy.isComplete(bracket)).toBe(true);
    expect(strategy.getChampion(bracket)).toBe("engine_1");
  });
});

// ---------------------------------------------------------------------------
// getRankings
// ---------------------------------------------------------------------------

describe("KnockoutStrategy.getRankings", () => {
  const strategy = new KnockoutStrategy();

  it("4-engine tournament rankings", () => {
    const bracket = strategy.initBracket(makeEngineIds(4));

    // R1: engine_1 beats engine_4, engine_2 beats engine_3
    strategy.resolveMatch(bracket, 1, 0, "engine_1", false);
    strategy.resolveMatch(bracket, 1, 1, "engine_2", false);

    // Final: engine_1 beats engine_2
    strategy.resolveMatch(bracket, 2, 0, "engine_1", false);

    const rankings = strategy.getRankings(bracket);
    expect(rankings.get("engine_1")).toBe(1); // champion
    expect(rankings.get("engine_2")).toBe(2); // finalist
    expect(rankings.get("engine_3")).toBe(3); // lost in semi (round 1 of 2-round bracket)
    expect(rankings.get("engine_4")).toBe(3); // lost in semi (round 1 of 2-round bracket)
  });

  it("8-engine tournament rankings", () => {
    const bracket = strategy.initBracket(makeEngineIds(8));

    // Quarter-finals
    strategy.resolveMatch(bracket, 1, 0, "engine_1", false);
    strategy.resolveMatch(bracket, 1, 1, "engine_4", false);
    strategy.resolveMatch(bracket, 1, 2, "engine_2", false);
    strategy.resolveMatch(bracket, 1, 3, "engine_3", false);

    // Semi-finals
    strategy.resolveMatch(bracket, 2, 0, "engine_1", false);
    strategy.resolveMatch(bracket, 2, 1, "engine_2", false);

    // Final
    strategy.resolveMatch(bracket, 3, 0, "engine_1", false);

    const rankings = strategy.getRankings(bracket);
    expect(rankings.get("engine_1")).toBe(1); // champion
    expect(rankings.get("engine_2")).toBe(2); // finalist
    expect(rankings.get("engine_4")).toBe(3); // lost in semi
    expect(rankings.get("engine_3")).toBe(3); // lost in semi
    expect(rankings.get("engine_8")).toBe(5); // lost in quarter
    expect(rankings.get("engine_5")).toBe(5); // lost in quarter
    expect(rankings.get("engine_7")).toBe(5); // lost in quarter
    expect(rankings.get("engine_6")).toBe(5); // lost in quarter
  });

  it("3-engine tournament: bye engine loses in final", () => {
    const bracket = strategy.initBracket(makeEngineIds(3));

    // R1 pos 1: engine_2 beats engine_3
    strategy.resolveMatch(bracket, 1, 1, "engine_2", false);

    // Final: engine_2 beats engine_1 (who had the bye)
    strategy.resolveMatch(bracket, 2, 0, "engine_2", false);

    const rankings = strategy.getRankings(bracket);
    expect(rankings.get("engine_2")).toBe(1);
    expect(rankings.get("engine_1")).toBe(2);
    expect(rankings.get("engine_3")).toBe(3); // lost in round 1
  });
});

// ---------------------------------------------------------------------------
// Full tournament simulation
// ---------------------------------------------------------------------------

describe("Full knockout simulation", () => {
  const strategy = new KnockoutStrategy();

  it("4-engine tournament: complete lifecycle", () => {
    const ids = makeEngineIds(4);
    const bracket = strategy.initBracket(ids);

    // Step 1: get ready matches
    let ready = strategy.getReadyMatches(bracket);
    expect(ready).toHaveLength(2);

    // Simulate game creation
    ready[0].gameIds = ["g1", "g2"];
    ready[1].gameIds = ["g3", "g4"];

    // No more ready matches (gameIds filled)
    expect(strategy.getReadyMatches(bracket)).toHaveLength(0);

    // Step 2: resolve round 1
    strategy.resolveMatch(bracket, 1, 0, "engine_1", false);
    strategy.resolveMatch(bracket, 1, 1, "engine_3", false);

    // Step 3: final is ready
    ready = strategy.getReadyMatches(bracket);
    expect(ready).toHaveLength(1);
    expect(ready[0].round).toBe(2);
    expect(ready[0].engineA).toBe("engine_1");
    expect(ready[0].engineB).toBe("engine_3");

    ready[0].gameIds = ["g5", "g6"];

    // Step 4: resolve final
    strategy.resolveMatch(bracket, 2, 0, "engine_1", false);
    expect(strategy.isComplete(bracket)).toBe(true);
    expect(strategy.getChampion(bracket)).toBe("engine_1");
  });

  it("6-engine tournament with byes", () => {
    const ids = makeEngineIds(6);
    const bracket = strategy.initBracket(ids);

    // Should have 2 byes (seeds 7,8 missing)
    const byes = bracket.matches.filter((m) => m.isBye);
    expect(byes).toHaveLength(2);

    // Get ready matches: should be round 1 non-bye matches
    const ready = strategy.getReadyMatches(bracket);
    expect(ready.length).toBeGreaterThanOrEqual(2); // at least the 2 non-bye R1 matches

    // All ready matches should have both engines
    for (const m of ready) {
      expect(m.engineA).toBeTruthy();
      expect(m.engineB).toBeTruthy();
      expect(m.isBye).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Decider game logic
// ---------------------------------------------------------------------------

describe("KnockoutStrategy.getDeciderColors", () => {
  const strategy = new KnockoutStrategy();
  const seeds = makeEngineIds(8);

  it("lower seed gets red in decider", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_1", engineB: "engine_8",
      winner: null, isBye: false, tiebreak: false, gameIds: [],
    };
    // engine_1 is higher seed (index 0), engine_8 is lower seed (index 7)
    // Lower seed gets red → engine_8 = red
    const { red, black } = strategy.getDeciderColors(match, seeds);
    expect(red).toBe("engine_8");
    expect(black).toBe("engine_1");
  });

  it("works when engineB is the higher seed", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_5", engineB: "engine_2",
      winner: null, isBye: false, tiebreak: false, gameIds: [],
    };
    // engine_2 is higher seed (index 1), engine_5 is lower seed (index 4)
    // Lower seed gets red → engine_5 = red
    const { red, black } = strategy.getDeciderColors(match, seeds);
    expect(red).toBe("engine_5");
    expect(black).toBe("engine_2");
  });
});

describe("KnockoutStrategy.needsDecider", () => {
  const strategy = new KnockoutStrategy();

  it("match with 2 gameIds and no winner needs decider", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_1", engineB: "engine_8",
      winner: null, isBye: false, tiebreak: false,
      gameIds: ["g1", "g2"],
    };
    expect(strategy.needsDecider(match)).toBe(true);
  });

  it("match with winner does not need decider", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_1", engineB: "engine_8",
      winner: "engine_1", isBye: false, tiebreak: false,
      gameIds: ["g1", "g2"],
    };
    expect(strategy.needsDecider(match)).toBe(false);
  });

  it("match with 3 gameIds (decider already created) does not need decider", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_1", engineB: "engine_8",
      winner: null, isBye: false, tiebreak: false,
      gameIds: ["g1", "g2", "g3"],
    };
    expect(strategy.needsDecider(match)).toBe(false);
  });

  it("bye does not need decider", () => {
    const match: BracketMatch = {
      round: 1, position: 0,
      engineA: "engine_1", engineB: null,
      winner: "engine_1", isBye: true, tiebreak: false,
      gameIds: [],
    };
    expect(strategy.needsDecider(match)).toBe(false);
  });
});
