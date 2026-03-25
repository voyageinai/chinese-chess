import { serializeFen } from "@/lib/fen";
import { formatResultReason, stringifyResultDetail } from "@/lib/results";
import type { Color, GameState, Move, PieceKind, ResultCode } from "@/lib/types";
import { generatePseudoMovesForColor } from "./rules";

const NATURAL_MOVE_LIMIT_PLIES = 100;

export interface JudgeVerdict {
  result: "red" | "black" | "draw";
  code: ResultCode;
  reason: string;
  detail: string | null;
}

export interface PlyMeta {
  key: string;
  mover: Color;
  move: string;
  movingPieceKind: PieceKind;
  gaveCheck: boolean;
  chaseKind: "none" | "standard" | "exempt";
}

function loserToWinner(loser: Color): Color {
  return loser === "red" ? "black" : "red";
}

export function positionKey(state: GameState): string {
  const fen = serializeFen(state);
  const parts = fen.split(" ");
  return `${parts[0]} ${parts[1]}`;
}

function isCountedChaseTarget(
  target: { kind: PieceKind; color: Color },
  targetSquare: number,
): boolean {
  if (target.kind === "k") return false;

  // Home-side pawn chasing is intentionally excluded from the fixed platform rule set.
  if (target.kind === "p") {
    if (target.color === "red") return targetSquare < 45;
    return targetSquare >= 45;
  }

  return true;
}

export function classifyChase(
  state: GameState,
  mover: Color,
  move: Move,
): "none" | "standard" | "exempt" {
  if (move.capture) return "none";

  const piece = state.board[move.to];
  if (!piece || piece.color !== mover) return "none";

  const threats = generatePseudoMovesForColor(state, mover).filter(
    (candidate) => candidate.from === move.to && candidate.capture,
  );
  const countedThreat = threats.find(
    (candidate) =>
      candidate.capture && isCountedChaseTarget(candidate.capture, candidate.to),
  );
  if (!countedThreat) return "none";

  return piece.kind === "k" || piece.kind === "p" ? "exempt" : "standard";
}

function buildVerdict(
  result: "red" | "black" | "draw",
  code: ResultCode,
  detail?: Record<string, string | number | boolean | null> | null,
): JudgeVerdict {
  return {
    result,
    code,
    reason: formatResultReason(code, detail ?? undefined),
    detail: stringifyResultDetail(detail),
  };
}

export function adjudicateRepetition(
  occurrences: number[],
  plyHistory: PlyMeta[],
): JudgeVerdict | null {
  if (occurrences.length < 3) return null;

  const cycleStart = occurrences[occurrences.length - 2];
  const cycleEnd = occurrences[occurrences.length - 1];

  const stats = {
    red: {
      moveCount: 0,
      allCheck: true,
      allChase: true,
      allStandardChase: true,
      allExemptChase: true,
    },
    black: {
      moveCount: 0,
      allCheck: true,
      allChase: true,
      allStandardChase: true,
      allExemptChase: true,
    },
  };

  for (let ply = cycleStart + 1; ply <= cycleEnd; ply++) {
    const meta = plyHistory[ply - 1];
    const sideStats = stats[meta.mover];
    sideStats.moveCount++;
    if (!meta.gaveCheck) sideStats.allCheck = false;
    if (meta.chaseKind === "none") sideStats.allChase = false;
    if (meta.chaseKind !== "standard") sideStats.allStandardChase = false;
    if (meta.chaseKind !== "exempt") sideStats.allExemptChase = false;
  }

  const redPerpetualCheck = stats.red.moveCount > 0 && stats.red.allCheck;
  const blackPerpetualCheck = stats.black.moveCount > 0 && stats.black.allCheck;

  if (redPerpetualCheck && !blackPerpetualCheck) {
    return buildVerdict("black", "perpetual_check", { side: "red" });
  }
  if (blackPerpetualCheck && !redPerpetualCheck) {
    return buildVerdict("red", "perpetual_check", { side: "black" });
  }
  if (redPerpetualCheck && blackPerpetualCheck) {
    return buildVerdict("draw", "mutual_perpetual_check");
  }

  const redPerpetualChase =
    stats.red.moveCount > 0 && stats.red.allChase && stats.red.allStandardChase;
  const blackPerpetualChase =
    stats.black.moveCount > 0 &&
    stats.black.allChase &&
    stats.black.allStandardChase;

  if (redPerpetualChase && !blackPerpetualChase) {
    return buildVerdict("black", "perpetual_chase", { side: "red" });
  }
  if (blackPerpetualChase && !redPerpetualChase) {
    return buildVerdict("red", "perpetual_chase", { side: "black" });
  }
  if (redPerpetualChase && blackPerpetualChase) {
    return buildVerdict("draw", "mutual_perpetual_chase");
  }

  // Repetition driven only by king/pawn chase remains legal in this platform rule set.
  const exemptOnlyChase =
    (stats.red.moveCount > 0 && stats.red.allChase && stats.red.allExemptChase) ||
    (stats.black.moveCount > 0 &&
      stats.black.allChase &&
      stats.black.allExemptChase);
  if (exemptOnlyChase) {
    return buildVerdict("draw", "repetition");
  }

  return buildVerdict("draw", "repetition");
}

export function judgeNaturalMoveLimit(state: GameState): JudgeVerdict | null {
  if (state.halfmoveClock < NATURAL_MOVE_LIMIT_PLIES) return null;
  return buildVerdict("draw", "natural_move_limit", {
    limit: NATURAL_MOVE_LIMIT_PLIES,
  });
}

export function buildForfeitVerdict(
  loser: Color,
  code: Extract<
    ResultCode,
    | "time_forfeit"
    | "illegal_move"
    | "invalid_move"
    | "engine_crash"
    | "engine_init_failed"
    | "engine_no_response"
  >,
  detail?: Record<string, string | number | boolean | null> | null,
): JudgeVerdict {
  return buildVerdict(loserToWinner(loser), code, { side: loser, ...detail });
}

export function buildStaticVerdict(
  result: "red" | "black" | "draw",
  code: Extract<ResultCode, "game_aborted" | "internal_error">,
): JudgeVerdict {
  return buildVerdict(result, code);
}
