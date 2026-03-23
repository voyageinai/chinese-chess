import type { Board, Color, GameState, Move, Piece, PieceKind, Square } from "@/lib/types";
import {
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_SIZE,
  colOf,
  makeSquare,
  rowOf,
  squareToUci,
} from "@/lib/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function opponent(color: Color): Color {
  return color === "red" ? "black" : "red";
}

/** Red palace: rows 7-9, cols 3-5. Black palace: rows 0-2, cols 3-5. */
function inPalace(sq: Square, color: Color): boolean {
  const r = rowOf(sq);
  const c = colOf(sq);
  if (c < 3 || c > 5) return false;
  return color === "red" ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
}

/** Red's side: rows 5-9. Black's side: rows 0-4. */
function onOwnSide(sq: Square, color: Color): boolean {
  const r = rowOf(sq);
  return color === "red" ? r >= 5 : r <= 4;
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS;
}

function findKing(board: Board, color: Color): Square {
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = board[i];
    if (p && p.color === color && p.kind === "k") return i;
  }
  // Should never happen in a valid position
  return -1;
}

// ---------------------------------------------------------------------------
// Pseudo-legal move generation (ignores check legality)
// ---------------------------------------------------------------------------

const ORTHOGONAL: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const DIAGONAL: [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

function generatePseudoMoves(state: GameState): Move[] {
  const { board, turn } = state;
  const moves: Move[] = [];

  for (let sq = 0; sq < BOARD_SIZE; sq++) {
    const piece = board[sq];
    if (!piece || piece.color !== turn) continue;

    const r = rowOf(sq);
    const c = colOf(sq);

    switch (piece.kind) {
      case "r":
        generateRookMoves(board, turn, sq, r, c, moves);
        break;
      case "c":
        generateCannonMoves(board, turn, sq, r, c, moves);
        break;
      case "h":
        generateHorseMoves(board, turn, sq, r, c, moves);
        break;
      case "e":
        generateElephantMoves(board, turn, sq, r, c, moves);
        break;
      case "a":
        generateAdvisorMoves(board, turn, sq, r, c, moves);
        break;
      case "k":
        generateKingMoves(board, turn, sq, r, c, moves);
        break;
      case "p":
        generatePawnMoves(board, turn, sq, r, c, moves);
        break;
    }
  }

  return moves;
}

function addMove(
  board: Board,
  turn: Color,
  from: Square,
  toR: number,
  toC: number,
  moves: Move[],
): boolean {
  // Returns false if the square is occupied by own piece (blocking), true otherwise.
  const to = makeSquare(toR, toC);
  const target = board[to];
  if (target && target.color === turn) return false; // blocked by own piece
  moves.push({ from, to, capture: target ?? undefined });
  return true;
}

// -- Rook: slides along rank/file --
function generateRookMoves(
  board: Board,
  turn: Color,
  sq: Square,
  r: number,
  c: number,
  moves: Move[],
): void {
  for (const [dr, dc] of ORTHOGONAL) {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc)) {
      const to = makeSquare(nr, nc);
      const target = board[to];
      if (target) {
        if (target.color !== turn) {
          moves.push({ from: sq, to, capture: target });
        }
        break; // blocked
      }
      moves.push({ from: sq, to });
      nr += dr;
      nc += dc;
    }
  }
}

// -- Cannon: slides to move, jumps one piece (screen) to capture --
function generateCannonMoves(
  board: Board,
  turn: Color,
  sq: Square,
  r: number,
  c: number,
  moves: Move[],
): void {
  for (const [dr, dc] of ORTHOGONAL) {
    let nr = r + dr;
    let nc = c + dc;
    // Phase 1: non-capture moves (slide without jumping)
    while (inBounds(nr, nc)) {
      const to = makeSquare(nr, nc);
      const target = board[to];
      if (target) {
        // Found screen piece, enter phase 2
        nr += dr;
        nc += dc;
        while (inBounds(nr, nc)) {
          const to2 = makeSquare(nr, nc);
          const target2 = board[to2];
          if (target2) {
            if (target2.color !== turn) {
              moves.push({ from: sq, to: to2, capture: target2 });
            }
            break; // cannot jump more than one piece for capture
          }
          nr += dr;
          nc += dc;
        }
        break; // done with this direction
      }
      moves.push({ from: sq, to });
      nr += dr;
      nc += dc;
    }
  }
}

// -- Horse: L-shape with leg blocking --
const HORSE_MOVES: { leg: [number, number]; dest: [number, number] }[] = [
  { leg: [-1, 0], dest: [-2, -1] },
  { leg: [-1, 0], dest: [-2, 1] },
  { leg: [1, 0], dest: [2, -1] },
  { leg: [1, 0], dest: [2, 1] },
  { leg: [0, -1], dest: [-1, -2] },
  { leg: [0, -1], dest: [1, -2] },
  { leg: [0, 1], dest: [-1, 2] },
  { leg: [0, 1], dest: [1, 2] },
];

function generateHorseMoves(
  board: Board,
  turn: Color,
  sq: Square,
  r: number,
  c: number,
  moves: Move[],
): void {
  for (const { leg, dest } of HORSE_MOVES) {
    const legR = r + leg[0];
    const legC = c + leg[1];
    if (!inBounds(legR, legC)) continue;
    if (board[makeSquare(legR, legC)]) continue; // leg blocked

    const destR = r + dest[0];
    const destC = c + dest[1];
    if (!inBounds(destR, destC)) continue;

    addMove(board, turn, sq, destR, destC, moves);
  }
}

// -- Elephant: diagonal 2 with eye blocking, cannot cross river --
const ELEPHANT_MOVES: { eye: [number, number]; dest: [number, number] }[] = [
  { eye: [-1, -1], dest: [-2, -2] },
  { eye: [-1, 1], dest: [-2, 2] },
  { eye: [1, -1], dest: [2, -2] },
  { eye: [1, 1], dest: [2, 2] },
];

function generateElephantMoves(
  board: Board,
  turn: Color,
  sq: Square,
  r: number,
  c: number,
  moves: Move[],
): void {
  for (const { eye, dest } of ELEPHANT_MOVES) {
    const eyeR = r + eye[0];
    const eyeC = c + eye[1];
    if (!inBounds(eyeR, eyeC)) continue;
    if (board[makeSquare(eyeR, eyeC)]) continue; // eye blocked

    const destR = r + dest[0];
    const destC = c + dest[1];
    if (!inBounds(destR, destC)) continue;

    // Elephant cannot cross river
    const destSq = makeSquare(destR, destC);
    if (!onOwnSide(destSq, turn)) continue;

    addMove(board, turn, sq, destR, destC, moves);
  }
}

// -- Advisor: diagonal 1, must stay in palace --
function generateAdvisorMoves(
  board: Board,
  turn: Color,
  sq: Square,
  r: number,
  c: number,
  moves: Move[],
): void {
  for (const [dr, dc] of DIAGONAL) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    const destSq = makeSquare(nr, nc);
    if (!inPalace(destSq, turn)) continue;
    addMove(board, turn, sq, nr, nc, moves);
  }
}

// -- King: orthogonal 1, must stay in palace --
function generateKingMoves(
  board: Board,
  turn: Color,
  sq: Square,
  r: number,
  c: number,
  moves: Move[],
): void {
  for (const [dr, dc] of ORTHOGONAL) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    const destSq = makeSquare(nr, nc);
    if (!inPalace(destSq, turn)) continue;
    addMove(board, turn, sq, nr, nc, moves);
  }
}

// -- Pawn: forward on own side; forward or sideways after crossing river --
function generatePawnMoves(
  board: Board,
  turn: Color,
  sq: Square,
  r: number,
  c: number,
  moves: Move[],
): void {
  // Red moves up (decreasing row), black moves down (increasing row)
  const forward = turn === "red" ? -1 : 1;

  // Forward move (always available)
  const fr = r + forward;
  if (inBounds(fr, c)) {
    addMove(board, turn, sq, fr, c, moves);
  }

  // Sideways moves (only after crossing river = on opponent's side)
  if (!onOwnSide(sq, turn)) {
    if (inBounds(r, c - 1)) addMove(board, turn, sq, r, c - 1, moves);
    if (inBounds(r, c + 1)) addMove(board, turn, sq, r, c + 1, moves);
  }
}

// ---------------------------------------------------------------------------
// Check detection
// ---------------------------------------------------------------------------

/**
 * Checks if the given color's king is in check.
 * This includes the "flying general" rule: if both kings face each other
 * on the same column with no pieces between, both are in check.
 */
export function isInCheck(state: GameState, color: Color): boolean {
  const { board } = state;
  const kingSq = findKing(board, color);
  if (kingSq === -1) return false;

  // Flying general rule
  const opp = opponent(color);
  const oppKingSq = findKing(board, opp);
  if (oppKingSq !== -1) {
    const kCol = colOf(kingSq);
    const oCol = colOf(oppKingSq);
    if (kCol === oCol) {
      const kRow = rowOf(kingSq);
      const oRow = rowOf(oppKingSq);
      const minRow = Math.min(kRow, oRow);
      const maxRow = Math.max(kRow, oRow);
      let blocked = false;
      for (let rr = minRow + 1; rr < maxRow; rr++) {
        if (board[makeSquare(rr, kCol)]) {
          blocked = true;
          break;
        }
      }
      if (!blocked) return true;
    }
  }

  // Check if any opponent piece attacks the king square.
  // We generate pseudo-moves for the opponent and see if any targets kingSq.
  // To do this efficiently, we temporarily set the turn to the opponent.
  const tempState: GameState = { ...state, turn: opp };
  const oppMoves = generatePseudoMoves(tempState);
  for (const m of oppMoves) {
    if (m.to === kingSq) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Legal move generation
// ---------------------------------------------------------------------------

/**
 * Generate all legal moves for the side to move.
 * A legal move is a pseudo-legal move that does not leave the own king in check.
 */
export function generateMoves(state: GameState): Move[] {
  const pseudoMoves = generatePseudoMoves(state);
  const legalMoves: Move[] = [];

  for (const move of pseudoMoves) {
    // Apply the move on a cloned board
    const newBoard = state.board.slice();
    newBoard[move.to] = newBoard[move.from];
    newBoard[move.from] = null;

    const newState: GameState = {
      ...state,
      board: newBoard,
      turn: state.turn, // keep same turn for check detection
    };

    if (!isInCheck(newState, state.turn)) {
      legalMoves.push(move);
    }
  }

  return legalMoves;
}

// ---------------------------------------------------------------------------
// Game state transitions
// ---------------------------------------------------------------------------

/**
 * Apply a move and return a new GameState with the move applied and turn switched.
 * The halfmoveClock resets on captures (Xiangqi rule: NOT on pawn moves like chess).
 */
export function applyMove(state: GameState, move: Move): GameState {
  const newBoard = state.board.slice();
  const movingPiece = newBoard[move.from];
  const capturedPiece = newBoard[move.to];

  newBoard[move.to] = movingPiece;
  newBoard[move.from] = null;

  const isCapture = capturedPiece !== null;
  const newTurn = opponent(state.turn);
  const newHalfmoveClock = isCapture ? 0 : state.halfmoveClock + 1;
  const newFullmoveNumber =
    state.turn === "black" ? state.fullmoveNumber + 1 : state.fullmoveNumber;

  const uci = squareToUci(move.from) + squareToUci(move.to);

  return {
    board: newBoard,
    turn: newTurn,
    halfmoveClock: newHalfmoveClock,
    fullmoveNumber: newFullmoveNumber,
    moveHistory: [...state.moveHistory, uci],
  };
}

// ---------------------------------------------------------------------------
// Checkmate / Stalemate
// ---------------------------------------------------------------------------

/** In check AND no legal moves. */
export function isCheckmate(state: GameState): boolean {
  if (!isInCheck(state, state.turn)) return false;
  return generateMoves(state).length === 0;
}

/** NOT in check AND no legal moves. */
export function isStalemate(state: GameState): boolean {
  if (isInCheck(state, state.turn)) return false;
  return generateMoves(state).length === 0;
}

// ---------------------------------------------------------------------------
// Single-move legality check
// ---------------------------------------------------------------------------

/** Check if a specific move (from -> to) is legal in the current position. */
export function isLegalMove(state: GameState, from: Square, to: Square): boolean {
  const moves = generateMoves(state);
  return moves.some((m) => m.from === from && m.to === to);
}
