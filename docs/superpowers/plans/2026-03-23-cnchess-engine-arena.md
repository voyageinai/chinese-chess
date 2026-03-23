# Chinese Chess Engine Arena — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted Chinese Chess (Xiangqi) engine tournament platform with real-time board visualization, Elo leaderboard, and game replay.

**Architecture:** Single-process Next.js app with custom server.ts for WebSocket support. SQLite for persistence. UCI protocol over child_process for engine communication. Paper/宣纸 aesthetic with Tailwind + shadcn/ui.

**Tech Stack:** Next.js 15 (App Router) · TypeScript · SQLite (better-sqlite3) · WebSocket (ws) · chessgroundx · shadcn/ui · Tailwind CSS · Recharts · bcrypt · jsonwebtoken · nanoid

**Spec:** `docs/superpowers/specs/2026-03-23-cnchess-engine-arena-design.md`

---

## File Map

### Shared / Core
| File | Responsibility |
|------|---------------|
| `src/lib/types.ts` | All shared TypeScript types and enums |
| `src/lib/fen.ts` | FEN string parse/serialize for Xiangqi |
| `src/lib/constants.ts` | Board dimensions, initial FEN, piece chars |

### Rules Engine
| File | Responsibility |
|------|---------------|
| `src/server/rules.ts` | Move generation, validation, checkmate/stalemate/draw detection |
| `src/server/__tests__/rules.test.ts` | Unit tests for rules engine |

### Database
| File | Responsibility |
|------|---------------|
| `src/db/index.ts` | Database singleton, init, migrations |
| `src/db/schema.ts` | SQL CREATE TABLE statements |
| `src/db/queries.ts` | All SQL query functions (CRUD for each table) |
| `src/db/__tests__/queries.test.ts` | Query integration tests |

### Auth
| File | Responsibility |
|------|---------------|
| `src/server/auth.ts` | Register, login, JWT sign/verify, middleware |
| `src/server/__tests__/auth.test.ts` | Auth unit tests |

### Engine Management
| File | Responsibility |
|------|---------------|
| `src/server/uci.ts` | UCI protocol driver: spawn, send commands, parse responses |
| `src/server/match.ts` | Single game orchestration between two engines |
| `src/server/tournament.ts` | Round robin scheduling, game dispatch, result aggregation |
| `src/server/elo.ts` | Elo rating calculation |
| `src/server/ws.ts` | WebSocket hub: broadcast game events to connected clients |
| `src/server/__tests__/uci.test.ts` | UCI driver tests (with mock engine) |
| `src/server/__tests__/match.test.ts` | Match engine tests |
| `src/server/__tests__/tournament.test.ts` | Tournament scheduling tests |
| `src/server/__tests__/elo.test.ts` | Elo calculation tests |

### Custom Server
| File | Responsibility |
|------|---------------|
| `server.ts` | Custom Node.js server wrapping Next.js + WebSocket upgrade |

### API Routes
| File | Responsibility |
|------|---------------|
| `src/app/api/auth/register/route.ts` | POST register |
| `src/app/api/auth/login/route.ts` | POST login |
| `src/app/api/auth/me/route.ts` | GET current user |
| `src/app/api/engines/route.ts` | GET list, POST upload |
| `src/app/api/engines/[id]/route.ts` | GET detail, DELETE |
| `src/app/api/tournaments/route.ts` | GET list, POST create |
| `src/app/api/tournaments/[id]/route.ts` | GET detail, POST start, PUT add engine |
| `src/app/api/tournaments/[id]/games/route.ts` | GET games for tournament |
| `src/app/api/games/[id]/route.ts` | GET game detail (moves, result) |
| `src/app/api/leaderboard/route.ts` | GET global Elo leaderboard |

### Frontend Pages
| File | Responsibility |
|------|---------------|
| `src/app/layout.tsx` | Root layout with Paper theme, fonts, nav |
| `src/app/page.tsx` | Home: leaderboard + live games + recent tournaments |
| `src/app/tournaments/page.tsx` | Tournament list |
| `src/app/tournaments/[id]/page.tsx` | Tournament detail with cross table |
| `src/app/games/[id]/page.tsx` | Game view: live board + replay |
| `src/app/engines/page.tsx` | Engine management + upload |
| `src/app/(auth)/login/page.tsx` | Login form |
| `src/app/(auth)/register/page.tsx` | Register form |

### Frontend Components
| File | Responsibility |
|------|---------------|
| `src/components/Board.tsx` | chessgroundx wrapper for Xiangqi |
| `src/components/MoveList.tsx` | Move history with click-to-navigate |
| `src/components/EvalChart.tsx` | Recharts evaluation curve |
| `src/components/CrossTable.tsx` | Tournament cross table grid |
| `src/components/Leaderboard.tsx` | Elo ranking table |
| `src/components/Navbar.tsx` | Top navigation bar |
| `src/components/GameCard.tsx` | Summary card for a game (used in lists) |
| `src/components/TournamentCard.tsx` | Summary card for a tournament |

### Config
| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript config |
| `next.config.ts` | Next.js config |
| `tailwind.config.ts` | Tailwind theme with Paper palette |
| `postcss.config.mjs` | PostCSS for Tailwind |
| `.env.example` | Example environment variables |
| `vitest.config.ts` | Test runner config |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.env.example`, `vitest.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

- [ ] **Step 1: Initialize Next.js project**

```bash
cd /Users/416c/code/game/cnchess
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

Accept defaults. This creates the base project structure.

- [ ] **Step 2: Install core dependencies**

```bash
npm install better-sqlite3 ws nanoid bcryptjs jsonwebtoken chessgroundx recharts lucide-react
npm install -D @types/better-sqlite3 @types/ws @types/bcryptjs @types/jsonwebtoken vitest @vitejs/plugin-react
```

- [ ] **Step 3: Install and initialize shadcn/ui**

```bash
npx shadcn@latest init
```

Select: New York style, Neutral base color, CSS variables.

Then install components we'll need:

```bash
npx shadcn@latest add button card input label table tabs badge dialog select toast
```

- [ ] **Step 4: Configure Tailwind with Paper palette**

Update `tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          50: "#faf8f3",
          100: "#f7f3e9",
          200: "#efe8d8",
          300: "#e8ddc5",
          400: "#d4c4a8",
          500: "#b8a88a",
        },
        ink: {
          DEFAULT: "#3d3020",
          light: "#503c1e",
          muted: "#9c8b75",
        },
        vermilion: {
          DEFAULT: "#8b3020",
          light: "#a84030",
        },
      },
      fontFamily: {
        brush: ['"Ma Shan Zheng"', '"Noto Serif SC"', "serif"],
        serif: ['"Noto Serif SC"', "serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
```

- [ ] **Step 5: Set up globals.css with Paper fonts**

Replace `src/app/globals.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: #f7f3e9;
  --color-foreground: #3d3020;
  --font-sans: "Noto Serif SC", serif;
  --font-mono: "JetBrains Mono", monospace;
}

@layer base {
  body {
    background-color: var(--color-background);
    color: var(--color-foreground);
  }
}
```

- [ ] **Step 6: Create .env.example**

```
INVITE_CODE=changeme
JWT_SECRET=changeme-to-random-string
MAX_CONCURRENT_MATCHES=2
ENGINE_UPLOAD_MAX_SIZE_MB=50
```

- [ ] **Step 7: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 8: Create root layout with Paper fonts**

Update `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "象棋擂台",
  description: "中国象棋引擎锦标赛平台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-paper-100 text-ink font-serif antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 9: Create placeholder home page**

Update `src/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="font-brush text-5xl text-ink">象棋擂台</h1>
      <p className="mt-4 text-ink-light">中国象棋引擎锦标赛平台</p>
    </main>
  );
}
```

- [ ] **Step 10: Verify dev server starts**

```bash
npm run dev
```

Expected: Server starts on http://localhost:3000, shows "象棋擂台" title.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with Paper theme and deps"
```

---

## Task 2: Shared Types & Constants

**Files:**
- Create: `src/lib/types.ts`, `src/lib/constants.ts`

- [ ] **Step 1: Create type definitions**

Create `src/lib/types.ts`:

```ts
// -- Piece types --
export type Color = "red" | "black";
export type PieceKind = "k" | "a" | "e" | "r" | "c" | "h" | "p";

export interface Piece {
  color: Color;
  kind: PieceKind;
}

// -- Board --
export type Square = number; // 0-89 (row * 9 + col), row 0 = top (black side)
export type Board = (Piece | null)[];

// -- Moves --
export interface Move {
  from: Square;
  to: Square;
  capture?: Piece;
}

// UCI coordinate format: "a0"-"i9"
export type UciMove = string; // e.g. "h2e2"

// -- Game state --
export interface GameState {
  board: Board;
  turn: Color;
  halfmoveClock: number;
  fullmoveNumber: number;
  moveHistory: UciMove[];
}

// -- Stored move (in games.moves JSON) --
export interface StoredMove {
  move: UciMove;
  fen: string;
  time_ms: number;
  eval: number | null; // centipawns from red perspective, null if unavailable
}

// -- API / DB types --
export interface User {
  id: string;
  username: string;
  role: "admin" | "user";
  created_at: number;
}

export interface Engine {
  id: string;
  user_id: string;
  name: string;
  binary_path: string;
  elo: number;
  games_played: number;
  uploaded_at: number;
}

export interface Tournament {
  id: string;
  name: string;
  status: "pending" | "running" | "finished";
  time_control_base: number;
  time_control_inc: number;
  rounds: number;
  created_at: number;
  finished_at: number | null;
}

export interface TournamentEntry {
  tournament_id: string;
  engine_id: string;
  final_rank: number | null;
  score: number;
}

export interface Game {
  id: string;
  tournament_id: string;
  red_engine_id: string;
  black_engine_id: string;
  result: "red" | "black" | "draw" | null;
  moves: string; // JSON string of StoredMove[]
  red_time_left: number | null;
  black_time_left: number | null;
  started_at: number | null;
  finished_at: number | null;
}

// -- WebSocket messages --
export type WsMessage =
  | { type: "move"; gameId: string; move: UciMove; fen: string; eval: number | null; redTime: number; blackTime: number }
  | { type: "game_start"; gameId: string; redEngine: string; blackEngine: string }
  | { type: "game_end"; gameId: string; result: "red" | "black" | "draw" }
  | { type: "tournament_end"; tournamentId: string };
```

- [ ] **Step 2: Create constants**

Create `src/lib/constants.ts`:

```ts
export const BOARD_ROWS = 10;
export const BOARD_COLS = 9;
export const BOARD_SIZE = BOARD_ROWS * BOARD_COLS; // 90

export const INITIAL_FEN =
  "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w - - 0 1";

// Square helpers
export function rowOf(sq: number): number {
  return Math.floor(sq / BOARD_COLS);
}

export function colOf(sq: number): number {
  return sq % BOARD_COLS;
}

export function makeSquare(row: number, col: number): number {
  return row * BOARD_COLS + col;
}

// UCI coord: col a-i, row 0-9 (0 = bottom for red in UCI, but we use 0=top internally)
// UCI row 0 = our row 9 (red's back rank), UCI row 9 = our row 0 (black's back rank)
export function squareToUci(sq: number): string {
  const col = colOf(sq);
  const row = rowOf(sq);
  const uciCol = String.fromCharCode(97 + col); // 'a' + col
  const uciRow = String(9 - row);
  return uciCol + uciRow;
}

export function uciToSquare(uci: string): number {
  const col = uci.charCodeAt(0) - 97;
  const row = 9 - parseInt(uci[1], 10);
  return makeSquare(row, col);
}

// Piece char mapping (FEN)
export const PIECE_CHARS: Record<string, { color: "red" | "black"; kind: string }> = {
  K: { color: "red", kind: "k" },
  A: { color: "red", kind: "a" },
  E: { color: "red", kind: "e" },
  R: { color: "red", kind: "r" },
  C: { color: "red", kind: "c" },
  H: { color: "red", kind: "h" },
  P: { color: "red", kind: "p" },
  k: { color: "black", kind: "k" },
  a: { color: "black", kind: "a" },
  e: { color: "black", kind: "e" },
  r: { color: "black", kind: "r" },
  c: { color: "black", kind: "c" },
  h: { color: "black", kind: "h" },
  p: { color: "black", kind: "p" },
};

export function pieceToChar(piece: { color: "red" | "black"; kind: string }): string {
  const ch = piece.kind;
  return piece.color === "red" ? ch.toUpperCase() : ch;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts src/lib/constants.ts
git commit -m "feat: add shared types and constants for Xiangqi"
```

---

## Task 3: FEN Parser

**Files:**
- Create: `src/lib/fen.ts`, `src/lib/__tests__/fen.test.ts`

- [ ] **Step 1: Write failing tests for FEN parser**

Create `src/lib/__tests__/fen.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseFen, serializeFen } from "../fen";
import { INITIAL_FEN, BOARD_SIZE } from "../constants";

describe("parseFen", () => {
  it("parses initial position", () => {
    const state = parseFen(INITIAL_FEN);
    expect(state.board).toHaveLength(BOARD_SIZE);
    expect(state.turn).toBe("red");
    expect(state.halfmoveClock).toBe(0);
    expect(state.fullmoveNumber).toBe(1);
  });

  it("places pieces correctly in initial position", () => {
    const state = parseFen(INITIAL_FEN);
    // row 0 (top): r h e a k a e h r (black)
    expect(state.board[0]).toEqual({ color: "black", kind: "r" });
    expect(state.board[4]).toEqual({ color: "black", kind: "k" });
    // row 9 (bottom): R H E A K A E H R (red)
    expect(state.board[81]).toEqual({ color: "red", kind: "r" });
    expect(state.board[85]).toEqual({ color: "red", kind: "k" });
    // row 2: cannons at col 1 and col 7
    expect(state.board[2 * 9 + 1]).toEqual({ color: "black", kind: "c" });
    expect(state.board[2 * 9 + 7]).toEqual({ color: "black", kind: "c" });
  });

  it("parses black-to-move FEN", () => {
    const fen = "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR b - - 1 1";
    const state = parseFen(fen);
    expect(state.turn).toBe("black");
    expect(state.halfmoveClock).toBe(1);
  });
});

describe("serializeFen", () => {
  it("roundtrips initial position", () => {
    const state = parseFen(INITIAL_FEN);
    expect(serializeFen(state)).toBe(INITIAL_FEN);
  });

  it("roundtrips a mid-game position", () => {
    const fen = "r1eakae1r/9/1c2h2c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2H2C1/9/R1EAKAE1R w - - 4 3";
    const state = parseFen(fen);
    expect(serializeFen(state)).toBe(fen);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/__tests__/fen.test.ts
```

Expected: FAIL — module `../fen` not found.

- [ ] **Step 3: Implement FEN parser**

Create `src/lib/fen.ts`:

```ts
import type { Board, Color, GameState, Piece, PieceKind } from "./types";
import { BOARD_COLS, BOARD_SIZE, PIECE_CHARS, pieceToChar } from "./constants";

export function parseFen(fen: string): GameState {
  const parts = fen.split(" ");
  const rows = parts[0].split("/");
  const board: Board = new Array(BOARD_SIZE).fill(null);

  for (let r = 0; r < rows.length; r++) {
    let col = 0;
    for (const ch of rows[r]) {
      if (ch >= "1" && ch <= "9") {
        col += parseInt(ch, 10);
      } else {
        const piece = PIECE_CHARS[ch];
        if (piece) {
          board[r * BOARD_COLS + col] = {
            color: piece.color,
            kind: piece.kind as PieceKind,
          };
        }
        col++;
      }
    }
  }

  return {
    board,
    turn: (parts[1] === "b" ? "black" : "red") as Color,
    halfmoveClock: parseInt(parts[4] || "0", 10),
    fullmoveNumber: parseInt(parts[5] || "1", 10),
    moveHistory: [],
  };
}

export function serializeFen(state: GameState): string {
  const rows: string[] = [];

  for (let r = 0; r < 10; r++) {
    let row = "";
    let empty = 0;
    for (let c = 0; c < BOARD_COLS; c++) {
      const piece = state.board[r * BOARD_COLS + c];
      if (piece) {
        if (empty > 0) {
          row += empty;
          empty = 0;
        }
        row += pieceToChar(piece);
      } else {
        empty++;
      }
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }

  const turn = state.turn === "red" ? "w" : "b";
  return `${rows.join("/")} ${turn} - - ${state.halfmoveClock} ${state.fullmoveNumber}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/fen.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fen.ts src/lib/__tests__/fen.test.ts
git commit -m "feat: add FEN parser and serializer with tests"
```

---

## Task 4: Xiangqi Rules Engine

**Files:**
- Create: `src/server/rules.ts`, `src/server/__tests__/rules.test.ts`

This is the largest logic task. The rules engine must handle: move generation for all 7 piece types, board constraint zones (palace, river), move validation, check detection, checkmate, stalemate, and the "flying general" rule.

- [ ] **Step 1: Write failing tests for move generation**

Create `src/server/__tests__/rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  generateMoves,
  isLegalMove,
  isInCheck,
  isCheckmate,
  isStalemate,
  applyMove,
} from "../rules";
import { parseFen } from "@/lib/fen";
import { INITIAL_FEN, uciToSquare } from "@/lib/constants";

describe("generateMoves", () => {
  it("generates moves from initial position", () => {
    const state = parseFen(INITIAL_FEN);
    const moves = generateMoves(state);
    // Red has 44 legal moves in starting position
    expect(moves.length).toBe(44);
  });

  it("generates rook moves correctly", () => {
    // Rook in open file
    const state = parseFen("4k4/9/9/9/9/9/9/4R4/9/4K4 w - - 0 1");
    const moves = generateMoves(state);
    const rookSq = uciToSquare("e2");
    const rookMoves = moves.filter((m) => m.from === rookSq);
    // Rook can move along file and rank, blocked by own king
    expect(rookMoves.length).toBeGreaterThan(10);
  });

  it("cannon captures require a screen piece", () => {
    const state = parseFen("4k4/9/9/9/4p4/9/9/4C4/9/4K4 w - - 0 1");
    const moves = generateMoves(state);
    const cannonSq = uciToSquare("e2");
    const cannonMoves = moves.filter((m) => m.from === cannonSq);
    // Cannon cannot capture pawn directly without a screen
    const captures = cannonMoves.filter((m) => m.capture);
    expect(captures).toHaveLength(0);
  });

  it("cannon captures with screen piece", () => {
    // Cannon at e2, screen at e5, target at e9 (black king)
    const state = parseFen("4k4/9/9/9/4P4/9/9/4C4/9/4K4 w - - 0 1");
    const moves = generateMoves(state);
    const cannonSq = uciToSquare("e2");
    const cannonMoves = moves.filter((m) => m.from === cannonSq);
    const captures = cannonMoves.filter((m) => m.capture);
    expect(captures.length).toBeGreaterThanOrEqual(1);
  });

  it("king stays within palace", () => {
    const state = parseFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
    const moves = generateMoves(state);
    const kingSq = uciToSquare("e0");
    const kingMoves = moves.filter((m) => m.from === kingSq);
    // King at e0 (center bottom): can go d0, f0, e1
    expect(kingMoves.length).toBe(3);
  });

  it("elephant cannot cross river", () => {
    const state = parseFen("4k4/9/9/9/9/9/9/9/9/2E1K1E2 w - - 0 1");
    const moves = generateMoves(state);
    const elephantSq = uciToSquare("c0");
    const eMoves = moves.filter((m) => m.from === elephantSq);
    // All elephant destinations must be on red side (row >= 5)
    for (const m of eMoves) {
      expect(Math.floor(m.to / 9)).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("isInCheck", () => {
  it("detects check by rook", () => {
    const state = parseFen("4k4/9/9/9/9/9/9/4r4/9/4K4 w - - 0 1");
    expect(isInCheck(state, "red")).toBe(true);
  });

  it("detects flying general rule", () => {
    // Kings face each other on same file with no pieces between
    const state = parseFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
    expect(isInCheck(state, "red")).toBe(true);
    expect(isInCheck(state, "black")).toBe(true);
  });

  it("no check in initial position", () => {
    const state = parseFen(INITIAL_FEN);
    expect(isInCheck(state, "red")).toBe(false);
  });
});

describe("isCheckmate", () => {
  it("detects simple checkmate", () => {
    // Red rook on d9 gives checkmate — black king in corner with no escape
    const state = parseFen("3Rk4/9/9/9/9/9/9/9/9/4K4 b - - 0 1");
    expect(isCheckmate(state)).toBe(true);
  });

  it("initial position is not checkmate", () => {
    const state = parseFen(INITIAL_FEN);
    expect(isCheckmate(state)).toBe(false);
  });
});

describe("applyMove", () => {
  it("applies a move and switches turn", () => {
    const state = parseFen(INITIAL_FEN);
    // Red cannon h2-e2 (炮二平五)
    const from = uciToSquare("h2");
    const to = uciToSquare("e2");
    const newState = applyMove(state, { from, to });
    expect(newState.board[to]).toEqual({ color: "red", kind: "c" });
    expect(newState.board[from]).toBeNull();
    expect(newState.turn).toBe("black");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/__tests__/rules.test.ts
```

Expected: FAIL — module `../rules` not found.

- [ ] **Step 3: Implement rules engine — board helpers**

Create `src/server/rules.ts` with the core board manipulation:

```ts
import type { Board, Color, GameState, Move, Piece, PieceKind, Square } from "@/lib/types";
import { BOARD_COLS, BOARD_ROWS, makeSquare, rowOf, colOf } from "@/lib/constants";

function opponent(color: Color): Color {
  return color === "red" ? "black" : "red";
}

// Palace boundaries
function inPalace(sq: Square, color: Color): boolean {
  const r = rowOf(sq);
  const c = colOf(sq);
  if (c < 3 || c > 5) return false;
  return color === "red" ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
}

// Red side: rows 5-9, Black side: rows 0-4
function onOwnSide(sq: Square, color: Color): boolean {
  const r = rowOf(sq);
  return color === "red" ? r >= 5 : r <= 4;
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS;
}

function findKing(board: Board, color: Color): Square {
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (p && p.color === color && p.kind === "k") return i;
  }
  return -1;
}
```

- [ ] **Step 4: Implement move generation for each piece type**

Append to `src/server/rules.ts`:

```ts
function generatePseudoMoves(state: GameState): Move[] {
  const moves: Move[] = [];
  const { board, turn } = state;

  for (let sq = 0; sq < board.length; sq++) {
    const piece = board[sq];
    if (!piece || piece.color !== turn) continue;

    const r = rowOf(sq);
    const c = colOf(sq);

    switch (piece.kind) {
      case "r": // Rook — slides along rank/file
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          for (let i = 1; ; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;
            if (!inBounds(nr, nc)) break;
            const target = board[makeSquare(nr, nc)];
            if (target) {
              if (target.color !== turn) {
                moves.push({ from: sq, to: makeSquare(nr, nc), capture: target });
              }
              break;
            }
            moves.push({ from: sq, to: makeSquare(nr, nc) });
          }
        }
        break;

      case "c": // Cannon — slides to move, jumps one to capture
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          let foundScreen = false;
          for (let i = 1; ; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;
            if (!inBounds(nr, nc)) break;
            const target = board[makeSquare(nr, nc)];
            if (!foundScreen) {
              if (target) {
                foundScreen = true; // This piece is the screen
              } else {
                moves.push({ from: sq, to: makeSquare(nr, nc) });
              }
            } else {
              if (target) {
                if (target.color !== turn) {
                  moves.push({ from: sq, to: makeSquare(nr, nc), capture: target });
                }
                break;
              }
            }
          }
        }
        break;

      case "h": // Horse — L-shape with leg block
        for (const [dr, dc, lr, lc] of [
          [-2, -1, -1, 0], [-2, 1, -1, 0],
          [2, -1, 1, 0], [2, 1, 1, 0],
          [-1, -2, 0, -1], [-1, 2, 0, 1],
          [1, -2, 0, -1], [1, 2, 0, 1],
        ] as [number, number, number, number][]) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          // Check leg (blocking square)
          if (board[makeSquare(r + lr, c + lc)]) continue;
          const target = board[makeSquare(nr, nc)];
          if (target && target.color === turn) continue;
          moves.push({ from: sq, to: makeSquare(nr, nc), capture: target || undefined });
        }
        break;

      case "e": // Elephant — diagonal 2 with eye block, cannot cross river
        for (const [dr, dc] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          if (!onOwnSide(makeSquare(nr, nc), turn)) continue;
          // Check eye
          if (board[makeSquare(r + dr / 2, c + dc / 2)]) continue;
          const target = board[makeSquare(nr, nc)];
          if (target && target.color === turn) continue;
          moves.push({ from: sq, to: makeSquare(nr, nc), capture: target || undefined });
        }
        break;

      case "a": // Advisor — diagonal 1, stays in palace
        for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          if (!inPalace(makeSquare(nr, nc), turn)) continue;
          const target = board[makeSquare(nr, nc)];
          if (target && target.color === turn) continue;
          moves.push({ from: sq, to: makeSquare(nr, nc), capture: target || undefined });
        }
        break;

      case "k": // King — orthogonal 1, stays in palace
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          if (!inPalace(makeSquare(nr, nc), turn)) continue;
          const target = board[makeSquare(nr, nc)];
          if (target && target.color === turn) continue;
          moves.push({ from: sq, to: makeSquare(nr, nc), capture: target || undefined });
        }
        break;

      case "p": // Pawn — forward 1, after crossing river also sideways
        {
          const forward = turn === "red" ? -1 : 1;
          const nr = r + forward;
          if (inBounds(nr, c)) {
            const target = board[makeSquare(nr, c)];
            if (!target || target.color !== turn) {
              moves.push({ from: sq, to: makeSquare(nr, c), capture: target || undefined });
            }
          }
          // Sideways after crossing river
          if (!onOwnSide(sq, turn)) {
            for (const dc of [-1, 1]) {
              const nc = c + dc;
              if (!inBounds(r, nc)) continue;
              const target = board[makeSquare(r, nc)];
              if (target && target.color === turn) continue;
              moves.push({ from: sq, to: makeSquare(r, nc), capture: target || undefined });
            }
          }
        }
        break;
    }
  }

  return moves;
}
```

- [ ] **Step 5: Implement check detection and flying general rule**

Append to `src/server/rules.ts`:

```ts
export function isInCheck(state: GameState, color: Color): boolean {
  const kingSq = findKing(state.board, color);
  if (kingSq === -1) return true; // King missing = in check

  // Flying general: if both kings on same column with nothing between
  const otherKingSq = findKing(state.board, opponent(color));
  if (otherKingSq !== -1 && colOf(kingSq) === colOf(otherKingSq)) {
    const minR = Math.min(rowOf(kingSq), rowOf(otherKingSq));
    const maxR = Math.max(rowOf(kingSq), rowOf(otherKingSq));
    let clear = true;
    for (let rr = minR + 1; rr < maxR; rr++) {
      if (state.board[makeSquare(rr, colOf(kingSq))]) {
        clear = false;
        break;
      }
    }
    if (clear) return true;
  }

  // Check if any opponent piece attacks the king
  const tempState: GameState = { ...state, turn: opponent(color) };
  const opponentMoves = generatePseudoMoves(tempState);
  return opponentMoves.some((m) => m.to === kingSq);
}
```

- [ ] **Step 6: Implement applyMove and legal move generation**

Append to `src/server/rules.ts`:

```ts
export function applyMove(state: GameState, move: Move): GameState {
  const newBoard = [...state.board];
  newBoard[move.to] = newBoard[move.from];
  newBoard[move.from] = null;

  const isCapture = !!move.capture;
  const isPawn = state.board[move.from]?.kind === "p";

  return {
    board: newBoard,
    turn: opponent(state.turn),
    halfmoveClock: isCapture ? 0 : state.halfmoveClock + 1, // Xiangqi: only captures reset, not pawn moves
    fullmoveNumber: state.turn === "black" ? state.fullmoveNumber + 1 : state.fullmoveNumber,
    moveHistory: [...state.moveHistory],
  };
}

export function generateMoves(state: GameState): Move[] {
  const pseudo = generatePseudoMoves(state);
  // Filter out moves that leave own king in check
  return pseudo.filter((move) => {
    const next = applyMove(state, move);
    return !isInCheck(next, state.turn);
  });
}

export function isCheckmate(state: GameState): boolean {
  if (!isInCheck(state, state.turn)) return false;
  return generateMoves(state).length === 0;
}

export function isStalemate(state: GameState): boolean {
  if (isInCheck(state, state.turn)) return false;
  return generateMoves(state).length === 0;
}

export function isLegalMove(state: GameState, from: Square, to: Square): boolean {
  const moves = generateMoves(state);
  return moves.some((m) => m.from === from && m.to === to);
}
```

- [ ] **Step 7: Run tests**

```bash
npx vitest run src/server/__tests__/rules.test.ts
```

Expected: All tests PASS. Debug any failures — the most likely issues are coordinate system mismatches.

- [ ] **Step 8: Commit**

```bash
git add src/server/rules.ts src/server/__tests__/rules.test.ts
git commit -m "feat: implement Xiangqi rules engine with full move generation"
```

---

## Task 5: Elo Calculator

**Files:**
- Create: `src/server/elo.ts`, `src/server/__tests__/elo.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/__tests__/elo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { calculateElo } from "../elo";

describe("calculateElo", () => {
  it("winner gains, loser loses equal amounts", () => {
    const [newA, newB] = calculateElo(1500, 1500, 1);
    expect(newA).toBeGreaterThan(1500);
    expect(newB).toBeLessThan(1500);
    // For K=32, equal opponents: winner gets +16, loser gets -16
    expect(Math.round(newA)).toBe(1516);
    expect(Math.round(newB)).toBe(1484);
  });

  it("draw between equal players changes nothing", () => {
    const [newA, newB] = calculateElo(1500, 1500, 0.5);
    expect(newA).toBe(1500);
    expect(newB).toBe(1500);
  });

  it("upset win gives larger rating change", () => {
    const [newA, newB] = calculateElo(1200, 1800, 1); // A beats B (upset)
    const gain = newA - 1200;
    expect(gain).toBeGreaterThan(20); // Much more than 16
  });

  it("expected win gives smaller rating change", () => {
    const [newA, newB] = calculateElo(1800, 1200, 1); // A beats B (expected)
    const gain = newA - 1800;
    expect(gain).toBeLessThan(10);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run src/server/__tests__/elo.test.ts
```

- [ ] **Step 3: Implement Elo calculator**

Create `src/server/elo.ts`:

```ts
const K = 32;

/**
 * Calculate new Elo ratings after a game.
 * @param ratingA - Player A's current rating
 * @param ratingB - Player B's current rating
 * @param scoreA - Player A's score: 1 (win), 0.5 (draw), 0 (loss)
 * @returns [newRatingA, newRatingB]
 */
export function calculateElo(
  ratingA: number,
  ratingB: number,
  scoreA: number
): [number, number] {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;
  const scoreB = 1 - scoreA;

  const newA = ratingA + K * (scoreA - expectedA);
  const newB = ratingB + K * (scoreB - expectedB);

  return [newA, newB];
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/server/__tests__/elo.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/elo.ts src/server/__tests__/elo.test.ts
git commit -m "feat: add Elo rating calculator"
```

---

## Task 6: Database Layer

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`, `src/db/queries.ts`, `src/db/__tests__/queries.test.ts`

- [ ] **Step 1: Create SQL schema**

Create `src/db/schema.ts`:

```ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS engines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  binary_path TEXT NOT NULL,
  elo REAL NOT NULL DEFAULT 1500,
  games_played INTEGER NOT NULL DEFAULT 0,
  uploaded_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  time_control_base INTEGER NOT NULL,
  time_control_inc INTEGER NOT NULL,
  rounds INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  engine_id TEXT NOT NULL REFERENCES engines(id),
  final_rank INTEGER,
  score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (tournament_id, engine_id)
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  red_engine_id TEXT NOT NULL REFERENCES engines(id),
  black_engine_id TEXT NOT NULL REFERENCES engines(id),
  result TEXT,
  moves TEXT NOT NULL DEFAULT '[]',
  red_time_left INTEGER,
  black_time_left INTEGER,
  started_at INTEGER,
  finished_at INTEGER
);
`;
```

- [ ] **Step 2: Create database singleton**

Create `src/db/index.ts`:

```ts
import Database from "better-sqlite3";
import path from "path";
import { SCHEMA } from "./schema";

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const resolvedPath = dbPath || path.join(process.cwd(), "cnchess.db");
    db = new Database(resolvedPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

- [ ] **Step 3: Create query functions**

Create `src/db/queries.ts`:

```ts
import { nanoid } from "nanoid";
import { getDb } from "./index";
import type { User, Engine, Tournament, TournamentEntry, Game } from "@/lib/types";

// -- Users --
export function createUser(username: string, passwordHash: string): User {
  const db = getDb();
  const id = nanoid();
  const isFirstUser = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  const role = isFirstUser.count === 0 ? "admin" : "user";
  db.prepare("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)").run(
    id, username, passwordHash, role
  );
  return db.prepare("SELECT id, username, role, created_at FROM users WHERE id = ?").get(id) as User;
}

export function getUserByUsername(username: string): (User & { password: string }) | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | (User & { password: string })
    | undefined;
}

export function getUserById(id: string): User | undefined {
  const db = getDb();
  return db.prepare("SELECT id, username, role, created_at FROM users WHERE id = ?").get(id) as
    | User
    | undefined;
}

// -- Engines --
export function createEngine(userId: string, name: string, binaryPath: string): Engine {
  const db = getDb();
  const id = nanoid();
  db.prepare(
    "INSERT INTO engines (id, user_id, name, binary_path) VALUES (?, ?, ?, ?)"
  ).run(id, userId, name, binaryPath);
  return db.prepare("SELECT * FROM engines WHERE id = ?").get(id) as Engine;
}

export function getEnginesByUser(userId: string): Engine[] {
  const db = getDb();
  return db.prepare("SELECT * FROM engines WHERE user_id = ? ORDER BY uploaded_at DESC").all(userId) as Engine[];
}

export function getEngineById(id: string): Engine | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM engines WHERE id = ?").get(id) as Engine | undefined;
}

export function deleteEngine(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM engines WHERE id = ?").run(id);
}

export function updateEngineElo(id: string, elo: number, gamesPlayed: number): void {
  const db = getDb();
  db.prepare("UPDATE engines SET elo = ?, games_played = ? WHERE id = ?").run(elo, gamesPlayed, id);
}

export function getLeaderboard(): Engine[] {
  const db = getDb();
  return db.prepare(
    "SELECT e.*, u.username as owner FROM engines e JOIN users u ON e.user_id = u.id ORDER BY e.elo DESC"
  ).all() as Engine[];
}

// -- Tournaments --
export function createTournament(
  name: string,
  timeControlBase: number,
  timeControlInc: number,
  rounds: number
): Tournament {
  const db = getDb();
  const id = nanoid();
  db.prepare(
    "INSERT INTO tournaments (id, name, time_control_base, time_control_inc, rounds) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name, timeControlBase, timeControlInc, rounds);
  return db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id) as Tournament;
}

export function getTournaments(): Tournament[] {
  const db = getDb();
  return db.prepare("SELECT * FROM tournaments ORDER BY created_at DESC").all() as Tournament[];
}

export function getTournamentById(id: string): Tournament | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id) as Tournament | undefined;
}

export function updateTournamentStatus(id: string, status: string): void {
  const db = getDb();
  const updates = status === "finished"
    ? db.prepare("UPDATE tournaments SET status = ?, finished_at = unixepoch() WHERE id = ?")
    : db.prepare("UPDATE tournaments SET status = ? WHERE id = ?");
  updates.run(...(status === "finished" ? [status, id] : [status, id]));
}

// -- Tournament Entries --
export function addEngineToTournament(tournamentId: string, engineId: string): void {
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO tournament_entries (tournament_id, engine_id) VALUES (?, ?)"
  ).run(tournamentId, engineId);
}

export function getTournamentEntries(tournamentId: string): (TournamentEntry & { engine_name: string; elo: number })[] {
  const db = getDb();
  return db.prepare(
    `SELECT te.*, e.name as engine_name, e.elo
     FROM tournament_entries te JOIN engines e ON te.engine_id = e.id
     WHERE te.tournament_id = ? ORDER BY te.score DESC`
  ).all(tournamentId) as (TournamentEntry & { engine_name: string; elo: number })[];
}

export function updateTournamentEntry(tournamentId: string, engineId: string, score: number, rank?: number): void {
  const db = getDb();
  if (rank !== undefined) {
    db.prepare(
      "UPDATE tournament_entries SET score = ?, final_rank = ? WHERE tournament_id = ? AND engine_id = ?"
    ).run(score, rank, tournamentId, engineId);
  } else {
    db.prepare(
      "UPDATE tournament_entries SET score = ? WHERE tournament_id = ? AND engine_id = ?"
    ).run(score, tournamentId, engineId);
  }
}

// -- Games --
export function createGame(
  tournamentId: string,
  redEngineId: string,
  blackEngineId: string
): Game {
  const db = getDb();
  const id = nanoid();
  db.prepare(
    "INSERT INTO games (id, tournament_id, red_engine_id, black_engine_id) VALUES (?, ?, ?, ?)"
  ).run(id, tournamentId, redEngineId, blackEngineId);
  return db.prepare("SELECT * FROM games WHERE id = ?").get(id) as Game;
}

export function updateGameResult(
  id: string,
  result: string,
  moves: string,
  redTimeLeft: number,
  blackTimeLeft: number
): void {
  const db = getDb();
  db.prepare(
    `UPDATE games SET result = ?, moves = ?, red_time_left = ?, black_time_left = ?,
     finished_at = unixepoch() WHERE id = ?`
  ).run(result, moves, redTimeLeft, blackTimeLeft, id);
}

export function updateGameStarted(id: string): void {
  const db = getDb();
  db.prepare("UPDATE games SET started_at = unixepoch() WHERE id = ?").run(id);
}

export function getGameById(id: string): Game | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM games WHERE id = ?").get(id) as Game | undefined;
}

export function getGamesByTournament(tournamentId: string): Game[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM games WHERE tournament_id = ? ORDER BY started_at ASC"
  ).all(tournamentId) as Game[];
}

export function getActiveGames(): Game[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM games WHERE result IS NULL AND started_at IS NOT NULL"
  ).all() as Game[];
}
```

- [ ] **Step 4: Write database tests**

Create `src/db/__tests__/queries.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, closeDb } from "../index";
import * as q from "../queries";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "test.db");

beforeEach(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  getDb(TEST_DB);
});

afterEach(() => {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

describe("users", () => {
  it("first user becomes admin", () => {
    const user = q.createUser("alice", "hash123");
    expect(user.role).toBe("admin");
  });

  it("second user is regular user", () => {
    q.createUser("alice", "hash123");
    const bob = q.createUser("bob", "hash456");
    expect(bob.role).toBe("user");
  });
});

describe("engines", () => {
  it("creates and retrieves engine", () => {
    const user = q.createUser("alice", "hash");
    const engine = q.createEngine(user.id, "Pikafish", "/path/to/pikafish");
    expect(engine.elo).toBe(1500);
    expect(engine.name).toBe("Pikafish");

    const retrieved = q.getEngineById(engine.id);
    expect(retrieved?.name).toBe("Pikafish");
  });
});

describe("tournaments", () => {
  it("creates tournament and adds engines", () => {
    const user = q.createUser("alice", "hash");
    const e1 = q.createEngine(user.id, "Engine A", "/a");
    const e2 = q.createEngine(user.id, "Engine B", "/b");
    const t = q.createTournament("Test Cup", 300000, 3000, 2);
    expect(t.status).toBe("pending");

    q.addEngineToTournament(t.id, e1.id);
    q.addEngineToTournament(t.id, e2.id);
    const entries = q.getTournamentEntries(t.id);
    expect(entries).toHaveLength(2);
  });
});

describe("games", () => {
  it("creates and updates game", () => {
    const user = q.createUser("alice", "hash");
    const e1 = q.createEngine(user.id, "A", "/a");
    const e2 = q.createEngine(user.id, "B", "/b");
    const t = q.createTournament("Cup", 300000, 3000, 1);
    const game = q.createGame(t.id, e1.id, e2.id);
    expect(game.result).toBeNull();

    q.updateGameResult(game.id, "red", "[]", 280000, 250000);
    const updated = q.getGameById(game.id);
    expect(updated?.result).toBe("red");
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/db/__tests__/queries.test.ts
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/
git commit -m "feat: add SQLite database layer with schema and queries"
```

---

## Task 7: Auth System

**Files:**
- Create: `src/server/auth.ts`, `src/server/__tests__/auth.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/__tests__/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signToken, verifyToken } from "../auth";

describe("password hashing", () => {
  it("hashes and verifies password", async () => {
    const hash = await hashPassword("secret123");
    expect(hash).not.toBe("secret123");
    expect(await verifyPassword("secret123", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("JWT", () => {
  it("signs and verifies token", () => {
    const token = signToken({ userId: "abc123", role: "admin" });
    const payload = verifyToken(token);
    expect(payload?.userId).toBe("abc123");
    expect(payload?.role).toBe("admin");
  });

  it("returns null for invalid token", () => {
    expect(verifyToken("garbage")).toBeNull();
  });
});
```

- [ ] **Step 2: Implement auth module**

Create `src/server/auth.ts`:

```ts
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { getUserById } from "@/db/queries";
import type { User } from "@/lib/types";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const INVITE_CODE = process.env.INVITE_CODE || "changeme";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface TokenPayload {
  userId: string;
  role: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function validateInviteCode(code: string): boolean {
  return code === INVITE_CODE;
}

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return getUserById(payload.userId) || null;
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/server/__tests__/auth.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/auth.ts src/server/__tests__/auth.test.ts
git commit -m "feat: add auth module with password hashing and JWT"
```

---

## Task 8: UCI Protocol Driver

**Files:**
- Create: `src/server/uci.ts`, `src/server/__tests__/uci.test.ts`

- [ ] **Step 1: Write failing tests with mock engine**

Create `src/server/__tests__/uci.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UciEngine } from "../uci";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

// Mock child_process
function createMockProcess(): ChildProcess & { stdin: { write: ReturnType<typeof vi.fn> }; stdout: EventEmitter } {
  const stdout = new EventEmitter();
  const proc = new EventEmitter() as any;
  proc.stdin = { write: vi.fn() };
  proc.stdout = stdout;
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

vi.mock("child_process", () => ({
  spawn: vi.fn(() => createMockProcess()),
}));

describe("UciEngine", () => {
  it("initializes engine with uci handshake", async () => {
    const { spawn } = await import("child_process");
    const mockProc = (spawn as any)();

    const engine = new UciEngine("/path/to/engine");

    // Simulate engine responding
    setTimeout(() => {
      engine["process"]!.stdout.emit("data", Buffer.from("id name TestEngine\nuciok\n"));
    }, 10);

    await engine.init();
    expect(engine.name).toBe("TestEngine");
  });

  it("parses bestmove response", async () => {
    const engine = new UciEngine("/path/to/engine");
    engine["process"] = createMockProcess() as any;

    setTimeout(() => {
      engine["process"]!.stdout.emit(
        "data",
        Buffer.from("info depth 10 score cp 35 pv h2e2 h9g7\nbestmove h2e2\n")
      );
    }, 10);

    const result = await engine.go("position startpos", {
      wtime: 300000,
      btime: 300000,
      winc: 3000,
      binc: 3000,
    });

    expect(result.bestmove).toBe("h2e2");
    expect(result.eval).toBe(35);
  });
});
```

- [ ] **Step 2: Implement UCI driver**

Create `src/server/uci.ts`:

```ts
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
  eval: number | null; // centipawns
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
      }, 60000); // 60s safety timeout

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
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/server/__tests__/uci.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/uci.ts src/server/__tests__/uci.test.ts
git commit -m "feat: add UCI protocol driver for engine communication"
```

---

## Task 9: Match Engine

**Files:**
- Create: `src/server/match.ts`

- [ ] **Step 1: Implement match engine**

Create `src/server/match.ts`:

```ts
import { UciEngine, type GoOptions } from "./uci";
import { parseFen, serializeFen } from "@/lib/fen";
import { generateMoves, applyMove, isCheckmate, isStalemate, isInCheck } from "./rules";
import { INITIAL_FEN, uciToSquare, squareToUci } from "@/lib/constants";
import type { Color, StoredMove, GameState } from "@/lib/types";
import { EventEmitter } from "events";

export interface MatchConfig {
  redEnginePath: string;
  blackEnginePath: string;
  timeBase: number;    // ms
  timeInc: number;     // ms
  gameId: string;
}

export interface MatchResult {
  result: "red" | "black" | "draw";
  reason: string;
  moves: StoredMove[];
  redTimeLeft: number;
  blackTimeLeft: number;
}

export class Match extends EventEmitter {
  private config: MatchConfig;
  private redEngine: UciEngine | null = null;
  private blackEngine: UciEngine | null = null;
  private aborted = false;

  constructor(config: MatchConfig) {
    super();
    this.config = config;
  }

  async run(): Promise<MatchResult> {
    const { config } = this;
    this.redEngine = new UciEngine(config.redEnginePath);
    this.blackEngine = new UciEngine(config.blackEnginePath);

    try {
      await Promise.all([this.redEngine.init(), this.blackEngine.init()]);
    } catch (err) {
      this.cleanup();
      throw new Error(`Engine init failed: ${err}`);
    }

    let state = parseFen(INITIAL_FEN);
    const moves: StoredMove[] = [];
    let redTime = config.timeBase;
    let blackTime = config.timeBase;
    const moveStrings: string[] = [];
    let consecutiveChecks = { red: 0, black: 0 };
    const positionCounts = new Map<string, number>(); // FEN position part → count (for repetition)

    while (!this.aborted) {
      const currentEngine = state.turn === "red" ? this.redEngine : this.blackEngine;
      const posCmd = moveStrings.length > 0
        ? `position startpos moves ${moveStrings.join(" ")}`
        : "position startpos";

      const goOpts: GoOptions = {
        wtime: redTime,
        btime: blackTime,
        winc: config.timeInc,
        binc: config.timeInc,
      };

      const startTime = Date.now();
      let goResult;
      try {
        goResult = await currentEngine!.go(posCmd, goOpts);
      } catch {
        // Engine crashed or timed out
        this.cleanup();
        return {
          result: state.turn === "red" ? "black" : "red",
          reason: "engine_error",
          moves,
          redTimeLeft: redTime,
          blackTimeLeft: blackTime,
        };
      }
      const elapsed = Date.now() - startTime;

      // Update time
      if (state.turn === "red") {
        redTime = redTime - elapsed + config.timeInc;
      } else {
        blackTime = blackTime - elapsed + config.timeInc;
      }

      // Check timeout
      if (redTime <= 0) {
        this.cleanup();
        return { result: "black", reason: "timeout", moves, redTimeLeft: 0, blackTimeLeft: blackTime };
      }
      if (blackTime <= 0) {
        this.cleanup();
        return { result: "red", reason: "timeout", moves, redTimeLeft: redTime, blackTimeLeft: 0 };
      }

      // Validate move
      const uciMove = goResult.bestmove;
      const from = uciToSquare(uciMove.slice(0, 2));
      const to = uciToSquare(uciMove.slice(2, 4));
      const legalMoves = generateMoves(state);
      const legal = legalMoves.find((m) => m.from === from && m.to === to);

      if (!legal) {
        this.cleanup();
        return {
          result: state.turn === "red" ? "black" : "red",
          reason: "illegal_move",
          moves,
          redTimeLeft: redTime,
          blackTimeLeft: blackTime,
        };
      }

      // Apply move
      state = applyMove(state, legal);
      moveStrings.push(uciMove);
      const fen = serializeFen(state);

      // Eval from red's perspective
      let evalScore = goResult.eval;
      if (evalScore !== null && state.turn === "red") {
        evalScore = -evalScore; // Flip: engine reports from its own perspective
      }

      const storedMove: StoredMove = {
        move: uciMove,
        fen,
        time_ms: elapsed,
        eval: evalScore,
      };
      moves.push(storedMove);

      // Emit move event for WebSocket
      this.emit("move", {
        gameId: config.gameId,
        move: uciMove,
        fen,
        eval: evalScore,
        redTime,
        blackTime,
      });

      // Check for threefold repetition (重复局面)
      const posKey = fen.split(" ").slice(0, 2).join(" "); // board + turn
      const count = (positionCounts.get(posKey) || 0) + 1;
      positionCounts.set(posKey, count);
      if (count >= 3) {
        this.cleanup();
        return { result: "draw", reason: "repetition", moves, redTimeLeft: redTime, blackTimeLeft: blackTime };
      }

      // Check for consecutive checks (长将 rule)
      const opponent = state.turn;
      if (isInCheck(state, opponent)) {
        const checker = state.turn === "red" ? "black" : "red";
        consecutiveChecks[checker]++;
        if (consecutiveChecks[checker] >= 3) {
          this.cleanup();
          return {
            result: opponent,
            reason: "perpetual_check",
            moves,
            redTimeLeft: redTime,
            blackTimeLeft: blackTime,
          };
        }
      } else {
        const checker = state.turn === "red" ? "black" : "red";
        consecutiveChecks[checker] = 0;
      }

      // Checkmate
      if (isCheckmate(state)) {
        this.cleanup();
        return {
          result: state.turn === "red" ? "black" : "red",
          reason: "checkmate",
          moves,
          redTimeLeft: redTime,
          blackTimeLeft: blackTime,
        };
      }

      // Stalemate
      if (isStalemate(state)) {
        this.cleanup();
        return { result: "draw", reason: "stalemate", moves, redTimeLeft: redTime, blackTimeLeft: blackTime };
      }

      // 60-move rule (120 halfmoves)
      if (state.halfmoveClock >= 120) {
        this.cleanup();
        return { result: "draw", reason: "50_move_rule", moves, redTimeLeft: redTime, blackTimeLeft: blackTime };
      }
    }

    this.cleanup();
    return { result: "draw", reason: "aborted", moves, redTimeLeft: redTime, blackTimeLeft: blackTime };
  }

  abort(): void {
    this.aborted = true;
  }

  private cleanup(): void {
    this.redEngine?.quit();
    this.blackEngine?.quit();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/match.ts
git commit -m "feat: add match engine for single game orchestration"
```

---

## Task 10: Tournament System

**Files:**
- Create: `src/server/tournament.ts`, `src/server/__tests__/tournament.test.ts`

- [ ] **Step 1: Write failing tests for round robin scheduling**

Create `src/server/__tests__/tournament.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateRoundRobinPairings } from "../tournament";

describe("generateRoundRobinPairings", () => {
  it("generates correct number of pairings for 3 engines", () => {
    const pairings = generateRoundRobinPairings(["A", "B", "C"], 2);
    // 3 engines → 3 pairs, 2 rounds each → 6 games, each pair plays red/black
    expect(pairings).toHaveLength(6);
  });

  it("generates correct number of pairings for 4 engines", () => {
    const pairings = generateRoundRobinPairings(["A", "B", "C", "D"], 1);
    // 4 engines → 6 pairs → 6 games (1 round, but each pair red+black swap = handled by rounds)
    expect(pairings).toHaveLength(6);
  });

  it("each pair plays equal red and black", () => {
    const pairings = generateRoundRobinPairings(["A", "B"], 2);
    // 1 pair, 2 rounds: A-red vs B-black, then B-red vs A-black
    expect(pairings).toHaveLength(2);
    const asRed = pairings.filter((p) => p.red === "A" && p.black === "B");
    const asBlack = pairings.filter((p) => p.red === "B" && p.black === "A");
    expect(asRed.length).toBe(1);
    expect(asBlack.length).toBe(1);
  });
});
```

- [ ] **Step 2: Implement tournament scheduler**

Create `src/server/tournament.ts`:

```ts
import { Match, type MatchConfig, type MatchResult } from "./match";
import { calculateElo } from "./elo";
import * as db from "@/db/queries";
import type { WsMessage } from "@/lib/types";
import { EventEmitter } from "events";

export interface Pairing {
  red: string;   // engine id
  black: string; // engine id
}

export function generateRoundRobinPairings(engineIds: string[], rounds: number): Pairing[] {
  const pairings: Pairing[] = [];

  // Generate all unique pairs
  for (let i = 0; i < engineIds.length; i++) {
    for (let j = i + 1; j < engineIds.length; j++) {
      for (let r = 0; r < rounds; r++) {
        if (r % 2 === 0) {
          pairings.push({ red: engineIds[i], black: engineIds[j] });
        } else {
          pairings.push({ red: engineIds[j], black: engineIds[i] });
        }
      }
    }
  }

  return pairings;
}

// Active tournament runner — singleton to limit concurrency
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_MATCHES || "2", 10);
let activeMatches = 0;

export class TournamentRunner extends EventEmitter {
  private tournamentId: string;
  private aborted = false;

  constructor(tournamentId: string) {
    super();
    this.tournamentId = tournamentId;
  }

  async run(): Promise<void> {
    const tournament = db.getTournamentById(this.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const entries = db.getTournamentEntries(this.tournamentId);
    const engineIds = entries.map((e) => e.engine_id);

    if (engineIds.length < 2) throw new Error("Need at least 2 engines");

    db.updateTournamentStatus(this.tournamentId, "running");
    const pairings = generateRoundRobinPairings(engineIds, tournament.rounds);

    // Create all game records upfront
    const games = pairings.map((p) =>
      db.createGame(this.tournamentId, p.red, p.black)
    );

    // Run games sequentially (respecting concurrency limit)
    for (let i = 0; i < games.length && !this.aborted; i++) {
      while (activeMatches >= MAX_CONCURRENT) {
        await new Promise((r) => setTimeout(r, 500));
      }

      const game = games[i];
      const redEngine = db.getEngineById(game.red_engine_id)!;
      const blackEngine = db.getEngineById(game.black_engine_id)!;

      const matchConfig: MatchConfig = {
        redEnginePath: redEngine.binary_path,
        blackEnginePath: blackEngine.binary_path,
        timeBase: tournament.time_control_base,
        timeInc: tournament.time_control_inc,
        gameId: game.id,
      };

      activeMatches++;
      db.updateGameStarted(game.id);

      this.emit("game_start", {
        type: "game_start",
        gameId: game.id,
        redEngine: redEngine.name,
        blackEngine: blackEngine.name,
      } as WsMessage);

      try {
        const match = new Match(matchConfig);

        match.on("move", (data) => {
          this.emit("move", {
            type: "move",
            gameId: game.id,
            move: data.move,
            fen: data.fen,
            eval: data.eval,
            redTime: data.redTime,
            blackTime: data.blackTime,
          } as WsMessage);
        });

        const result = await match.run();
        this.processResult(game.id, redEngine, blackEngine, result);
      } catch (err) {
        console.error(`Match ${game.id} failed:`, err);
      } finally {
        activeMatches--;
      }
    }

    // Calculate final rankings
    const finalEntries = db.getTournamentEntries(this.tournamentId);
    const sorted = [...finalEntries].sort((a, b) => b.score - a.score);
    sorted.forEach((entry, idx) => {
      db.updateTournamentEntry(this.tournamentId, entry.engine_id, entry.score, idx + 1);
    });

    db.updateTournamentStatus(this.tournamentId, "finished");
    this.emit("tournament_end", {
      type: "tournament_end",
      tournamentId: this.tournamentId,
    } as WsMessage);
  }

  private processResult(
    gameId: string,
    redEngine: { id: string; elo: number; games_played: number },
    blackEngine: { id: string; elo: number; games_played: number },
    result: MatchResult
  ): void {
    db.updateGameResult(
      gameId,
      result.result,
      JSON.stringify(result.moves),
      result.redTimeLeft,
      result.blackTimeLeft
    );

    // Update Elo
    const scoreRed = result.result === "red" ? 1 : result.result === "draw" ? 0.5 : 0;
    const [newRedElo, newBlackElo] = calculateElo(redEngine.elo, blackEngine.elo, scoreRed);
    db.updateEngineElo(redEngine.id, newRedElo, redEngine.games_played + 1);
    db.updateEngineElo(blackEngine.id, newBlackElo, blackEngine.games_played + 1);

    // Update tournament scores
    const scoreBlack = 1 - scoreRed;
    const redEntry = db.getTournamentEntries(this.tournamentId).find(
      (e) => e.engine_id === redEngine.id
    );
    const blackEntry = db.getTournamentEntries(this.tournamentId).find(
      (e) => e.engine_id === blackEngine.id
    );
    if (redEntry) {
      db.updateTournamentEntry(this.tournamentId, redEngine.id, redEntry.score + scoreRed);
    }
    if (blackEntry) {
      db.updateTournamentEntry(this.tournamentId, blackEngine.id, blackEntry.score + scoreBlack);
    }

    this.emit("game_end", {
      type: "game_end",
      gameId,
      result: result.result,
    } as WsMessage);
  }

  abort(): void {
    this.aborted = true;
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/server/__tests__/tournament.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/tournament.ts src/server/__tests__/tournament.test.ts
git commit -m "feat: add tournament system with round robin scheduling"
```

---

## Task 11: WebSocket Service

**Files:**
- Create: `src/server/ws.ts`

- [ ] **Step 1: Implement WebSocket hub**

Create `src/server/ws.ts`:

```ts
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { WsMessage } from "@/lib/types";

class WsHub {
  private wss: WebSocketServer | null = null;
  // Clients subscribed to specific game IDs
  private gameSubscribers = new Map<string, Set<WebSocket>>();

  init(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url || "", `http://${request.headers.host}`);

      if (url.pathname === "/ws") {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on("connection", (ws) => {
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "subscribe" && msg.gameId) {
            this.subscribe(ws, msg.gameId);
          }
          if (msg.type === "unsubscribe" && msg.gameId) {
            this.unsubscribe(ws, msg.gameId);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on("close", () => {
        // Clean up subscriptions
        for (const [, subscribers] of this.gameSubscribers) {
          subscribers.delete(ws);
        }
      });
    });
  }

  private subscribe(ws: WebSocket, gameId: string): void {
    if (!this.gameSubscribers.has(gameId)) {
      this.gameSubscribers.set(gameId, new Set());
    }
    this.gameSubscribers.get(gameId)!.add(ws);
  }

  private unsubscribe(ws: WebSocket, gameId: string): void {
    this.gameSubscribers.get(gameId)?.delete(ws);
  }

  broadcast(message: WsMessage): void {
    const data = JSON.stringify(message);

    // Send to game subscribers
    if ("gameId" in message) {
      const subscribers = this.gameSubscribers.get(message.gameId);
      if (subscribers) {
        for (const ws of subscribers) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        }
      }
    }

    // Also broadcast to all connected clients (for live game list)
    if (this.wss) {
      for (const ws of this.wss.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      }
    }
  }
}

export const wsHub = new WsHub();
```

- [ ] **Step 2: Commit**

```bash
git add src/server/ws.ts
git commit -m "feat: add WebSocket hub for real-time game updates"
```

---

## Task 12: Custom Server

**Files:**
- Create: `server.ts`

- [ ] **Step 1: Create custom server wrapping Next.js + WebSocket**

Create `server.ts` (project root):

```ts
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { wsHub } from "./src/server/ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  wsHub.init(server);

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
```

Update `package.json` scripts:

```json
"dev": "npx tsx server.ts",
"build": "next build",
"start": "NODE_ENV=production npx tsx server.ts"
```

- [ ] **Step 2: Install tsx for server execution**

```bash
npm install -D tsx
```

- [ ] **Step 3: Verify custom server starts**

```bash
npm run dev
```

Expected: Server starts, prints "Ready on http://0.0.0.0:3000".

- [ ] **Step 4: Commit**

```bash
git add server.ts package.json
git commit -m "feat: add custom server with WebSocket support"
```

---

## Task 13: API Routes — Auth

**Files:**
- Create: `src/app/api/auth/register/route.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/me/route.ts`

- [ ] **Step 1: Implement register endpoint**

Create `src/app/api/auth/register/route.ts`:

```ts
import { NextResponse } from "next/server";
import { hashPassword, signToken, validateInviteCode } from "@/server/auth";
import { createUser, getUserByUsername } from "@/db/queries";

export async function POST(request: Request) {
  const { username, password, inviteCode } = await request.json();

  if (!username || !password || !inviteCode) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (!validateInviteCode(inviteCode)) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 403 });
  }

  if (getUserByUsername(username)) {
    return NextResponse.json({ error: "Username taken" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = createUser(username, passwordHash);
  const token = signToken({ userId: user.id, role: user.role });

  const response = NextResponse.json({ user });
  response.cookies.set("token", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });

  return response;
}
```

- [ ] **Step 2: Implement login endpoint**

Create `src/app/api/auth/login/route.ts`:

```ts
import { NextResponse } from "next/server";
import { verifyPassword, signToken } from "@/server/auth";
import { getUserByUsername } from "@/db/queries";

export async function POST(request: Request) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const user = getUserByUsername(username);
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = signToken({ userId: user.id, role: user.role });
  const response = NextResponse.json({
    user: { id: user.id, username: user.username, role: user.role },
  });
  response.cookies.set("token", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });

  return response;
}
```

- [ ] **Step 3: Implement me endpoint**

Create `src/app/api/auth/me/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ user });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/
git commit -m "feat: add auth API routes (register, login, me)"
```

---

## Task 14: API Routes — Engines

**Files:**
- Create: `src/app/api/engines/route.ts`, `src/app/api/engines/[id]/route.ts`

- [ ] **Step 1: Implement engine list and upload**

Create `src/app/api/engines/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { createEngine, getEnginesByUser } from "@/db/queries";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { nanoid } from "nanoid";

const MAX_SIZE = parseInt(process.env.ENGINE_UPLOAD_MAX_SIZE_MB || "50", 10) * 1024 * 1024;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const engines = getEnginesByUser(user.id);
  return NextResponse.json({ engines });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const name = formData.get("name") as string;
  const file = formData.get("file") as File;

  if (!name || !file) {
    return NextResponse.json({ error: "Name and file required" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: `File too large (max ${MAX_SIZE / 1024 / 1024}MB)` }, { status: 400 });
  }

  const engineId = nanoid();
  const dir = path.join(process.cwd(), "data", "engines", user.id, engineId);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const filePath = path.join(dir, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  // Set executable permission
  const { chmod } = await import("fs/promises");
  await chmod(filePath, 0o755);

  const engine = createEngine(user.id, name, filePath);
  return NextResponse.json({ engine }, { status: 201 });
}
```

- [ ] **Step 2: Implement engine detail and delete**

Create `src/app/api/engines/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getEngineById, deleteEngine } from "@/db/queries";
import { rm } from "fs/promises";
import path from "path";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const engine = getEngineById(id);
  if (!engine) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ engine });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const engine = getEngineById(id);
  if (!engine) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (engine.user_id !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete binary files
  const dir = path.dirname(engine.binary_path);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  deleteEngine(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/engines/
git commit -m "feat: add engine upload and management API routes"
```

---

## Task 15: API Routes — Tournaments, Games, Leaderboard

**Files:**
- Create: `src/app/api/tournaments/route.ts`, `src/app/api/tournaments/[id]/route.ts`, `src/app/api/tournaments/[id]/games/route.ts`, `src/app/api/games/[id]/route.ts`, `src/app/api/leaderboard/route.ts`

- [ ] **Step 1: Tournament list and create**

Create `src/app/api/tournaments/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { createTournament, getTournaments } from "@/db/queries";

export async function GET() {
  const tournaments = getTournaments();
  return NextResponse.json({ tournaments });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { name, timeBase, timeInc, rounds } = await request.json();
  const tournament = createTournament(name, timeBase, timeInc, rounds);
  return NextResponse.json({ tournament }, { status: 201 });
}
```

- [ ] **Step 2: Tournament detail, add engine, start**

Create `src/app/api/tournaments/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import {
  getTournamentById,
  getTournamentEntries,
  addEngineToTournament,
  getGamesByTournament,
} from "@/db/queries";
import { TournamentRunner } from "@/server/tournament";
import { wsHub } from "@/server/ws";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tournament = getTournamentById(id);
  if (!tournament) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const entries = getTournamentEntries(id);
  const games = getGamesByTournament(id);
  return NextResponse.json({ tournament, entries, games });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { engineId } = await request.json();
  addEngineToTournament(id, engineId);
  return NextResponse.json({ ok: true });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const tournament = getTournamentById(id);
  if (!tournament || tournament.status !== "pending") {
    return NextResponse.json({ error: "Cannot start" }, { status: 400 });
  }

  // Start tournament in background
  const runner = new TournamentRunner(id);
  runner.on("move", (msg) => wsHub.broadcast(msg));
  runner.on("game_start", (msg) => wsHub.broadcast(msg));
  runner.on("game_end", (msg) => wsHub.broadcast(msg));
  runner.on("tournament_end", (msg) => wsHub.broadcast(msg));
  runner.run().catch((err) => console.error("Tournament error:", err));

  return NextResponse.json({ ok: true, message: "Tournament started" });
}
```

- [ ] **Step 3: Tournament games list**

Create `src/app/api/tournaments/[id]/games/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getGamesByTournament } from "@/db/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const games = getGamesByTournament(id);
  return NextResponse.json({ games });
}
```

- [ ] **Step 4: Game detail**

Create `src/app/api/games/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getGameById } from "@/db/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const game = getGameById(id);
  if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ game });
}
```

- [ ] **Step 5: Leaderboard**

Create `src/app/api/leaderboard/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getLeaderboard } from "@/db/queries";

export async function GET() {
  const engines = getLeaderboard();
  return NextResponse.json({ engines });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/
git commit -m "feat: add tournament, game, and leaderboard API routes"
```

---

## Task 16: Frontend — Layout & Navbar

**Files:**
- Create: `src/components/Navbar.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create Navbar component**

Create `src/components/Navbar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Swords, Trophy, Cpu, Home } from "lucide-react";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/tournaments", label: "锦标赛", icon: Trophy },
  { href: "/engines", label: "引擎", icon: Cpu },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-paper-300 bg-paper-100/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Swords className="w-5 h-5 text-vermilion" />
          <span className="font-brush text-xl text-ink">象棋擂台</span>
        </Link>

        <div className="flex items-center gap-6">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 text-sm transition-colors ${
                  active ? "text-ink font-semibold" : "text-ink-muted hover:text-ink"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Update layout to include Navbar**

Update `src/app/layout.tsx` to add `<Navbar />` inside `<body>`, above `{children}`.

- [ ] **Step 3: Verify in browser**

```bash
npm run dev
```

Expected: Paper-themed navbar at top with "象棋擂台" logo and nav links.

- [ ] **Step 4: Commit**

```bash
git add src/components/Navbar.tsx src/app/layout.tsx
git commit -m "feat: add Paper-themed navbar and layout"
```

---

## Task 17: Frontend — Leaderboard Component

**Files:**
- Create: `src/components/Leaderboard.tsx`

- [ ] **Step 1: Implement Leaderboard**

Create `src/components/Leaderboard.tsx`:

```tsx
"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Engine } from "@/lib/types";

const CN_NUMBERS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

export function Leaderboard({ engines }: { engines: (Engine & { owner?: string })[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-paper-300">
          <TableHead className="w-12 text-ink-muted">#</TableHead>
          <TableHead className="text-ink-muted">引擎</TableHead>
          <TableHead className="text-ink-muted">作者</TableHead>
          <TableHead className="text-right text-ink-muted">Elo</TableHead>
          <TableHead className="text-right text-ink-muted">对局</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {engines.map((engine, i) => (
          <TableRow key={engine.id} className="border-paper-300 hover:bg-paper-200/50">
            <TableCell className="font-brush text-lg text-ink-muted">
              {CN_NUMBERS[i] || i + 1}
            </TableCell>
            <TableCell className="font-semibold text-ink">{engine.name}</TableCell>
            <TableCell className="text-ink-light">{engine.owner || "—"}</TableCell>
            <TableCell className="text-right font-mono text-ink">
              {Math.round(engine.elo)}
            </TableCell>
            <TableCell className="text-right font-mono text-ink-muted">
              {engine.games_played}
            </TableCell>
          </TableRow>
        ))}
        {engines.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-ink-muted py-8">
              暂无引擎
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Leaderboard.tsx
git commit -m "feat: add leaderboard component with Paper styling"
```

---

## Task 18: Frontend — Board Component

**Files:**
- Create: `src/components/Board.tsx`

- [ ] **Step 1: Implement chessgroundx Board wrapper**

Create `src/components/Board.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Chessground } from "chessgroundx";
import type { Api } from "chessgroundx/api";
import "chessgroundx/assets/chessground.base.css";
import "chessgroundx/assets/chessground.xiangqi.css";

interface BoardProps {
  fen: string;
  lastMove?: [string, string]; // [from, to] in UCI format
  orientation?: "red" | "black";
  width?: number;
}

export function Board({ fen, lastMove, orientation = "red", width = 360 }: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    if (!boardRef.current) return;

    if (!apiRef.current) {
      apiRef.current = Chessground(boardRef.current, {
        fen,
        orientation: orientation === "red" ? "white" : "black",
        viewOnly: true,
        coordinates: true,
        lastMove: lastMove ? [lastMove[0], lastMove[1]] : undefined,
        variant: "xiangqi",
      });
    } else {
      apiRef.current.set({
        fen,
        lastMove: lastMove ? [lastMove[0], lastMove[1]] : undefined,
      });
    }

    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, [fen, lastMove, orientation]);

  return (
    <div
      ref={boardRef}
      className="rounded border border-paper-300"
      style={{ width, height: width * 10 / 9 }}
    />
  );
}
```

Note: chessgroundx CSS may need adjustment for the Paper theme. Custom CSS overrides can be added in a `board.css` file if needed.

- [ ] **Step 2: Commit**

```bash
git add src/components/Board.tsx
git commit -m "feat: add chessgroundx Board component wrapper"
```

---

## Task 19: Frontend — MoveList & EvalChart Components

**Files:**
- Create: `src/components/MoveList.tsx`, `src/components/EvalChart.tsx`

- [ ] **Step 1: Implement MoveList**

Create `src/components/MoveList.tsx`:

```tsx
"use client";

import type { StoredMove } from "@/lib/types";

interface MoveListProps {
  moves: StoredMove[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}

export function MoveList({ moves, currentIndex, onNavigate }: MoveListProps) {
  // Group moves into pairs (red + black)
  const pairs: { index: number; red: StoredMove; black?: StoredMove }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      index: i,
      red: moves[i],
      black: moves[i + 1],
    });
  }

  return (
    <div className="overflow-y-auto font-mono text-sm">
      {pairs.map((pair, pairIdx) => (
        <div key={pairIdx} className="grid grid-cols-[2rem_1fr_1fr] gap-1 py-0.5">
          <span className="text-ink-muted text-right pr-1">{pairIdx + 1}.</span>
          <button
            onClick={() => onNavigate(pair.index)}
            className={`text-left px-1 rounded hover:bg-paper-300/50 ${
              currentIndex === pair.index ? "bg-paper-300 font-semibold" : ""
            }`}
          >
            {pair.red.move}
          </button>
          {pair.black && (
            <button
              onClick={() => onNavigate(pair.index + 1)}
              className={`text-left px-1 rounded hover:bg-paper-300/50 ${
                currentIndex === pair.index + 1 ? "bg-paper-300 font-semibold" : ""
              }`}
            >
              {pair.black.move}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement EvalChart**

Create `src/components/EvalChart.tsx`:

```tsx
"use client";

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, ReferenceLine, Tooltip } from "recharts";
import type { StoredMove } from "@/lib/types";

interface EvalChartProps {
  moves: StoredMove[];
  currentIndex: number;
}

export function EvalChart({ moves, currentIndex }: EvalChartProps) {
  const data = moves.map((m, i) => ({
    index: i,
    eval: m.eval !== null ? Math.max(-1000, Math.min(1000, m.eval)) / 100 : 0,
  }));

  return (
    <div className="h-[100px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="evalGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b3020" stopOpacity={0.3} />
              <stop offset="50%" stopColor="#8b3020" stopOpacity={0} />
              <stop offset="50%" stopColor="#3d3020" stopOpacity={0} />
              <stop offset="100%" stopColor="#3d3020" stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <ReferenceLine y={0} stroke="rgba(61,48,32,0.2)" strokeDasharray="2 2" />
          <Area
            type="monotone"
            dataKey="eval"
            stroke="#503c1e"
            strokeWidth={1.5}
            fill="url(#evalGrad)"
          />
          {currentIndex < data.length && (
            <ReferenceLine
              x={currentIndex}
              stroke="#8b3020"
              strokeWidth={1}
            />
          )}
          <Tooltip
            content={({ payload }) => {
              if (!payload?.[0]) return null;
              const val = payload[0].value as number;
              return (
                <div className="bg-paper-100 border border-paper-300 rounded px-2 py-1 text-xs font-mono">
                  {val > 0 ? "+" : ""}{val.toFixed(1)}
                </div>
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MoveList.tsx src/components/EvalChart.tsx
git commit -m "feat: add MoveList and EvalChart components"
```

---

## Task 20: Frontend — Game Page

**Files:**
- Create: `src/app/games/[id]/page.tsx`

- [ ] **Step 1: Implement Game page with replay and live WebSocket**

Create `src/app/games/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback, use } from "react";
import { Board } from "@/components/Board";
import { MoveList } from "@/components/MoveList";
import { EvalChart } from "@/components/EvalChart";
import { Button } from "@/components/ui/button";
import { SkipBack, ChevronLeft, ChevronRight, SkipForward } from "lucide-react";
import { INITIAL_FEN } from "@/lib/constants";
import type { StoredMove, Game } from "@/lib/types";

export default function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [game, setGame] = useState<Game | null>(null);
  const [moves, setMoves] = useState<StoredMove[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 = initial position
  const [redTime, setRedTime] = useState(0);
  const [blackTime, setBlackTime] = useState(0);

  // Fetch game data
  useEffect(() => {
    fetch(`/api/games/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setGame(data.game);
        const parsedMoves = JSON.parse(data.game.moves || "[]");
        setMoves(parsedMoves);
        setCurrentIndex(parsedMoves.length - 1);
        setRedTime(data.game.red_time_left || 0);
        setBlackTime(data.game.black_time_left || 0);
      });
  }, [id]);

  // WebSocket for live updates
  useEffect(() => {
    if (game?.result) return; // Game is over, no need for WS

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", gameId: id }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "move" && msg.gameId === id) {
        setMoves((prev) => [
          ...prev,
          { move: msg.move, fen: msg.fen, time_ms: 0, eval: msg.eval },
        ]);
        setCurrentIndex((prev) => prev + 1);
        setRedTime(msg.redTime);
        setBlackTime(msg.blackTime);
      }
      if (msg.type === "game_end" && msg.gameId === id) {
        setGame((prev) => prev ? { ...prev, result: msg.result } : prev);
      }
    };

    return () => ws.close();
  }, [id, game?.result]);

  const currentFen =
    currentIndex < 0 ? INITIAL_FEN : moves[currentIndex]?.fen || INITIAL_FEN;

  const lastMove =
    currentIndex >= 0 && moves[currentIndex]
      ? ([
          moves[currentIndex].move.slice(0, 2),
          moves[currentIndex].move.slice(2, 4),
        ] as [string, string])
      : undefined;

  const formatTime = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const navigate = useCallback((idx: number) => {
    setCurrentIndex(Math.max(-1, Math.min(moves.length - 1, idx)));
  }, [moves.length]);

  if (!game) return <div className="p-8 text-ink-muted">加载中...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
        {/* Left: Board */}
        <div className="flex flex-col items-center gap-2">
          {/* Black info */}
          <div className="w-full max-w-[360px] flex items-center justify-between px-3 py-2 bg-paper-200 rounded">
            <span className="font-semibold text-ink">黑 {game.black_engine_id}</span>
            <span className="font-mono text-lg">{formatTime(blackTime)}</span>
          </div>

          <Board fen={currentFen} lastMove={lastMove} />

          {/* Red info */}
          <div className="w-full max-w-[360px] flex items-center justify-between px-3 py-2 bg-vermilion/10 rounded">
            <span className="font-semibold text-vermilion">红 {game.red_engine_id}</span>
            <span className="font-mono text-lg">{formatTime(redTime)}</span>
          </div>
        </div>

        {/* Right: Info panel */}
        <div className="flex flex-col gap-4">
          {/* Result badge */}
          {game.result && (
            <div className={`text-center py-2 rounded font-brush text-lg ${
              game.result === "red" ? "bg-vermilion/10 text-vermilion" :
              game.result === "black" ? "bg-paper-300 text-ink" :
              "bg-paper-200 text-ink-muted"
            }`}>
              {game.result === "red" ? "红胜" : game.result === "black" ? "黑胜" : "和棋"}
            </div>
          )}

          {/* Move list */}
          <div className="flex-1 min-h-0 max-h-[300px] border border-paper-300 rounded p-3">
            <MoveList moves={moves} currentIndex={currentIndex} onNavigate={navigate} />
          </div>

          {/* Eval chart */}
          <div className="border border-paper-300 rounded p-3">
            <p className="text-xs text-ink-muted mb-1">评估曲线</p>
            <EvalChart moves={moves} currentIndex={currentIndex} />
          </div>

          {/* Replay controls */}
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(currentIndex - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(currentIndex + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(moves.length - 1)}>
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/games/
git commit -m "feat: add game page with live board, replay, and eval chart"
```

---

## Task 21: Frontend — Home Page, Tournament Pages, Engine Page, Auth Pages

**Files:**
- Create: `src/app/page.tsx` (update), `src/app/tournaments/page.tsx`, `src/app/tournaments/[id]/page.tsx`, `src/components/CrossTable.tsx`, `src/app/engines/page.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`

- [ ] **Step 1: Update Home page**

Rewrite `src/app/page.tsx` to fetch and display the leaderboard, active games, and recent tournaments using the API routes.

- [ ] **Step 2: Create Tournament list page**

Create `src/app/tournaments/page.tsx` with tournament cards showing status (pending/running/finished), time control, and engine count.

- [ ] **Step 3: Create CrossTable component**

Create `src/components/CrossTable.tsx` — a grid showing head-to-head results between all engines in a tournament.

- [ ] **Step 4: Create Tournament detail page**

Create `src/app/tournaments/[id]/page.tsx` with CrossTable, game list, and controls for adding engines / starting tournament.

- [ ] **Step 5: Create Engines page**

Create `src/app/engines/page.tsx` with file upload form, engine list, and delete button.

- [ ] **Step 6: Create Login page**

Create `src/app/(auth)/login/page.tsx` with username/password form.

- [ ] **Step 7: Create Register page**

Create `src/app/(auth)/register/page.tsx` with username/password/invite-code form.

- [ ] **Step 8: Commit**

```bash
git add src/app/ src/components/CrossTable.tsx
git commit -m "feat: add all frontend pages — home, tournaments, engines, auth"
```

---

## Task 22: Integration Testing & Polish

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Fix any failures.

- [ ] **Step 2: Start dev server and manually test the full flow**

```bash
npm run dev
```

Test flow:
1. Register with invite code
2. Upload an engine (use Pikafish or Fairy-Stockfish binary if available)
3. Create a tournament
4. Add engines to tournament
5. Start tournament
6. Watch live game
7. Check leaderboard after tournament ends

- [ ] **Step 3: Fix any issues found during manual testing**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix: integration fixes and polish"
```
