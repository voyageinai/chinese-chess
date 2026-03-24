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
  depth?: number | null; // search depth at time of move
}

// -- API / DB types --
export type UserStatus = "active" | "banned";

export interface User {
  id: string;
  username: string;
  role: "admin" | "user";
  status: UserStatus;
  created_at: number;
}

export type EngineVisibility = "public" | "private";
export type EngineStatus = "active" | "disabled";

export interface Engine {
  id: string;
  user_id: string;
  name: string;
  binary_path: string;
  visibility: EngineVisibility;
  status: EngineStatus;
  elo: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  uploaded_at: number;
}

export interface Tournament {
  id: string;
  owner_id: string;
  name: string;
  status: "pending" | "running" | "finished" | "cancelled";
  type: "tournament" | "quick_match";
  format: "round_robin" | "knockout" | "gauntlet" | "swiss";
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
  result_reason: string | null;
  moves: string; // JSON string of StoredMove[]
  red_time_left: number | null;
  black_time_left: number | null;
  started_at: number | null;
  finished_at: number | null;
  opening_fen: string | null;
  round: number | null;
}

// -- WebSocket messages --
export type WsMessage =
  | {
      type: "move";
      gameId: string;
      move: UciMove;
      fen: string;
      eval: number | null;
      depth: number | null;
      nodes: number | null;
      pv: string | null;
      redTime: number;
      blackTime: number;
      timeMs: number;
      ply: number;
      movedAt: number;
    }
  | {
      type: "game_start";
      gameId: string;
      redEngine: string;
      blackEngine: string;
      redTime: number;
      blackTime: number;
      startFen?: string;
    }
  | { type: "game_end"; gameId: string; result: "red" | "black" | "draw"; reason: string }
  | { type: "tournament_end"; tournamentId: string }
  | {
      type: "engine_thinking";
      gameId: string;
      side: "red" | "black";
      depth: number | null;
      eval: number | null;
      nodes: number | null;
      pv: string | null;
    };

// -- Audit log --
export interface AuditLog {
  id: string;
  action: string;
  actor_id: string;
  target_type: string | null;
  target_id: string | null;
  details: string | null; // JSON string
  created_at: number;
}

// -- Invite code --
export interface InviteCode {
  code: string;
  created_by: string;
  used_by: string | null;
  expires_at: number;
  created_at: number;
}
