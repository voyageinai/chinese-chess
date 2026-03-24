/* eslint-disable @typescript-eslint/no-explicit-any */
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

  it("go() parses depth, nodes, pv from info lines", async () => {
    const engine = new UciEngine("/fake/path");

    // Simulate the go() call by directly triggering line events
    const promise = engine.go("position fen ...", {
      wtime: 60000,
      btime: 60000,
      winc: 1000,
      binc: 1000,
    });

    // Override send to be a no-op (no real process)
    (engine as any).send = () => {};

    // Simulate engine output
    engine.emit("line", "info depth 20 seldepth 25 score cp 45 nodes 1234567 pv h2e2 h9g7 c3c4");
    engine.emit("line", "info depth 30 seldepth 35 score cp 52 nodes 9876543 pv h2e2 h9g7 c3c4 b9c7");
    engine.emit("line", "bestmove h2e2");

    const result = await promise;
    expect(result.bestmove).toBe("h2e2");
    expect(result.eval).toBe(52); // last info line's score
    expect(result.depth).toBe(30);
    expect(result.nodes).toBe(9876543);
    expect(result.pv).toBe("h2e2 h9g7 c3c4 b9c7");
  });

  it("go() returns null depth/nodes/pv when engine provides none", async () => {
    const engine = new UciEngine("/fake/path");
    (engine as any).send = () => {};

    const promise = engine.go("position fen ...", {
      wtime: 60000,
      btime: 60000,
      winc: 1000,
      binc: 1000,
    });

    engine.emit("line", "bestmove h2e2");

    const result = await promise;
    expect(result.bestmove).toBe("h2e2");
    expect(result.eval).toBeNull();
    expect(result.depth).toBeNull();
    expect(result.nodes).toBeNull();
    expect(result.pv).toBeNull();
  });

  it("go() timeout cleans up handler (no leak)", async () => {
    const engine = new UciEngine("/fake/path");
    (engine as any).send = () => {};

    const listenersBefore = engine.listenerCount("line");

    const promise = engine.go("position fen ...", {
      wtime: 60000,
      btime: 60000,
      winc: 1000,
      binc: 1000,
    });

    // One handler should be attached
    expect(engine.listenerCount("line")).toBe(listenersBefore + 1);

    // Simulate bestmove to resolve
    engine.emit("line", "bestmove e2e4");
    await promise;

    // Handler should be cleaned up
    expect(engine.listenerCount("line")).toBe(listenersBefore);
  });

  it("go() parses mate scores correctly", async () => {
    const engine = new UciEngine("/fake/path");
    (engine as any).send = () => {};

    const promise = engine.go("position fen ...", {
      wtime: 60000,
      btime: 60000,
      winc: 1000,
      binc: 1000,
    });

    engine.emit("line", "info depth 40 score mate 3 nodes 5000000 pv h2e2");
    engine.emit("line", "bestmove h2e2");

    const result = await promise;
    expect(result.eval).toBe(30000);
    expect(result.depth).toBe(40);
    expect(result.nodes).toBe(5000000);
  });
});
