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
  | {
      type: "move";
      gameId: string;
      move: UciMove;
      fen: string;
      eval: number | null;
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
    }
  | { type: "game_end"; gameId: string; result: "red" | "black" | "draw" }
  | { type: "tournament_end"; tournamentId: string };
