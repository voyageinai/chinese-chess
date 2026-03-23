"use client";

import React, { useMemo } from "react";
import { parseFen } from "@/lib/fen";
import { BOARD_COLS, BOARD_ROWS, INITIAL_FEN } from "@/lib/constants";
import type { Piece, PieceKind, Color } from "@/lib/types";

interface BoardProps {
  fen?: string;
  lastMove?: { from: [number, number]; to: [number, number] }; // [row, col] pairs
  width?: number;
}

// Chinese characters for pieces
const PIECE_LABELS: Record<Color, Record<PieceKind, string>> = {
  red: {
    k: "帅",
    a: "仕",
    e: "相",
    r: "车",
    c: "炮",
    h: "马",
    p: "兵",
  },
  black: {
    k: "将",
    a: "士",
    e: "象",
    r: "車",
    c: "砲",
    h: "馬",
    p: "卒",
  },
};

const CELL = 50; // cell size in SVG units
const PADDING = 30; // padding around the board
const BOARD_W = (BOARD_COLS - 1) * CELL; // 8 * 50 = 400
const BOARD_H = (BOARD_ROWS - 1) * CELL; // 9 * 50 = 450
const SVG_W = BOARD_W + PADDING * 2;
const SVG_H = BOARD_H + PADDING * 2;

function toX(col: number) {
  return PADDING + col * CELL;
}

function toY(row: number) {
  return PADDING + row * CELL;
}

function GridLines() {
  const lines: React.ReactElement[] = [];

  // Horizontal lines
  for (let r = 0; r < BOARD_ROWS; r++) {
    lines.push(
      <line
        key={`h${r}`}
        x1={toX(0)}
        y1={toY(r)}
        x2={toX(BOARD_COLS - 1)}
        y2={toY(r)}
        stroke="var(--color-ink-muted)"
        strokeWidth={1}
        strokeOpacity={0.6}
      />
    );
  }

  // Vertical lines (full height for edge columns, split for inner)
  for (let c = 0; c < BOARD_COLS; c++) {
    if (c === 0 || c === BOARD_COLS - 1) {
      // Edge columns: full height
      lines.push(
        <line
          key={`v${c}`}
          x1={toX(c)}
          y1={toY(0)}
          x2={toX(c)}
          y2={toY(BOARD_ROWS - 1)}
          stroke="var(--color-ink-muted)"
          strokeWidth={1}
          strokeOpacity={0.6}
        />
      );
    } else {
      // Inner columns: split at river (rows 4-5)
      lines.push(
        <line
          key={`vt${c}`}
          x1={toX(c)}
          y1={toY(0)}
          x2={toX(c)}
          y2={toY(4)}
          stroke="var(--color-ink-muted)"
          strokeWidth={1}
          strokeOpacity={0.6}
        />,
        <line
          key={`vb${c}`}
          x1={toX(c)}
          y1={toY(5)}
          x2={toX(c)}
          y2={toY(BOARD_ROWS - 1)}
          stroke="var(--color-ink-muted)"
          strokeWidth={1}
          strokeOpacity={0.6}
        />
      );
    }
  }

  // Palace diagonals (black palace: rows 0-2, cols 3-5)
  lines.push(
    <line
      key="pd1"
      x1={toX(3)}
      y1={toY(0)}
      x2={toX(5)}
      y2={toY(2)}
      stroke="var(--color-ink-muted)"
      strokeWidth={1}
      strokeOpacity={0.6}
    />,
    <line
      key="pd2"
      x1={toX(5)}
      y1={toY(0)}
      x2={toX(3)}
      y2={toY(2)}
      stroke="var(--color-ink-muted)"
      strokeWidth={1}
      strokeOpacity={0.6}
    />
  );

  // Palace diagonals (red palace: rows 7-9, cols 3-5)
  lines.push(
    <line
      key="pd3"
      x1={toX(3)}
      y1={toY(7)}
      x2={toX(5)}
      y2={toY(9)}
      stroke="var(--color-ink-muted)"
      strokeWidth={1}
      strokeOpacity={0.6}
    />,
    <line
      key="pd4"
      x1={toX(5)}
      y1={toY(7)}
      x2={toX(3)}
      y2={toY(9)}
      stroke="var(--color-ink-muted)"
      strokeWidth={1}
      strokeOpacity={0.6}
    />
  );

  return <>{lines}</>;
}

function RiverLabel() {
  return (
    <text
      x={SVG_W / 2}
      y={toY(4) + CELL / 2}
      textAnchor="middle"
      dominantBaseline="central"
      fill="var(--color-ink-muted)"
      fontSize={16}
      fontFamily="var(--font-brush)"
      opacity={0.5}
    >
      楚河{"　　　　"}汉界
    </text>
  );
}

function PieceView({
  piece,
  row,
  col,
}: {
  piece: Piece;
  row: number;
  col: number;
}) {
  const cx = toX(col);
  const cy = toY(row);
  const isRed = piece.color === "red";
  const label = PIECE_LABELS[piece.color][piece.kind];

  return (
    <g>
      {/* Piece background circle */}
      <circle
        cx={cx}
        cy={cy}
        r={20}
        fill="var(--color-paper-50)"
        stroke={isRed ? "var(--color-vermilion)" : "var(--color-ink)"}
        strokeWidth={2}
      />
      {/* Inner ring */}
      <circle
        cx={cx}
        cy={cy}
        r={17}
        fill="none"
        stroke={isRed ? "var(--color-vermilion)" : "var(--color-ink)"}
        strokeWidth={0.5}
        opacity={0.5}
      />
      {/* Piece label */}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill={isRed ? "var(--color-vermilion)" : "var(--color-ink)"}
        fontSize={20}
        fontFamily="var(--font-brush)"
        fontWeight="bold"
      >
        {label}
      </text>
    </g>
  );
}

function LastMoveHighlight({
  from,
  to,
}: {
  from: [number, number];
  to: [number, number];
}) {
  const size = 12;
  return (
    <>
      <rect
        x={toX(from[1]) - size}
        y={toY(from[0]) - size}
        width={size * 2}
        height={size * 2}
        rx={3}
        fill="var(--color-vermilion-light)"
        opacity={0.25}
      />
      <rect
        x={toX(to[1]) - size}
        y={toY(to[0]) - size}
        width={size * 2}
        height={size * 2}
        rx={3}
        fill="var(--color-vermilion-light)"
        opacity={0.35}
      />
    </>
  );
}

export function Board({
  fen = INITIAL_FEN,
  lastMove,
  width,
}: BoardProps) {
  const gameState = useMemo(() => parseFen(fen), [fen]);

  const pieces: { piece: Piece; row: number; col: number }[] = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const piece = gameState.board[r * BOARD_COLS + c];
      if (piece) {
        pieces.push({ piece, row: r, col: c });
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      width={width ?? SVG_W}
      className="select-none"
      style={{ maxWidth: "100%", height: "auto" }}
    >
      {/* Board background */}
      <rect
        x={0}
        y={0}
        width={SVG_W}
        height={SVG_H}
        rx={4}
        fill="var(--color-paper-300)"
      />

      {/* Grid lines */}
      <GridLines />

      {/* River text */}
      <RiverLabel />

      {/* Last move highlight */}
      {lastMove && (
        <LastMoveHighlight from={lastMove.from} to={lastMove.to} />
      )}

      {/* Pieces */}
      {pieces.map(({ piece, row, col }) => (
        <PieceView
          key={`${row}-${col}`}
          piece={piece}
          row={row}
          col={col}
        />
      ))}
    </svg>
  );
}
