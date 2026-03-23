import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { EventEmitter } from "events";

export interface GoOptions {
  wtime: number;
  btime: number;
  winc: number;
  binc: number;
}

export interface GoResult {
  bestmove: string;
  eval: number | null;
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
    this.process = spawn(this.binaryPath, [], {
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
    this.send(
      `go wtime ${options.wtime} btime ${options.btime} winc ${options.winc} binc ${options.binc}`
    );

    let lastEval: number | null = null;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Engine timed out waiting for bestmove"));
      }, 60000);

      const handler = (line: string) => {
        if (line.startsWith("info ") && line.includes("score")) {
          const cpMatch = line.match(/score cp (-?\d+)/);
          const mateMatch = line.match(/score mate (-?\d+)/);
          if (cpMatch) lastEval = parseInt(cpMatch[1], 10);
          else if (mateMatch) lastEval = parseInt(mateMatch[1], 10) > 0 ? 30000 : -30000;
        }

        if (line.startsWith("bestmove")) {
          clearTimeout(timeout);
          this.off("line", handler);
          const move = line.split(" ")[1];
          resolve({ bestmove: move, eval: lastEval });
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
