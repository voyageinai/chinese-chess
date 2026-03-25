"use client";

import React, { useId, useMemo } from "react";
import { parseFen } from "@/lib/fen";
import { BOARD_COLS, BOARD_ROWS, INITIAL_FEN } from "@/lib/constants";
import type { Piece, PieceKind, Color } from "@/lib/types";

export interface BoardMoveIndicator {
  from: [number, number];
  to: [number, number];
  side?: Color;
  preview?: boolean;
  variant?: "move" | "pv";
  capture?: boolean;
  check?: boolean;
  checkedKing?: [number, number] | null;
}

interface BoardProps {
  fen?: string;
  moveIndicators?: BoardMoveIndicator[];
  animateKey?: string | number;
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

function buildMovePath(from: [number, number], to: [number, number]) {
  const fromX = toX(from[1]);
  const fromY = toY(from[0]);
  const toXPos = toX(to[1]);
  const toYPos = toY(to[0]);
  const deltaRow = to[0] - from[0];
  const deltaCol = to[1] - from[1];
  const clearance = 20;

  const points: [number, number][] = [[fromX, fromY]];

  if (Math.abs(deltaRow) === 2 && Math.abs(deltaCol) === 1) {
    const legX = toX(from[1]);
    const legY = toY(from[0] + Math.sign(deltaRow));
    points.push([legX, legY]);
  } else if (Math.abs(deltaRow) === 1 && Math.abs(deltaCol) === 2) {
    const legX = toX(from[1] + Math.sign(deltaCol));
    const legY = toY(from[0]);
    points.push([legX, legY]);
  }

  points.push([toXPos, toYPos]);

  const [firstX, firstY] = points[0];
  const [secondX, secondY] = points[1];
  const [penultimateX, penultimateY] = points[points.length - 2];
  const [lastX, lastY] = points[points.length - 1];

  const firstLength = Math.hypot(secondX - firstX, secondY - firstY) || 1;
  const lastLength = Math.hypot(lastX - penultimateX, lastY - penultimateY) || 1;

  const startX = firstX + ((secondX - firstX) / firstLength) * clearance;
  const startY = firstY + ((secondY - firstY) / firstLength) * clearance;
  const endX = lastX - ((lastX - penultimateX) / lastLength) * clearance;
  const endY = lastY - ((lastY - penultimateY) / lastLength) * clearance;

  const pathPoints: [number, number][] = [[startX, startY]];
  if (points.length > 2) {
    pathPoints.push(...points.slice(1, -1));
  }
  pathPoints.push([endX, endY]);

  return {
    d: pathPoints
      .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
      .join(" "),
    fromX,
    fromY,
    toX: toXPos,
    toY: toYPos,
  };
}

function OverlayBadge({
  x,
  y,
  text,
  color,
  textColor = "var(--color-paper-50)",
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  textColor?: string;
}) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={10}
        fill="var(--color-paper-50)"
        stroke={color}
        strokeWidth={1.5}
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={textColor}
        fontSize={10}
        fontFamily="var(--font-sans)"
        fontWeight={700}
        style={{ paintOrder: "stroke", stroke: color, strokeWidth: 2 }}
      >
        {text}
      </text>
    </g>
  );
}

function CheckAlert({ square }: { square: [number, number] }) {
  const kingX = toX(square[1]);
  const kingY = toY(square[0]);

  return (
    <g opacity={0.9}>
      <circle
        cx={kingX}
        cy={kingY}
        r={23}
        fill="none"
        stroke="var(--color-vermilion)"
        strokeWidth={2.5}
        strokeDasharray="5 5"
      />
      <circle
        cx={kingX}
        cy={kingY}
        r={28}
        fill="none"
        stroke="var(--color-vermilion-light)"
        strokeWidth={1.5}
        opacity={0.45}
      />
      <OverlayBadge
        x={kingX + 17}
        y={kingY - 17}
        text="将"
        color="var(--color-vermilion)"
      />
    </g>
  );
}

function MoveOverlay({
  move,
  markerId,
  animate,
}: {
  move: BoardMoveIndicator;
  markerId: string;
  animate: boolean;
}) {
  const { d, fromX, fromY, toX: targetX, toY: targetY } = buildMovePath(
    move.from,
    move.to,
  );
  const variant = move.variant ?? "move";
  const color =
    move.side === "black" ? "var(--color-ink)" : "var(--color-vermilion)";
  const isPreview = move.preview === true;
  const isPv = variant === "pv";
  const strokeWidth = isPv ? 3.5 : isPreview ? 4 : 5;
  const overlayOpacity = isPv ? 0.44 : isPreview ? 0.5 : 0.72;
  const dashArray = isPv ? "10 12" : isPreview ? "8 10" : undefined;

  return (
    <g
      opacity={overlayOpacity}
      style={
        animate
          ? { animation: "board-move-indicator 720ms cubic-bezier(0.22, 1, 0.36, 1)" }
          : undefined
      }
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashArray}
        markerEnd={`url(#${markerId})`}
      />
      <circle
        cx={fromX}
        cy={fromY}
        r={isPv ? 8 : 10}
        fill={color}
        opacity={isPv ? 0.12 : isPreview ? 0.16 : 0.22}
      />
      <circle
        cx={fromX}
        cy={fromY}
        r={isPv ? 3.5 : 4.5}
        fill={color}
        opacity={0.9}
      />
      <circle
        cx={targetX}
        cy={targetY}
        r={isPv ? 20 : 24}
        fill="none"
        stroke={color}
        strokeWidth={isPreview ? 2.5 : 3}
      />
      <circle
        cx={targetX}
        cy={targetY}
        r={28}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={isPreview ? 0.24 : 0.32}
      />
      {move.capture && (
        <OverlayBadge
          x={targetX + 18}
          y={targetY - 18}
          text="吃"
          color={color}
        />
      )}
      {isPv && (
        <OverlayBadge
          x={targetX + 18}
          y={targetY + 18}
          text="PV"
          color={color}
          textColor={color}
        />
      )}
      {move.check && move.checkedKing && <CheckAlert square={move.checkedKing} />}
    </g>
  );
}

export function Board({
  fen = INITIAL_FEN,
  moveIndicators = [],
  animateKey,
  width,
}: BoardProps) {
  const boardId = useId().replaceAll(":", "");
  const gameState = useMemo(() => parseFen(fen), [fen]);
  const primaryIndicatorIndex =
    animateKey != null
      ? moveIndicators.findIndex((indicator) => !indicator.preview && indicator.variant !== "pv")
      : -1;

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
      <defs>
        <marker
          id={`${boardId}-move-arrow-red`}
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-vermilion)" />
        </marker>
        <marker
          id={`${boardId}-move-arrow-black`}
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-ink)" />
        </marker>
      </defs>

      <style>
        {`
          @keyframes board-move-indicator {
            0% {
              opacity: 0;
              filter: saturate(0.8);
            }
            35% {
              opacity: 1;
            }
            100% {
              opacity: 1;
              filter: saturate(1);
            }
          }
        `}
      </style>

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

      {/* Move indicators */}
      {moveIndicators.map((indicator, index) => (
        <MoveOverlay
          key={
            index === primaryIndicatorIndex
              ? `move-${animateKey}`
              : `${indicator.variant ?? "move"}-${indicator.from.join("-")}-${indicator.to.join("-")}-${indicator.preview ? "preview" : "active"}-${indicator.capture ? "capture" : "quiet"}-${indicator.check ? "check" : "safe"}`
          }
          move={indicator}
          animate={index === primaryIndicatorIndex}
          markerId={
            indicator.side === "black"
              ? `${boardId}-move-arrow-black`
              : `${boardId}-move-arrow-red`
          }
        />
      ))}

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
