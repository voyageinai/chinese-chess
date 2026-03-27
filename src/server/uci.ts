import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { EventEmitter } from "events";

export interface GoOptions {
  wtime: number;
  btime: number;
  winc: number;
  binc: number;
  maxNodes?: number;
}

export interface GoResult {
  bestmove: string;
  eval: number | null;
  depth: number | null;
  nodes: number | null;
  pv: string | null;
}

/**
 * Convert internal FEN piece letters (H=horse, E=elephant) to UCI standard
 * (N=knight, B=bishop) that all engines understand.
 */
function fenToUci(cmd: string): string {
  // Only transform the FEN portion of "position fen ..." commands
  return cmd.replace(
    /^(position fen )(.+)/,
    (_, prefix, fen) =>
      prefix +
      fen
        .replace(/H/g, "N")
        .replace(/h/g, "n")
        .replace(/E/g, "B")
        .replace(/e/g, "b"),
  );
}

/**
 * Parse a UCI move string that may use 0-based (a0-i9) or 1-based (a1-i10) ranks.
 * Returns { fromCol, fromRank, toCol, toRank } with raw rank numbers as-is.
 */
function parseRawUciMove(uci: string): {
  fromCol: number;
  fromRank: number;
  toCol: number;
  toRank: number;
} {
  // Moves can be 4-6 chars: e.g. "h2e2" (0-based), "h3e3" (1-based), "a10b10" (1-based rank 10)
  const m = uci.match(/^([a-i])(\d{1,2})([a-i])(\d{1,2})$/);
  if (!m) throw new Error(`Invalid UCI move: ${uci}`);
  return {
    fromCol: m[1].charCodeAt(0) - 97,
    fromRank: parseInt(m[2], 10),
    toCol: m[3].charCodeAt(0) - 97,
    toRank: parseInt(m[4], 10),
  };
}

/**
 * Determine how to spawn an engine based on file extension.
 * .py  → python3 <path>
 * .js  → node <path>
 * else → execute directly as native binary
 */
function resolveSpawnArgs(enginePath: string): { cmd: string; args: string[] } {
  const ext = path.extname(enginePath).toLowerCase();
  // nice -n 15: lower priority so Node.js server stays responsive
  // taskset -c 2,3: pin engines to cores 2-3, leave 0-1 for server/system
  if (ext === ".py") return { cmd: "nice", args: ["-n", "15", "taskset", "-c", "2,3", "python3", enginePath] };
  if (ext === ".js") return { cmd: "nice", args: ["-n", "15", "taskset", "-c", "2,3", "node", enginePath] };
  return { cmd: "nice", args: ["-n", "15", "taskset", "-c", "2,3", enginePath] };
}

export class UciEngine extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = "";
  public name = "Unknown";
  private binaryPath: string;
  /**
   * true if engine uses 1-based ranks (1-10) like Fairy-Stockfish xiangqi.
   * Detected during init by presence of UCI_Variant option.
   */
  public rankOneBased = false;
  private hasVariantOption = false;

  constructor(binaryPath: string) {
    super();
    this.binaryPath = binaryPath;
  }

  async init(): Promise<void> {
    const { cmd, args } = resolveSpawnArgs(this.binaryPath);
    this.process = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.dirname(this.binaryPath),
    });

    this.process.stdout!.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.on("error", (err) => {
      this.emit("error", err);
    });

    this.process.on("exit", (code) => {
      this.emit("exit", code);
    });

    this.send("uci");
    await this.waitFor("uciok");

    // Engines that advertise UCI_Variant (like Fairy-Stockfish) use 1-based ranks
    // for xiangqi (1-10). Pure xiangqi engines (Pikafish) use 0-based (0-9).
    if (this.hasVariantOption) {
      this.rankOneBased = true;
      this.send("setoption name UCI_Variant value xiangqi");
    }

    // Force single-threaded + small hash for fairness across engine types
    this.send("setoption name Threads value 1");
    this.send("setoption name Hash value 16");

    this.send("isready");
    await this.waitFor("readyok");
  }

  send(command: string): void {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(command + "\n");
  }

  /**
   * Convert an engine UCI move (e.g. "h3e3" in 1-based or "h2e2" in 0-based)
   * to internal board squares { from, to } where row 0 = top (black back rank).
   */
  uciMoveToSquares(uciMove: string): { from: number; to: number } {
    const { fromCol, fromRank, toCol, toRank } = parseRawUciMove(uciMove);
    const offset = this.rankOneBased ? 10 : 9;
    const fromRow = offset - fromRank;
    const toRow = offset - toRank;
    return { from: fromRow * 9 + fromCol, to: toRow * 9 + toCol };
  }

  /**
   * Convert internal board squares to a UCI move string in this engine's coordinate system.
   */
  squaresToUciMove(from: number, to: number): string {
    const offset = this.rankOneBased ? 10 : 9;
    const fromCol = String.fromCharCode(97 + (from % 9));
    const fromRank = offset - Math.floor(from / 9);
    const toCol = String.fromCharCode(97 + (to % 9));
    const toRank = offset - Math.floor(to / 9);
    return `${fromCol}${fromRank}${toCol}${toRank}`;
  }

  async go(positionCommand: string, options: GoOptions): Promise<GoResult> {
    // Normalize FEN piece letters: our internal format uses H(horse)/E(elephant)
    // but UCI standard (Pikafish, Fairy-Stockfish) uses N(knight)/B(bishop)
    this.send(fenToUci(positionCommand));
    let goCmd = `go wtime ${options.wtime} btime ${options.btime} winc ${options.winc} binc ${options.binc}`;
    if (options.maxNodes && options.maxNodes > 0) {
      goCmd += ` nodes ${options.maxNodes}`;
    }
    this.send(goCmd);

    let lastEval: number | null = null;
    let lastDepth: number | null = null;
    let lastNodes: number | null = null;
    let lastPv: string | null = null;

    let lastThinkingEmit = 0;
    const THINKING_THROTTLE_MS = 500;

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.off("line", handler);
      };

      const maxTime = Math.max(
        Math.max(options.wtime, options.btime) + Math.max(options.winc, options.binc) + 5000,
        10000,
      );
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Engine timed out waiting for bestmove"));
      }, maxTime);

      const handler = (line: string) => {
        if (line.startsWith("info ")) {
          if (line.includes("score")) {
            const cpMatch = line.match(/score cp (-?\d+)/);
            const mateMatch = line.match(/score mate (-?\d+)/);
            if (cpMatch) lastEval = parseInt(cpMatch[1], 10);
            else if (mateMatch) lastEval = parseInt(mateMatch[1], 10) > 0 ? 30000 : -30000;
          }
          const depthMatch = line.match(/\bdepth (\d+)/);
          if (depthMatch) lastDepth = parseInt(depthMatch[1], 10);
          const nodesMatch = line.match(/\bnodes (\d+)/);
          if (nodesMatch) lastNodes = parseInt(nodesMatch[1], 10);
          const pvMatch = line.match(/\bpv (.+)/);
          if (pvMatch) lastPv = pvMatch[1].trim();

          // Throttled thinking event for live PV display
          const now = Date.now();
          if (now - lastThinkingEmit >= THINKING_THROTTLE_MS && lastDepth !== null) {
            lastThinkingEmit = now;
            this.emit("thinking", {
              depth: lastDepth,
              eval: lastEval,
              nodes: lastNodes,
              pv: lastPv,
            });
          }
        }

        if (line.startsWith("bestmove")) {
          cleanup();
          const move = line.split(" ")[1];
          resolve({ bestmove: move, eval: lastEval, depth: lastDepth, nodes: lastNodes, pv: lastPv });
        }
      };

      this.on("line", handler);
    });
  }

  stop(): void {
    this.send("stop");
  }

  quit(): void {
    this.send("quit");
    setTimeout(() => {
      this.process?.kill();
      this.process = null;
    }, 1000);
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("id name ")) {
        this.name = trimmed.slice(8);
      }

      // Detect multi-variant engine by UCI_Variant option
      if (trimmed.includes("option name UCI_Variant")) {
        this.hasVariantOption = true;
      }

      this.emit("line", trimmed);
    }
  }

  private waitFor(token: string, timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off("line", handler);
        reject(new Error(`Timeout waiting for ${token}`));
      }, timeoutMs);

      const handler = (line: string) => {
        if (line.startsWith(token)) {
          clearTimeout(timeout);
          this.off("line", handler);
          resolve();
        }
      };

      this.on("line", handler);
    });
  }
}
