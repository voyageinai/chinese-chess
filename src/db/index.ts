import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import { SCHEMA } from "./schema";

let db: Database.Database | null = null;

const SYSTEM_USER_ID = "__system__";

export function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const resolvedPath = dbPath || path.join(process.cwd(), "cnchess.db");
    db = new Database(resolvedPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    seedDefaultEngines(db);
  }
  return db;
}

function seedDefaultEngines(database: Database.Database): void {
  const defaultDir = path.join(process.cwd(), "data", "default-engines");
  if (!fs.existsSync(defaultDir)) return;

  // Ensure system user exists (no password — cannot log in)
  const sysUser = database
    .prepare("SELECT id FROM users WHERE id = ?")
    .get(SYSTEM_USER_ID);
  if (!sysUser) {
    database
      .prepare(
        "INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)",
      )
      .run(SYSTEM_USER_ID, "系统默认", "!nologin", "admin");
  }

  // Scan for executable engine binaries (skip .nnue and other non-binary files)
  const files = fs.readdirSync(defaultDir).filter((f) => {
    const fullPath = path.join(defaultDir, f);
    if (!fs.statSync(fullPath).isFile()) return false;
    if (f.endsWith(".nnue") || f.endsWith(".md") || f.endsWith(".txt"))
      return false;
    try {
      fs.accessSync(fullPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

  for (const file of files) {
    const binaryPath = path.join(defaultDir, file);
    const existing = database
      .prepare(
        "SELECT id FROM engines WHERE user_id = ? AND binary_path = ?",
      )
      .get(SYSTEM_USER_ID, binaryPath);

    if (!existing) {
      // Pretty-format engine name: "fairy-stockfish-nnue" → "Fairy-Stockfish-NNUE"
      const ENGINE_NAME_MAP: Record<string, string> = {
        pikafish: "Pikafish",
        "fairy-stockfish-nnue": "Fairy-Stockfish NNUE",
        "fairy-stockfish-classic": "Fairy-Stockfish Classic",
      };
      const engineName =
        ENGINE_NAME_MAP[file] ||
        file
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join("-");
      database
        .prepare(
          "INSERT INTO engines (id, user_id, name, binary_path) VALUES (?, ?, ?, ?)",
        )
        .run(nanoid(), SYSTEM_USER_ID, engineName, binaryPath);
      console.log(`[seed] Registered default engine: ${engineName}`);
    }
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
