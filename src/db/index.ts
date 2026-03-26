import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import { SCHEMA } from "./schema";

let db: Database.Database | null = null;

const SYSTEM_USER_ID = "__system__";
const DEFAULT_DB_PATH = path.join(process.cwd(), "cnchess.db");

export function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const resolvedPath = dbPath || DEFAULT_DB_PATH;
    db = new Database(resolvedPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    runMigrations(db);
    if (!dbPath) {
      seedDefaultEngines(db);
    }
  }
  return db;
}

function ensureSystemUser(database: Database.Database): void {
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
}

function hasColumn(
  database: Database.Database,
  table: string,
  column: string,
): boolean {
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function pickDefaultTournamentOwner(database: Database.Database): string | null {
  const nonSystemAdmin = database
    .prepare(
      "SELECT id FROM users WHERE role = 'admin' AND id != ? ORDER BY created_at ASC LIMIT 1",
    )
    .get(SYSTEM_USER_ID) as { id: string } | undefined;
  if (nonSystemAdmin) return nonSystemAdmin.id;

  const anyAdmin = database
    .prepare(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1",
    )
    .get() as { id: string } | undefined;
  if (anyAdmin) return anyAdmin.id;

  const anyUser = database
    .prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
    .get() as { id: string } | undefined;
  return anyUser?.id ?? null;
}

function runMigrations(database: Database.Database): void {
  if (!hasColumn(database, "engines", "visibility")) {
    database.exec(
      "ALTER TABLE engines ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'",
    );
  }
  database.exec("UPDATE engines SET visibility = 'public' WHERE visibility IS NULL");

  if (!hasColumn(database, "tournaments", "owner_id")) {
    database.exec("ALTER TABLE tournaments ADD COLUMN owner_id TEXT");
  }

  const defaultOwnerId = pickDefaultTournamentOwner(database);
  if (defaultOwnerId) {
    database
      .prepare(
        "UPDATE tournaments SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''",
      )
      .run(defaultOwnerId);
  }

  // -- v3: Add status columns and new tables --
  if (!hasColumn(database, "users", "status")) {
    database.exec(
      "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    );
  }

  if (!hasColumn(database, "engines", "status")) {
    database.exec(
      "ALTER TABLE engines ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    );
  }

  if (!hasColumn(database, "games", "result_reason")) {
    database.exec("ALTER TABLE games ADD COLUMN result_reason TEXT");
  }
  if (!hasColumn(database, "games", "result_code")) {
    database.exec("ALTER TABLE games ADD COLUMN result_code TEXT");
  }
  if (!hasColumn(database, "games", "result_detail")) {
    database.exec("ALTER TABLE games ADD COLUMN result_detail TEXT");
  }

  // -- v4: Add win/loss/draw counters to engines --
  if (!hasColumn(database, "engines", "wins")) {
    database.exec(
      "ALTER TABLE engines ADD COLUMN wins INTEGER NOT NULL DEFAULT 0",
    );
    database.exec(
      "ALTER TABLE engines ADD COLUMN losses INTEGER NOT NULL DEFAULT 0",
    );
    database.exec(
      "ALTER TABLE engines ADD COLUMN draws INTEGER NOT NULL DEFAULT 0",
    );
    // Backfill from games table
    database.exec(`
      UPDATE engines SET
        wins = COALESCE((
          SELECT COUNT(*) FROM games
          WHERE (red_engine_id = engines.id AND result = 'red')
             OR (black_engine_id = engines.id AND result = 'black')
        ), 0),
        losses = COALESCE((
          SELECT COUNT(*) FROM games
          WHERE (red_engine_id = engines.id AND result = 'black')
             OR (black_engine_id = engines.id AND result = 'red')
        ), 0),
        draws = COALESCE((
          SELECT COUNT(*) FROM games
          WHERE (red_engine_id = engines.id OR black_engine_id = engines.id)
            AND result = 'draw'
        ), 0)
    `);
  }

  // -- v4b: Reconcile games_played with actual game count --
  // games_played may be stale due to server restarts during tournaments;
  // W/L/D (backfilled from games table) is the source of truth.
  database.exec(
    "UPDATE engines SET games_played = wins + losses + draws WHERE games_played != wins + losses + draws",
  );

  // -- v5: Add type column to tournaments --
  if (!hasColumn(database, "tournaments", "type")) {
    database.exec(
      "ALTER TABLE tournaments ADD COLUMN type TEXT NOT NULL DEFAULT 'tournament'",
    );
  }

  // -- v6: Opening FEN support + game indexes --
  if (!hasColumn(database, "games", "opening_fen")) {
    database.exec("ALTER TABLE games ADD COLUMN opening_fen TEXT");
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_games_red ON games(red_engine_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_engine_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_games_result ON games(result)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_games_finished ON games(finished_at)");

  // -- v7: Elo history tracking + tournament format --
  database.exec(`
    CREATE TABLE IF NOT EXISTS elo_history (
      id TEXT PRIMARY KEY,
      engine_id TEXT NOT NULL REFERENCES engines(id),
      elo REAL NOT NULL,
      game_id TEXT REFERENCES games(id),
      recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  database.exec("CREATE INDEX IF NOT EXISTS idx_elo_history_engine ON elo_history(engine_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_elo_history_time ON elo_history(recorded_at)");

  if (!hasColumn(database, "tournaments", "format")) {
    database.exec("ALTER TABLE tournaments ADD COLUMN format TEXT NOT NULL DEFAULT 'round_robin'");
  }

  if (!hasColumn(database, "games", "round")) {
    database.exec("ALTER TABLE games ADD COLUMN round INTEGER");
  }

  // -- v8: Bracket data for knockout tournaments --
  if (!hasColumn(database, "tournaments", "bracket_data")) {
    database.exec("ALTER TABLE tournaments ADD COLUMN bracket_data TEXT");
  }
}

function seedDefaultEngines(database: Database.Database): void {
  const defaultDir = path.join(process.cwd(), "data", "default-engines");
  if (!fs.existsSync(defaultDir)) return;

  ensureSystemUser(database);

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
          "INSERT INTO engines (id, user_id, name, binary_path, visibility) VALUES (?, ?, ?, ?, 'public')",
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
