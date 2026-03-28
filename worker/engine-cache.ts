import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  readdirSync,
  statSync,
} from "fs";
import { execSync } from "child_process";
import path from "path";
import type { ApiClient } from "./api-client";
import type { EngineRef } from "../src/server/distributed/types";

export class EngineCache {
  private cacheDir: string;
  private apiClient: ApiClient;
  private inflight = new Map<string, Promise<string>>();

  constructor(cacheDir: string, apiClient: ApiClient) {
    this.cacheDir = cacheDir;
    this.apiClient = apiClient;
    mkdirSync(cacheDir, { recursive: true });
  }

  /**
   * Ensure engine files are available locally.
   * Returns the absolute path to the engine binary.
   */
  async ensureEngine(engine: EngineRef): Promise<string> {
    const existing = this.inflight.get(engine.id);
    if (existing) {
      return existing;
    }

    const pending = this.ensureEngineOnce(engine).finally(() => {
      this.inflight.delete(engine.id);
    });
    this.inflight.set(engine.id, pending);
    return pending;
  }

  private async ensureEngineOnce(engine: EngineRef): Promise<string> {
    const engineDir = path.join(this.cacheDir, engine.id);
    const hashFile = path.join(engineDir, "sha256.txt");

    // Check if cached and hash matches
    if (existsSync(hashFile)) {
      const cachedHash = readFileSync(hashFile, "utf-8").trim();
      if (cachedHash === engine.contentHash) {
        const binaryPath = this.findBinary(engineDir, engine.name);
        if (binaryPath) return binaryPath;
      }
    }

    // Download from master
    console.log(
      `[cache] Downloading engine ${engine.name} (${engine.id})...`,
    );
    const result = await this.apiClient.downloadEngine(engine.id);

    if (result.notModified) {
      // Shouldn't happen if hash was different, but be safe
      const binaryPath = this.findBinary(engineDir, engine.name);
      if (binaryPath) return binaryPath;
    }

    if (!result.data) {
      throw new Error(`Failed to download engine ${engine.id}`);
    }

    // Clean existing cache for this engine
    if (existsSync(engineDir)) {
      execSync(`rm -rf "${engineDir}"`);
    }
    mkdirSync(engineDir, { recursive: true });

    if (result.isDirectory) {
      // Extract tar.gz archive
      const tarPath = path.join(engineDir, "_archive.tar.gz");
      writeFileSync(tarPath, result.data);
      execSync(`tar xzf "${tarPath}" -C "${engineDir}"`);
      execSync(`rm -f "${tarPath}"`);
    } else {
      // Write single file
      const filePath = path.join(engineDir, result.filename);
      writeFileSync(filePath, result.data);
    }

    // Set executable permissions on all non-data files
    const dataExtensions = new Set([".nnue", ".bin", ".txt", ".md", ".json", ".npz", ".gz"]);
    for (const file of readdirSync(engineDir)) {
      const filePath = path.join(engineDir, file);
      const stat = statSync(filePath);
      if (stat.isFile()) {
        const ext = path.extname(file).toLowerCase();
        if (!dataExtensions.has(ext)) {
          chmodSync(filePath, 0o755);
        }
      }
    }

    // Write hash file
    writeFileSync(hashFile, result.hash);

    console.log(
      `[cache] Engine ${engine.name} cached (${(result.data.length / 1024 / 1024).toFixed(1)}MB)`,
    );

    const binaryPath = this.findBinary(engineDir, engine.name);
    if (!binaryPath) {
      throw new Error(
        `Downloaded engine ${engine.id} but could not find binary in ${engineDir}`,
      );
    }
    return binaryPath;
  }

  /**
   * Find the main binary/script in an engine directory.
   * Skips sha256.txt and .nnue files.
   */
  private findBinary(dir: string, engineName: string): string | null {
    const files = readdirSync(dir).filter(
      (f) =>
        f !== "sha256.txt" &&
        !f.endsWith(".nnue") &&
        !f.startsWith(".") &&
        !f.startsWith("_"),
    ).sort();

    if (files.length === 0) return null;

    const preferred = this.normalize(engineName);
    if (preferred) {
      const exact = files.find((file) => this.normalize(path.parse(file).name) === preferred);
      if (exact) {
        return path.resolve(dir, exact);
      }

      const partial = files.find((file) => {
        const normalized = this.normalize(path.parse(file).name);
        return normalized.includes(preferred) || preferred.includes(normalized);
      });
      if (partial) {
        return path.resolve(dir, partial);
      }
    }

    // Prefer files with script extensions, then any executable
    for (const ext of [".py", ".js"]) {
      const script = files.find((f) => f.endsWith(ext));
      if (script) return path.resolve(dir, script);
    }

    // Return the first non-data file (likely the binary)
    for (const f of files) {
      const filePath = path.resolve(dir, f);
      try {
        const stat = statSync(filePath);
        if (stat.isFile()) return filePath;
      } catch {
        // skip
      }
    }

    return null;
  }

  private normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
}
