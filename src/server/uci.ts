import { spawn, type ChildProcess } from "child_process";
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

export class UciEngine extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = "";
  public name = "Unknown";
  private binaryPath: string;

  constructor(binaryPath: string) {
    super();
    this.binaryPath = binaryPath;
  }

  async init(): Promise<void> {
    this.process = spawn(this.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
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

    // Set xiangqi variant for multi-variant engines (e.g. Fairy-Stockfish)
    this.send("setoption name UCI_Variant value xiangqi");

    this.send("isready");
    await this.waitFor("readyok");
  }

  send(command: string): void {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(command + "\n");
  }

  async go(positionCommand: string, options: GoOptions): Promise<GoResult> {
    this.send(positionCommand);
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
