import { describe, it, expect } from "vitest";
import { calculateElo } from "../elo";

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
