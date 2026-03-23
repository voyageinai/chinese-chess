import { describe, it, expect } from "vitest";
import { UciEngine } from "../uci";

describe("UciEngine", () => {
  it("can be constructed", () => {
    const engine = new UciEngine("/fake/path");
    expect(engine.name).toBe("Unknown");
  });

  // Note: Full integration tests with a real engine would require
  // a Xiangqi engine binary. These test the class structure.
  it("emits line events on processBuffer", () => {
    const engine = new UciEngine("/fake/path");
    const lines: string[] = [];
    engine.on("line", (line: string) => lines.push(line));

    // Access private method for testing
    (engine as any).buffer = "id name TestEngine\nuciok\n";
    (engine as any).processBuffer();

    expect(lines).toContain("id name TestEngine");
    expect(lines).toContain("uciok");
    expect(engine.name).toBe("TestEngine");
  });
});
