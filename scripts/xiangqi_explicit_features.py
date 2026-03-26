#!/usr/bin/env python3
"""Handcrafted Xiangqi features plus a small linear residual head."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from engines import smartpy_opt as board_engine


FEATURE_NAMES = (
    "advisor_count",
    "bishop_count",
    "advisor_pair",
    "bishop_pair",
    "guard_score",
    "crossed_pawns",
    "center_crossed_pawns",
    "flank_crossed_pawns",
    "connected_crossed_pawns",
    "pawn_advance_sum",
    "rook_file_pressure",
    "rook_rank_pressure",
    "cannon_file_pressure",
    "cannon_rank_pressure",
    "knight_mobility",
    "knight_leg_blocks",
    "advanced_rooks",
    "advanced_cannons",
    "advanced_knights",
)

FEATURE_COUNT = len(FEATURE_NAMES)


@dataclass
class ExplicitHead:
    mean: np.ndarray
    invstd: np.ndarray
    weights: np.ndarray
    phase_weights: np.ndarray
    bias: float
    phase_bias: float
    clip: float
    ridge: float


def _line_blockers(sq: list[int], fr: int, to: int) -> int | None:
    if fr == to:
        return None
    fr_r = board_engine.ROW_OF[fr]
    to_r = board_engine.ROW_OF[to]
    fr_c = board_engine.COL_OF[fr]
    to_c = board_engine.COL_OF[to]
    if fr_r == to_r:
        step = 1 if to > fr else -1
    elif fr_c == to_c:
        step = board_engine.COLS if to > fr else -board_engine.COLS
    else:
        return None

    blockers = 0
    pos = fr + step
    while pos != to:
        if sq[pos]:
            blockers += 1
        pos += step
    return blockers


def _knight_stats(sq: list[int], fr: int, side: int) -> tuple[int, int]:
    mobility = 0
    blocked = 0
    for block, to in board_engine.KNIGHT_MOVES[fr]:
        if sq[block]:
            blocked += 1
            continue
        if sq[to] * side <= 0:
            mobility += 1
    return mobility, blocked


def _connected_crossed(pawns: list[tuple[int, int]]) -> int:
    by_row: dict[int, list[int]] = {}
    for row, col in pawns:
        by_row.setdefault(row, []).append(col)

    total = 0
    for cols in by_row.values():
        cols.sort()
        for left, right in zip(cols, cols[1:]):
            if right == left + 1:
                total += 1
    return total


def extract_red_features_from_sq(sq: list[int], red_king: int, black_king: int) -> np.ndarray:
    red_advisors = 0
    black_advisors = 0
    red_bishops = 0
    black_bishops = 0
    red_crossed = 0
    black_crossed = 0
    red_center_crossed = 0
    black_center_crossed = 0
    red_flank_crossed = 0
    black_flank_crossed = 0
    red_pawn_advance = 0
    black_pawn_advance = 0
    red_advanced_rooks = 0
    black_advanced_rooks = 0
    red_advanced_cannons = 0
    black_advanced_cannons = 0
    red_advanced_knights = 0
    black_advanced_knights = 0

    red_crossed_pos: list[tuple[int, int]] = []
    black_crossed_pos: list[tuple[int, int]] = []

    red_rook_file = 0
    black_rook_file = 0
    red_rook_rank = 0
    black_rook_rank = 0
    red_cannon_file = 0
    black_cannon_file = 0
    red_cannon_rank = 0
    black_cannon_rank = 0
    red_knight_mobility = 0
    black_knight_mobility = 0
    red_knight_blocks = 0
    black_knight_blocks = 0

    for fr, piece in enumerate(sq):
        if not piece:
            continue
        pt = piece if piece > 0 else -piece
        row = board_engine.ROW_OF[fr]
        col = board_engine.COL_OF[fr]

        if piece > 0:
            if pt == board_engine.A:
                red_advisors += 1
            elif pt == board_engine.B:
                red_bishops += 1
            elif pt == board_engine.P:
                red_pawn_advance += max(0, 6 - row)
                if row <= 4:
                    red_crossed += 1
                    red_crossed_pos.append((row, col))
                    if 3 <= col <= 5:
                        red_center_crossed += 1
                    if col <= 2 or col >= 6:
                        red_flank_crossed += 1
            elif pt == board_engine.R and row <= 4:
                red_advanced_rooks += 1
            elif pt == board_engine.C and row <= 4:
                red_advanced_cannons += 1
            elif pt == board_engine.N and row <= 4:
                red_advanced_knights += 1
        else:
            if pt == board_engine.A:
                black_advisors += 1
            elif pt == board_engine.B:
                black_bishops += 1
            elif pt == board_engine.P:
                black_pawn_advance += max(0, row - 3)
                if row >= 5:
                    black_crossed += 1
                    black_crossed_pos.append((row, col))
                    if 3 <= col <= 5:
                        black_center_crossed += 1
                    if col <= 2 or col >= 6:
                        black_flank_crossed += 1
            elif pt == board_engine.R and row >= 5:
                black_advanced_rooks += 1
            elif pt == board_engine.C and row >= 5:
                black_advanced_cannons += 1
            elif pt == board_engine.N and row >= 5:
                black_advanced_knights += 1

    for fr, piece in enumerate(sq):
        if not piece:
            continue
        pt = piece if piece > 0 else -piece
        if pt == board_engine.N:
            mobility, blocked = _knight_stats(sq, fr, 1 if piece > 0 else -1)
            if piece > 0:
                red_knight_mobility += mobility
                red_knight_blocks += blocked
            else:
                black_knight_mobility += mobility
                black_knight_blocks += blocked
            continue

        if pt not in (board_engine.R, board_engine.C):
            continue

        target = black_king if piece > 0 else red_king
        if target < 0:
            continue
        blockers = _line_blockers(sq, fr, target)
        if blockers is None:
            continue
        same_file = board_engine.COL_OF[fr] == board_engine.COL_OF[target]
        same_rank = board_engine.ROW_OF[fr] == board_engine.ROW_OF[target]

        if pt == board_engine.R and blockers == 0:
            if piece > 0:
                if same_file:
                    red_rook_file += 1
                if same_rank:
                    red_rook_rank += 1
            else:
                if same_file:
                    black_rook_file += 1
                if same_rank:
                    black_rook_rank += 1
        elif pt == board_engine.C and blockers == 1:
            if piece > 0:
                if same_file:
                    red_cannon_file += 1
                if same_rank:
                    red_cannon_rank += 1
            else:
                if same_file:
                    black_cannon_file += 1
                if same_rank:
                    black_cannon_rank += 1

    red_guard_score = red_advisors * 2 + red_bishops
    black_guard_score = black_advisors * 2 + black_bishops

    features = np.asarray(
        [
            red_advisors - black_advisors,
            red_bishops - black_bishops,
            int(red_advisors >= 2) - int(black_advisors >= 2),
            int(red_bishops >= 2) - int(black_bishops >= 2),
            red_guard_score - black_guard_score,
            red_crossed - black_crossed,
            red_center_crossed - black_center_crossed,
            red_flank_crossed - black_flank_crossed,
            _connected_crossed(red_crossed_pos) - _connected_crossed(black_crossed_pos),
            red_pawn_advance - black_pawn_advance,
            red_rook_file - black_rook_file,
            red_rook_rank - black_rook_rank,
            red_cannon_file - black_cannon_file,
            red_cannon_rank - black_cannon_rank,
            red_knight_mobility - black_knight_mobility,
            red_knight_blocks - black_knight_blocks,
            red_advanced_rooks - black_advanced_rooks,
            red_advanced_cannons - black_advanced_cannons,
            red_advanced_knights - black_advanced_knights,
        ],
        dtype=np.float32,
    )
    return features


def extract_side_features_from_sparse(indices: np.ndarray, turns: np.ndarray, sentinel: int) -> np.ndarray:
    features = np.zeros((len(indices), FEATURE_COUNT), dtype=np.float32)
    for i, sample in enumerate(indices):
        sq = [board_engine.EMPTY] * board_engine.BOARD_SIZE
        red_king = -1
        black_king = -1
        for flat in sample:
            idx = int(flat)
            if idx == sentinel:
                break
            plane = idx // board_engine.BOARD_SIZE
            sq_idx = idx % board_engine.BOARD_SIZE
            piece = plane - board_engine.PIECE_OFFSET
            sq[sq_idx] = piece
            if piece == board_engine.K:
                red_king = sq_idx
            elif piece == -board_engine.K:
                black_king = sq_idx

        feat = extract_red_features_from_sq(sq, red_king, black_king)
        if int(turns[i]) == 1:
            feat = -feat
        features[i] = feat
    return features


def _design_matrix(features: np.ndarray, phases: np.ndarray, mean: np.ndarray, invstd: np.ndarray) -> np.ndarray:
    scaled = np.nan_to_num((features - mean) * invstd, nan=0.0, posinf=0.0, neginf=0.0)
    phase_col = np.nan_to_num(phases.reshape(-1, 1).astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    return np.concatenate(
        [
            scaled,
            scaled * phase_col,
            np.ones((len(features), 1), dtype=np.float32),
            phase_col,
        ],
        axis=1,
    )


def fit_explicit_head(
    *,
    train_features: np.ndarray,
    train_phases: np.ndarray,
    train_targets: np.ndarray,
    val_features: np.ndarray,
    val_phases: np.ndarray,
    val_targets: np.ndarray,
    ridge_values: tuple[float, ...] = (0.1, 0.3, 1.0, 3.0, 10.0, 30.0),
    clip_values: tuple[float, ...] = (96.0, 128.0, 160.0, 192.0, 256.0),
) -> tuple[ExplicitHead, dict]:
    mean = train_features.mean(axis=0).astype(np.float32)
    std = train_features.std(axis=0).astype(np.float32)
    std[std < 1e-4] = 1.0
    invstd = (1.0 / std).astype(np.float32)

    train_targets = np.nan_to_num(train_targets.astype(np.float64), nan=0.0, posinf=0.0, neginf=0.0)
    val_targets = np.nan_to_num(val_targets.astype(np.float64), nan=0.0, posinf=0.0, neginf=0.0)
    x_train = _design_matrix(train_features, train_phases, mean, invstd).astype(np.float64)
    x_val = _design_matrix(val_features, val_phases, mean, invstd).astype(np.float64)

    feat_count = FEATURE_COUNT
    dim = x_train.shape[1]
    reg = np.ones(dim, dtype=np.float64)
    reg[-2:] = 0.0

    best_head: ExplicitHead | None = None
    best_report: dict | None = None

    xtx = x_train.T @ x_train
    xty = x_train.T @ train_targets
    eye = np.eye(dim, dtype=np.float64)

    for ridge in ridge_values:
        mat = xtx + eye * (ridge * reg)
        weights = np.linalg.solve(mat, xty)
        raw_train = x_train @ weights
        raw_val = x_val @ weights
        for clip in clip_values:
            pred_train = np.clip(raw_train, -clip, clip)
            pred_val = np.clip(raw_val, -clip, clip)
            train_rmse = float(np.sqrt(np.mean((pred_train - train_targets) ** 2)))
            val_rmse = float(np.sqrt(np.mean((pred_val - val_targets) ** 2)))
            if best_report is not None and val_rmse >= best_report["val_rmse"]:
                continue

            best_head = ExplicitHead(
                mean=mean.copy(),
                invstd=invstd.copy(),
                weights=weights[:feat_count].astype(np.float32),
                phase_weights=weights[feat_count : feat_count * 2].astype(np.float32),
                bias=float(weights[-2]),
                phase_bias=float(weights[-1]),
                clip=float(clip),
                ridge=float(ridge),
            )
            best_report = {
                "train_rmse": train_rmse,
                "val_rmse": val_rmse,
                "clip": float(clip),
                "ridge": float(ridge),
            }

    if best_head is None or best_report is None:
        raise RuntimeError("failed to fit explicit head")

    return best_head, best_report


def apply_explicit_head(features: np.ndarray, phases: np.ndarray, head: ExplicitHead) -> np.ndarray:
    scaled = np.nan_to_num((features - head.mean) * head.invstd, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float64)
    phase_col = np.nan_to_num(phases.reshape(-1, 1), nan=0.0, posinf=0.0, neginf=0.0).astype(np.float64)
    pred = scaled @ head.weights.astype(np.float64)
    pred += (scaled * phase_col) @ head.phase_weights.astype(np.float64)
    pred += head.bias + phase_col.reshape(-1) * head.phase_bias
    return np.clip(pred, -head.clip, head.clip).astype(np.float32)
