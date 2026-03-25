# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server (custom Next.js + WebSocket on same port)
npm run build        # Production build
npm run start        # Production server (NODE_ENV=production)
npm run lint         # ESLint (Next.js core-web-vitals + TypeScript)
npm run test         # Vitest (one-shot)
npm run test:watch   # Vitest (watch mode)
npx vitest run src/server/__tests__/rules.test.ts  # Run a single test file
```

## Architecture

Self-hosted Chinese chess (xiangqi) engine tournament platform. Next.js 16 full-stack with a custom HTTP server (`server.ts`) that integrates WebSocket on the same port. Server startup calls `resumeRunningTournaments()` to continue interrupted matches.

### Server-side systems (`src/server/`)

- **UciEngine** (`uci.ts`) — Spawns engine subprocesses, handles UCI protocol. Auto-detects coordinate system: engines advertising `UCI_Variant` option (Fairy-Stockfish) use 1-based ranks (1-10), pure xiangqi engines (Pikafish) use 0-based (0-9). Translates internal FEN piece letters (`H`/`E`) to UCI standard (`N`/`B`) before sending via `fenToUci()`.
- **Match** (`match.ts`) — Orchestrates a single engine-vs-engine game. Sends position as pure FEN each move (no move history accumulation). Validates moves, manages clocks, persists each move incrementally to DB. Stores eval from red's perspective (flips black engine eval). Emits events for live WebSocket streaming. Uses a fixed pipeline of board-terminal detection (`rules.ts`) then automatic adjudication (`judge.ts`).
- **Judge** (`judge.ts`) — Fixed platform adjudicator for repeated positions, perpetual check, perpetual chase, and the hardcoded natural move limit. Exports `adjudicateRepetition()` as a pure testable function.
- **TournamentRunner** (`tournament.ts`) — Round-robin pairing, sequential match execution, Elo updates (K=32). Converts DB time (seconds) to UCI time (ms) at handoff. Persists `result_code`, `result_reason`, and `result_detail` for every finished game.
- **WsHub** (`ws.ts`) — WebSocket broadcast for live game events. Only intercepts `/ws` path; preserves other upgrades (Next.js HMR).
- **Rules** (`rules.ts`) — Move generation, legality checking, check/checkmate/stalemate detection, flying-general capture support, and immediate eat-king terminal classification. `applyMove()` manages halfmove clock (resets on captures only — xiangqi differs from chess where pawn moves also reset).

### End-of-game conditions (in `match.ts`)

King capture, checkmate, stalemate (loss for stalemated side per WXF rules, NOT draw), timeout, perpetual check, perpetual chase, repeated-position draw, hardcoded natural move limit draw, engine crashes, illegal moves, and invalid move formats. The platform uses one fixed automatic rule set; there is no configurable tournament-specific adjudication profile.

### Engine upload validation (`src/app/api/engines/route.ts`)

Two-phase validation on upload using `UciEngine` class directly (no duplicated protocol logic):
1. **UCI handshake** — `uci` → `uciok`, `UCI_Variant` detection, `isready` → `readyok`
2. **Coordinate probe** — Plays one move from initial position, validates legality through our coordinate parser. Layered diagnostics: empty source → coordinate mismatch, wrong color piece → reversed rank numbering, other illegal → engine logic bug.

### Database (`src/db/`)

SQLite via `better-sqlite3` with WAL mode. Schema in `schema.ts`, queries in `queries.ts`, migrations in `index.ts` using `hasColumn()` pattern. On first access, `seedDefaultEngines()` auto-registers executables from `data/default-engines/` under a `__system__` user. First registered user automatically gets `admin` role.

### Frontend (`src/app/`)

Next.js App Router. Pages: home (leaderboard + recent games), tournaments (list + detail with crosstable), engines (upload/manage), games (replay with eval chart), guide, admin, auth (login/register with invite code). API routes under `src/app/api/`. Game result text is translated from `result_code`/`result_detail` via `src/lib/results.ts`, with `result_reason` retained for export/debug.

### Key components (`src/components/`)

- **Board** — Xiangqi board rendering and piece display
- **EvalChart** — Recharts-based evaluation curve for game replay
- **CrossTable** — Tournament crosstable (head-to-head results matrix)
- **MoveList** — Clickable move history for game navigation

### Shared library (`src/lib/`)

- `types.ts` — All TypeScript types (Piece, GameState, StoredMove, WsMessage, etc.)
- `constants.ts` — Board constants, FEN char maps, coordinate conversion helpers
- `fen.ts` — FEN parsing (`parseFen`) and serialization (`serializeFen`)
- `auth.ts` — Client-side `getCurrentUser()` (reads JWT from cookie)

### Auth system

JWT (7-day expiry) + bcryptjs password hashing. Registration requires invite code (DB-managed via admin panel, with fallback to `INVITE_CODE` env var). Login sets HTTP-only cookie. Admin panel at `/admin/` with role-based permissions (`src/server/permissions.ts`) and audit logging (`src/server/audit.ts`).

### Path alias

`@/*` maps to `./src/*` (configured in both `tsconfig.json` and `vitest.config.ts`).

### Environment variables

See `.env.example`: `INVITE_CODE`, `JWT_SECRET`, `MAX_CONCURRENT_MATCHES`, `ENGINE_UPLOAD_MAX_SIZE_MB`.

## Critical Conventions

### Piece letters — two systems coexist

| Piece | Internal (FEN/rules) | UCI (sent to engines) |
|-------|---------------------|-----------------------|
| Horse/Knight | H / h | N / n |
| Elephant/Bishop | E / e | B / b |

`uci.ts:fenToUci()` converts outbound only. Inbound engine moves are square-based (no piece letters).

### Coordinate systems — three systems coexist

- **Internal board**: `square = row * 9 + col`. Row 0 = black back rank (top), row 9 = red back rank (bottom).
- **UCI 0-based** (Pikafish): rank 0 = red back rank. Conversion: `row = 9 - rank`.
- **UCI 1-based** (Fairy-Stockfish): rank 1 = red back rank. Conversion: `row = 10 - rank`.

`UciEngine.uciMoveToSquares()` and `squaresToUciMove()` handle this based on the `rankOneBased` flag. Engines using other conventions (e.g. rank 0 = black back rank) are rejected at upload by the coordinate probe.

### Time units

| Layer | Unit |
|-------|------|
| Database (`time_control_base/inc`) | Seconds |
| Frontend form input | Seconds |
| Match runner / UCI protocol (`wtime/btime/winc/binc`) | Milliseconds |
| `StoredMove.time_ms` / `red_time_left` / `black_time_left` | Milliseconds |

Conversion happens in `tournament.ts` (`* 1000`) when creating `MatchConfig`.

### Color mapping

Red = white in UCI (`wtime`/`winc`). FEN turn: `w` = red, `b` = black.

### Repetition and perpetual actions

The fixed adjudicator in `judge.ts` tracks per-ply metadata (`PlyMeta`: position key, mover, moving piece kind, check flag, chase kind) and position occurrences. On the third occurrence of the same board+side-to-move key, it analyzes the last cycle and deterministically returns one of: perpetual-check loss, perpetual-chase loss, mutual perpetual-check draw, mutual perpetual-chase draw, or repeated-position draw.

### Stalemate

In xiangqi, stalemate = stalemated side **loses** (unlike chess where it's a draw). WXF 2018 Article 3.1.A.II.

### Result persistence

Every game termination stores `result_code`, `result_reason`, and `result_detail` in the `games` table. Frontend translations should prefer `result_code`/`result_detail`; `result_reason` is the stable English export/debug string.

## Gotchas

1. **FEN piece conversion is one-way** — `fenToUci()` converts H→N, E→B before sending to engines. If you add a new code path that sends FEN to an engine, it must go through this conversion or Pikafish will segfault.
2. **Eval is always red-perspective** — Black engine eval is sign-flipped before storage. Don't flip again when displaying.
3. **Engine init timeout is 10 seconds** — Failure auto-forfeits; no exception thrown, result returned with empty moves.
4. **Default engine seeding checks executable bit** (`X_OK`) to distinguish binaries from .nnue/.md files.
5. **`MAX_CONCURRENT_MATCHES = 1`** is hardcoded in `tournament.ts` — despite `.env.example` showing `2`, the code does not read this env var. SQLite WAL would contend under concurrent writes.
6. **Pikafish needs matching NNUE version** — Mismatched `pikafish.nnue` causes segfault, not a graceful error.
7. **Halfmove clock resets on captures only** — Unlike chess, pawn/soldier moves do NOT reset the clock in xiangqi. This is implemented in `rules.ts:applyMove()`.
8. **Time increment is added after move validation** — Ensures engines that return illegal/invalid moves don't get credited with bonus time.
9. **DB migrations use `hasColumn()` pattern** — New columns are added via `ALTER TABLE` in `runMigrations()` in `src/db/index.ts`, guarded by `hasColumn()` checks for idempotency.
10. **Engine upload validates coordinates, not just handshake** — The upload API spawns the engine, completes full UCI init, then plays a probe move from the initial position. Engines with incompatible coordinate systems are rejected before registration.
