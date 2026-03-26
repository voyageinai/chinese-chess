import { createHash } from "crypto";
import {
  statSync,
  readdirSync,
  readFileSync,
} from "fs";
import path from "path";
import { execSync } from "child_process";
import { getEngineById } from "@/db/queries";

// In-memory cache: engineId → contentHash
const hashCache = new Map<string, { hash: string; mtime: number }>();

/**
 * Compute a SHA256 hash of all files in the engine's directory.
 * Caches the result by mtime so repeated calls are fast.
 */
export function getEngineContentHash(engineId: string): string | null {
  const engine = getEngineById(engineId);
  if (!engine) return null;

  const engineDir = path.dirname(engine.binary_path);
  let stat;
  try {
    stat = statSync(engine.binary_path);
  } catch {
    return null;
  }

  const cached = hashCache.get(engineId);
  if (cached && cached.mtime === stat.mtimeMs) {
    return cached.hash;
  }

  // Hash all files in the engine directory
  const hash = createHash("sha256");
  const files = readdirSync(engineDir).sort();
  for (const file of files) {
    const filePath = path.join(engineDir, file);
    try {
      const fileStat = statSync(filePath);
      if (!fileStat.isFile()) continue;
      hash.update(`${file}:${fileStat.size}:`);
      if (fileStat.size < 10 * 1024 * 1024) {
        hash.update(readFileSync(filePath));
      } else {
        // For large files (NNUE etc.), use size+mtime as proxy
        hash.update(`${fileStat.mtimeMs}`);
      }
    } catch {
      // skip unreadable files
    }
  }

  const result = `sha256:${hash.digest("hex")}`;
  hashCache.set(engineId, { hash: result, mtime: stat.mtimeMs });
  return result;
}

/**
 * Check if the engine directory contains more than just the binary.
 */
export function isEngineDirectory(engineId: string): boolean {
  const engine = getEngineById(engineId);
  if (!engine) return false;
  const engineDir = path.dirname(engine.binary_path);
  try {
    return readdirSync(engineDir).filter((f) => {
      const s = statSync(path.join(engineDir, f));
      return s.isFile();
    }).length > 1;
  } catch {
    return false;
  }
}

/**
 * Get the engine's binary filename (basename only).
 */
export function getEngineFilename(engineId: string): string | null {
  const engine = getEngineById(engineId);
  if (!engine) return null;
  return path.basename(engine.binary_path);
}

/**
 * Create a tar.gz buffer of the engine's directory (using system tar).
 * For single-file engines, returns the raw file buffer.
 */
export function packEngineFiles(engineId: string): Buffer | null {
  const engine = getEngineById(engineId);
  if (!engine) return null;

  const engineDir = path.dirname(engine.binary_path);
  const isDir = isEngineDirectory(engineId);

  if (isDir) {
    // Use system tar to create a gzipped archive preserving permissions
    try {
      return execSync(`tar czf - -C "${engineDir}" .`, {
        maxBuffer: 200 * 1024 * 1024, // 200MB
      });
    } catch {
      return null;
    }
  } else {
    try {
      return readFileSync(engine.binary_path);
    } catch {
      return null;
    }
  }
}
