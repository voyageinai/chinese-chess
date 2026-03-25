import {
  BOARD_SIZE,
  colOf,
  makeSquare,
  rowOf,
  uciToSquare,
} from "./constants";
import { parseFen } from "./fen";
import type { Board, Color, GameState, Piece, PieceKind, Square } from "./types";

export interface MoveDisplayMeta {
  from: [number, number];
  to: [number, number];
  side: Color;
  movingPiece: PieceKind;
  capturedPiece: PieceKind | null;
  isCapture: boolean;
  isCheck: boolean;
  checkedKing: [number, number] | null;
}

function opponent(color: Color): Color {
  return color === "red" ? "black" : "red";
}

function inPalace(square: Square, color: Color): boolean {
  const row = rowOf(square);
  const col = colOf(square);
  if (col < 3 || col > 5) return false;
  return color === "red" ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
}

function onOwnSide(square: Square, color: Color): boolean {
  const row = rowOf(square);
  return color === "red" ? row >= 5 : row <= 4;
}

function findKing(board: Board, color: Color): Square | null {
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = board[square];
    if (piece?.color === color && piece.kind === "k") {
      return square;
    }
  }
  return null;
}

function countBlockersBetween(board: Board, from: Square, to: Square): number {
  const fromRow = rowOf(from);
  const fromCol = colOf(from);
  const toRow = rowOf(to);
  const toCol = colOf(to);

  if (fromRow !== toRow && fromCol !== toCol) {
    return -1;
  }

  let blockers = 0;

  if (fromRow === toRow) {
    const step = fromCol < toCol ? 1 : -1;
    for (let col = fromCol + step; col !== toCol; col += step) {
      if (board[makeSquare(fromRow, col)]) blockers++;
    }
    return blockers;
  }

  const step = fromRow < toRow ? 1 : -1;
  for (let row = fromRow + step; row !== toRow; row += step) {
    if (board[makeSquare(row, fromCol)]) blockers++;
  }
  return blockers;
}

function kingsFaceEachOther(board: Board): { red: Square; black: Square } | null {
  const redKing = findKing(board, "red");
  const blackKing = findKing(board, "black");
  if (redKing == null || blackKing == null) return null;
  if (colOf(redKing) !== colOf(blackKing)) return null;
  return countBlockersBetween(board, redKing, blackKing) === 0
    ? { red: redKing, black: blackKing }
    : null;
}

function pieceAttacksSquare(
  board: Board,
  from: Square,
  piece: Piece,
  target: Square,
): boolean {
  const fromRow = rowOf(from);
  const fromCol = colOf(from);
  const targetRow = rowOf(target);
  const targetCol = colOf(target);
  const deltaRow = targetRow - fromRow;
  const deltaCol = targetCol - fromCol;

  switch (piece.kind) {
    case "r":
      return countBlockersBetween(board, from, target) === 0;
    case "c":
      return countBlockersBetween(board, from, target) === 1;
    case "h": {
      if (Math.abs(deltaRow) === 2 && Math.abs(deltaCol) === 1) {
        const legRow = fromRow + Math.sign(deltaRow);
        return !board[makeSquare(legRow, fromCol)];
      }
      if (Math.abs(deltaRow) === 1 && Math.abs(deltaCol) === 2) {
        const legCol = fromCol + Math.sign(deltaCol);
        return !board[makeSquare(fromRow, legCol)];
      }
      return false;
    }
    case "e": {
      if (Math.abs(deltaRow) !== 2 || Math.abs(deltaCol) !== 2) return false;
      if (!onOwnSide(target, piece.color)) return false;
      const eyeRow = fromRow + deltaRow / 2;
      const eyeCol = fromCol + deltaCol / 2;
      return !board[makeSquare(eyeRow, eyeCol)];
    }
    case "a":
      return (
        Math.abs(deltaRow) === 1 &&
        Math.abs(deltaCol) === 1 &&
        inPalace(target, piece.color)
      );
    case "k":
      return (
        ((Math.abs(deltaRow) === 1 && deltaCol === 0) ||
          (Math.abs(deltaCol) === 1 && deltaRow === 0)) &&
        inPalace(target, piece.color)
      );
    case "p": {
      const forward = piece.color === "red" ? -1 : 1;
      if (deltaRow === forward && deltaCol === 0) return true;
      return !onOwnSide(from, piece.color) && deltaRow === 0 && Math.abs(deltaCol) === 1;
    }
    default:
      return false;
  }
}

function isInCheck(board: Board, color: Color): boolean {
  const kingSquare = findKing(board, color);
  if (kingSquare == null) return false;

  const facing = kingsFaceEachOther(board);
  if (facing) {
    return color === "red" ? facing.red === kingSquare : facing.black === kingSquare;
  }

  const attacker = opponent(color);
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = board[square];
    if (!piece || piece.color !== attacker) continue;
    if (pieceAttacksSquare(board, square, piece, kingSquare)) {
      return true;
    }
  }

  return false;
}

function applyDisplayMove(state: GameState, move: string): {
  board: Board;
  movingPiece: Piece;
  capturedPiece: Piece | null;
} | null {
  if (!/^[a-i][0-9][a-i][0-9]$/.test(move)) return null;

  const from = uciToSquare(move.slice(0, 2));
  const to = uciToSquare(move.slice(2, 4));
  const movingPiece = state.board[from];
  if (!movingPiece) return null;

  const board = state.board.slice();
  const capturedPiece = board[to];
  board[to] = movingPiece;
  board[from] = null;

  return { board, movingPiece, capturedPiece };
}

export function analyzeMoveDisplay(
  fenBefore: string,
  move: string,
): MoveDisplayMeta | null {
  const state = parseFen(fenBefore);
  const applied = applyDisplayMove(state, move);
  if (!applied) return null;

  const nextTurn = opponent(state.turn);
  const checkedKingSquare = isInCheck(applied.board, nextTurn)
    ? findKing(applied.board, nextTurn)
    : null;
  const from = uciToSquare(move.slice(0, 2));
  const to = uciToSquare(move.slice(2, 4));

  return {
    from: [rowOf(from), colOf(from)],
    to: [rowOf(to), colOf(to)],
    side: applied.movingPiece.color,
    movingPiece: applied.movingPiece.kind,
    capturedPiece: applied.capturedPiece?.kind ?? null,
    isCapture: applied.capturedPiece != null,
    isCheck: checkedKingSquare != null,
    checkedKing:
      checkedKingSquare != null
        ? [rowOf(checkedKingSquare), colOf(checkedKingSquare)]
        : null,
  };
}

export function extractPvHeadMove(pv: string | null | undefined): string | null {
  if (!pv) return null;
  for (const token of pv.split(/\s+/)) {
    if (/^[a-i][0-9][a-i][0-9]$/.test(token)) {
      return token;
    }
  }
  return null;
}
