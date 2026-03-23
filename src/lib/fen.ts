import type { Board, Color, GameState, PieceKind } from "./types";
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
