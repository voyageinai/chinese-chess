import { describe, it, expect } from "vitest";
import { calculateElo, calculateEloCI, getK } from "../elo";

describe("getK", () => {
  it("returns 64 for new engines (< 20 games)", () => {
    expect(getK(0)).toBe(64);
    expect(getK(10)).toBe(64);
    expect(getK(19)).toBe(64);
  });

  it("returns 32 for settling engines (20–49 games)", () => {
    expect(getK(20)).toBe(32);
    expect(getK(35)).toBe(32);
    expect(getK(49)).toBe(32);
  });

  it("returns 16 for established engines (≥ 50 games)", () => {
    expect(getK(50)).toBe(16);
    expect(getK(100)).toBe(16);
  });
});

describe("calculateElo", () => {
  it("new engines (K=64): winner gains +32 vs equal opponent", () => {
    const [newA, newB] = calculateElo(1500, 1500, 1, 0, 0);
    expect(Math.round(newA)).toBe(1532);
    expect(Math.round(newB)).toBe(1468);
  });

  it("established engines (K=16): winner gains +8 vs equal opponent", () => {
    const [newA, newB] = calculateElo(1500, 1500, 1, 60, 60);
    expect(Math.round(newA)).toBe(1508);
    expect(Math.round(newB)).toBe(1492);
  });

  it("asymmetric K: new engine adjusts more than established engine", () => {
    // New engine (K=64) beats established engine (K=16)
    const [newA, newB] = calculateElo(1500, 1500, 1, 5, 60);
    const gainA = newA - 1500;
    const lossB = 1500 - newB;
    // New engine gains 32, established loses only 8
    expect(Math.round(gainA)).toBe(32);
    expect(Math.round(lossB)).toBe(8);
  });

  it("draw between equal players changes nothing regardless of K", () => {
    const [newA, newB] = calculateElo(1500, 1500, 0.5, 0, 0);
    expect(newA).toBe(1500);
    expect(newB).toBe(1500);
  });

  it("upset win gives larger rating change", () => {
    const [newA] = calculateElo(1200, 1800, 1, 5, 5);
    const gain = newA - 1200;
    // K=64, expected ~0.03, gain ≈ 64*0.97 ≈ 62
    expect(gain).toBeGreaterThan(50);
  });

  it("expected win gives smaller rating change", () => {
    const [newA] = calculateElo(1800, 1200, 1, 5, 5);
    const gain = newA - 1800;
    // K=64, expected ~0.97, gain ≈ 64*0.03 ≈ 2
    expect(gain).toBeLessThan(10);
  });

  it("defaults to K=32 when games not specified", () => {
    const [newA, newB] = calculateElo(1500, 1500, 1);
    expect(Math.round(newA)).toBe(1516);
    expect(Math.round(newB)).toBe(1484);
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
