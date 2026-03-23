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
