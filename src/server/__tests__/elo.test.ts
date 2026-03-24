import { describe, it, expect } from "vitest";
import { calculateElo, calculateEloCI } from "../elo";

describe("calculateElo", () => {
  it("winner gains, loser loses equal amounts", () => {
    const [newA, newB] = calculateElo(1500, 1500, 1);
    expect(newA).toBeGreaterThan(1500);
    expect(newB).toBeLessThan(1500);
    expect(Math.round(newA)).toBe(1516);
    expect(Math.round(newB)).toBe(1484);
  });

  it("draw between equal players changes nothing", () => {
    const [newA, newB] = calculateElo(1500, 1500, 0.5);
    expect(newA).toBe(1500);
    expect(newB).toBe(1500);
  });

  it("upset win gives larger rating change", () => {
    const [newA, newB] = calculateElo(1200, 1800, 1);
    const gain = newA - 1200;
    expect(gain).toBeGreaterThan(20);
  });

  it("expected win gives smaller rating change", () => {
    const [newA, newB] = calculateElo(1800, 1200, 1);
    const gain = newA - 1800;
    expect(gain).toBeLessThan(10);
  });
});

describe("calculateEloCI", () => {
  it("returns null for fewer than 10 games", () => {
    expect(calculateEloCI(3, 3, 3)).toBeNull();
    expect(calculateEloCI(0, 0, 0)).toBeNull();
  });

  it("returns a positive integer for sufficient games", () => {
    const ci = calculateEloCI(60, 30, 10);
    expect(ci).not.toBeNull();
    expect(ci).toBeGreaterThan(0);
    expect(Number.isInteger(ci)).toBe(true);
  });

  it("CI decreases with more games", () => {
    const ci100 = calculateEloCI(50, 40, 10)!;
    const ci400 = calculateEloCI(200, 160, 40)!;
    expect(ci400).toBeLessThan(ci100);
  });

  it("CI is larger for extreme win rates", () => {
    // Elo mapping is non-linear: extreme win rates (e.g. 90%) map to a steep
    // region of the logistic curve, so the Elo-space CI is wider than at 50%.
    const ci50 = calculateEloCI(50, 50, 0)!;
    const ci90 = calculateEloCI(90, 10, 0)!;
    expect(ci90).toBeGreaterThan(ci50);
  });

  it("returns exactly at boundary of 10 games", () => {
    const ci = calculateEloCI(5, 3, 2);
    expect(ci).not.toBeNull();
    expect(ci).toBeGreaterThan(0);
  });
});
