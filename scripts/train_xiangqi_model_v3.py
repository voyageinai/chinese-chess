#!/usr/bin/env python3
"""Train a stronger small residual Xiangqi evaluator on top of SmartPy-Opt."""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engines import smartpy_opt as teacher  # noqa: E402


MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "xiangqi_model_v3.npz"
REPORT_PATH = MODEL_DIR / "xiangqi_model_v3_report.json"

FEATURE_PLANES = 15
FEATURE_DIM = FEATURE_PLANES * teacher.BOARD_SIZE
MAX_PIECES = 32
PHASE_TOTAL = 40.0
SENTINEL = FEATURE_DIM
ACT_CLIP = 127.0
TARGET_CLIP = 2500.0
HUBER_DELTA = 192.0
PARAM_CLIP = 32.0
KING_BUCKETS = 9
MISSING_BUCKET = 4
CHAR_FROM_PIECE = {value: key for key, value in teacher.PIECE_FROM_CHAR.items()}

RED_KING_BUCKET = np.full(teacher.BOARD_SIZE, MISSING_BUCKET, dtype=np.int8)
BLACK_KING_BUCKET = np.full(teacher.BOARD_SIZE, MISSING_BUCKET, dtype=np.int8)
for r in range(7, 10):
    for c in range(3, 6):
        RED_KING_BUCKET[r * teacher.COLS + c] = (r - 7) * 3 + (c - 3)
for r in range(0, 3):
    for c in range(3, 6):
        BLACK_KING_BUCKET[r * teacher.COLS + c] = r * 3 + (c - 3)


def board_to_sparse(
    board: teacher.Board,
) -> tuple[np.ndarray, int, int, float, int, float]:
    indices = np.full(MAX_PIECES, SENTINEL, dtype=np.int32)
    write = 0
    for sq, piece in enumerate(board.sq):
        if not piece:
            continue
        indices[write] = (piece + teacher.PIECE_OFFSET) * teacher.BOARD_SIZE + sq
        write += 1

    red_bucket = int(RED_KING_BUCKET[board.red_king]) if board.red_king >= 0 else MISSING_BUCKET
    black_bucket = (
        int(BLACK_KING_BUCKET[board.black_king]) if board.black_king >= 0 else MISSING_BUCKET
    )
    phase = (board.red_phase + board.black_phase) / PHASE_TOTAL
    turn = 0 if board.red_turn else 1
    base_eval = float(board.score if board.red_turn else -board.score)
    return indices, red_bucket, black_bucket, phase, turn, base_eval


def evaluate_position(engine: teacher.Engine, fen: str, depth: int) -> tuple[int, int]:
    engine.board.load_fen(fen)
    engine.start_time = time.perf_counter()
    engine.stop_time = engine.start_time + 3600.0
    engine.stopped = False
    engine.nodes = 0
    engine.best_root = teacher.NO_MOVE
    score = engine._search(depth, -teacher.INF, teacher.INF, 0, True)
    return int(round(score)), engine.best_root


def board_to_fen(board: teacher.Board) -> str:
    rows = []
    for r in range(teacher.ROWS):
        empties = 0
        parts = []
        base = r * teacher.COLS
        for c in range(teacher.COLS):
            piece = board.sq[base + c]
            if piece == teacher.EMPTY:
                empties += 1
                continue
            if empties:
                parts.append(str(empties))
                empties = 0
            parts.append(CHAR_FROM_PIECE[piece])
        if empties:
            parts.append(str(empties))
        rows.append("".join(parts))
    side = "w" if board.red_turn else "b"
    return "/".join(rows) + f" {side} - - 0 1"


def collect_samples(
    games: int,
    sample_limit: int,
    search_depth: int,
    opening_random_plies: int,
    max_game_plies: int,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    rng = random.Random(seed)
    searcher = teacher.Engine()

    feat_idx = []
    red_buckets = []
    black_buckets = []
    phases = []
    turns = []
    base_scores = []
    targets = []

    total_nodes = 0
    generated_games = 0

    for _ in range(games):
        if len(targets) >= sample_limit:
            break

        generated_games += 1
        board = teacher.Board()
        board.load_fen(teacher.START_FEN)

        for _ in range(rng.randint(0, opening_random_plies)):
            legal = board.gen_legal()
            if not legal:
                break
            board.make(rng.choice(legal))

        for ply in range(max_game_plies):
            legal = board.gen_legal()
            if not legal:
                break

            sparse_idx, red_bucket, black_bucket, phase, turn, base_eval = board_to_sparse(board)
            fen = board_to_fen(board)
            teacher_score, best = evaluate_position(searcher, fen, search_depth)
            teacher_score = max(-TARGET_CLIP, min(TARGET_CLIP, float(teacher_score)))
            total_nodes += searcher.nodes

            feat_idx.append(sparse_idx)
            red_buckets.append(red_bucket)
            black_buckets.append(black_bucket)
            phases.append(phase)
            turns.append(turn)
            base_scores.append(base_eval)
            targets.append(float(teacher_score - base_eval))

            if len(targets) >= sample_limit:
                break

            move = best
            if move == teacher.NO_MOVE or move not in legal:
                move = rng.choice(legal)
            elif ply < 8 and rng.random() < 0.25:
                move = rng.choice(legal[: min(10, len(legal))])
            board.make(move)

    stats = {
        "games": generated_games,
        "samples": len(targets),
        "avg_nodes_per_sample": (total_nodes / len(targets)) if targets else 0.0,
        "search_depth": search_depth,
        "seed": seed,
    }
    return (
        np.asarray(feat_idx, dtype=np.int32),
        np.asarray(red_buckets, dtype=np.int8),
        np.asarray(black_buckets, dtype=np.int8),
        np.asarray(phases, dtype=np.float32),
        np.asarray(turns, dtype=np.int8),
        np.asarray(base_scores, dtype=np.float32),
        np.asarray(targets, dtype=np.float32),
        stats,
    )


def predict_batch(
    indices: np.ndarray,
    red_buckets: np.ndarray,
    black_buckets: np.ndarray,
    phases: np.ndarray,
    turns: np.ndarray,
    params: dict[str, np.ndarray | float],
) -> np.ndarray:
    emb = params["emb"]
    red_fac = params["red_fac"]
    black_fac = params["black_fac"]
    lin_w = params["lin_w"]
    hidden_bias = params["hidden_bias"]
    lin_tempo = params["lin_tempo"]
    tempo = params["tempo"]
    phase_vec = params["phase_vec"]
    red_king_bias = params["red_king_bias"]
    black_king_bias = params["black_king_bias"]
    red_king_vec = params["red_king_vec"]
    black_king_vec = params["black_king_vec"]
    king_pair_bias = params["king_pair_bias"]
    out_w = params["out_w"]
    out_bias = float(params["out_bias"])
    phase_out = float(params["phase_out"])

    ext_lin = np.concatenate([lin_w, np.zeros(1, dtype=np.float32)], axis=0)
    ext_emb = np.concatenate([emb, np.zeros((1, emb.shape[1]), dtype=np.float32)], axis=0)
    ext_red_fac = np.concatenate(
        [red_fac, np.zeros((1, red_fac.shape[1]), dtype=np.float32)],
        axis=0,
    )
    ext_black_fac = np.concatenate(
        [black_fac, np.zeros((1, black_fac.shape[1]), dtype=np.float32)],
        axis=0,
    )

    linear = ext_lin[indices].sum(axis=1)
    linear += lin_tempo[turns]
    linear += king_pair_bias[red_buckets, black_buckets]

    hidden_pre = hidden_bias[None, :] + ext_emb[indices].sum(axis=1)
    hidden_pre += tempo[turns]
    hidden_pre += phases[:, None] * phase_vec[None, :]
    hidden_pre += red_king_bias[red_buckets]
    hidden_pre += black_king_bias[black_buckets]
    hidden = np.clip(hidden_pre, 0.0, ACT_CLIP)

    red_sum = ext_red_fac[indices].sum(axis=1)
    black_sum = ext_black_fac[indices].sum(axis=1)
    bilinear = np.sum(red_sum * red_king_vec[red_buckets], axis=1)
    bilinear += np.sum(black_sum * black_king_vec[black_buckets], axis=1)

    pred = linear + bilinear + hidden @ out_w + out_bias + phases * phase_out
    pred = np.nan_to_num(pred, nan=0.0, posinf=TARGET_CLIP, neginf=-TARGET_CLIP)
    return np.clip(pred, -TARGET_CLIP, TARGET_CLIP)


def metrics(full_pred: np.ndarray, full_target: np.ndarray) -> dict[str, float]:
    err = full_pred - full_target
    rmse = float(np.sqrt(np.mean(err * err)))
    mae = float(np.mean(np.abs(err)))
    corr = float(np.corrcoef(full_pred, full_target)[0, 1]) if len(full_target) > 1 else 1.0
    return {"rmse": rmse, "mae": mae, "corr": corr}


def _clip_params(params: dict[str, np.ndarray | float]) -> None:
    for key, value in params.items():
        if isinstance(value, np.ndarray):
            np.clip(value, -PARAM_CLIP, PARAM_CLIP, out=value)
        else:
            params[key] = np.float32(max(-PARAM_CLIP, min(PARAM_CLIP, float(value))))


def train_model(
    indices: np.ndarray,
    red_buckets: np.ndarray,
    black_buckets: np.ndarray,
    phases: np.ndarray,
    turns: np.ndarray,
    base_scores: np.ndarray,
    residual_targets: np.ndarray,
    hidden_dim: int,
    factor_dim: int,
    epochs: int,
    batch_size: int,
    lr: float,
    l2: float,
    grad_clip: float,
    seed: int,
) -> tuple[dict[str, np.ndarray | float], dict]:
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(indices))
    indices = indices[order]
    red_buckets = red_buckets[order]
    black_buckets = black_buckets[order]
    phases = phases[order]
    turns = turns[order]
    base_scores = base_scores[order]
    residual_targets = residual_targets[order]

    split = max(1, int(len(indices) * 0.9))
    idx_train = indices[:split]
    idx_val = indices[split:] if split < len(indices) else indices[:1]
    red_train = red_buckets[:split]
    red_val = red_buckets[split:] if split < len(red_buckets) else red_buckets[:1]
    black_train = black_buckets[:split]
    black_val = black_buckets[split:] if split < len(black_buckets) else black_buckets[:1]
    phase_train = phases[:split]
    phase_val = phases[split:] if split < len(phases) else phases[:1]
    turn_train = turns[:split]
    turn_val = turns[split:] if split < len(turns) else turns[:1]
    base_train = base_scores[:split]
    base_val = base_scores[split:] if split < len(base_scores) else base_scores[:1]
    y_train = residual_targets[:split]
    y_val = residual_targets[split:] if split < len(residual_targets) else residual_targets[:1]

    params = {
        "lin_w": np.zeros(FEATURE_DIM, dtype=np.float32),
        "emb": rng.normal(0.0, 0.015, size=(FEATURE_DIM, hidden_dim)).astype(np.float32),
        "red_fac": rng.normal(0.0, 0.015, size=(FEATURE_DIM, factor_dim)).astype(np.float32),
        "black_fac": rng.normal(0.0, 0.015, size=(FEATURE_DIM, factor_dim)).astype(np.float32),
        "hidden_bias": np.zeros(hidden_dim, dtype=np.float32),
        "lin_tempo": np.zeros(2, dtype=np.float32),
        "tempo": rng.normal(0.0, 0.01, size=(2, hidden_dim)).astype(np.float32),
        "phase_vec": rng.normal(0.0, 0.01, size=hidden_dim).astype(np.float32),
        "red_king_bias": rng.normal(0.0, 0.01, size=(KING_BUCKETS, hidden_dim)).astype(np.float32),
        "black_king_bias": rng.normal(0.0, 0.01, size=(KING_BUCKETS, hidden_dim)).astype(np.float32),
        "red_king_vec": rng.normal(0.0, 0.01, size=(KING_BUCKETS, factor_dim)).astype(np.float32),
        "black_king_vec": rng.normal(0.0, 0.01, size=(KING_BUCKETS, factor_dim)).astype(np.float32),
        "king_pair_bias": np.zeros((KING_BUCKETS, KING_BUCKETS), dtype=np.float32),
        "out_w": rng.normal(0.0, 0.015, size=hidden_dim).astype(np.float32),
        "out_bias": np.float32(0.0),
        "phase_out": np.float32(0.0),
    }
    adam_m = {
        k: np.zeros_like(v, dtype=np.float32) if isinstance(v, np.ndarray) else 0.0
        for k, v in params.items()
    }
    adam_v = {
        k: np.zeros_like(v, dtype=np.float32) if isinstance(v, np.ndarray) else 0.0
        for k, v in params.items()
    }

    step = 0
    zero_hidden = np.zeros((1, hidden_dim), dtype=np.float32)
    zero_factor = np.zeros((1, factor_dim), dtype=np.float32)
    history = []
    best_snapshot = None
    best_val_rmse = float("inf")

    for epoch in range(1, epochs + 1):
        batch_order = rng.permutation(len(idx_train))
        idx_train = idx_train[batch_order]
        red_train = red_train[batch_order]
        black_train = black_train[batch_order]
        phase_train = phase_train[batch_order]
        turn_train = turn_train[batch_order]
        base_train = base_train[batch_order]
        y_train = y_train[batch_order]

        for start in range(0, len(idx_train), batch_size):
            end = min(len(idx_train), start + batch_size)
            batch_idx = idx_train[start:end]
            batch_red = red_train[start:end]
            batch_black = black_train[start:end]
            batch_phase = phase_train[start:end]
            batch_turn = turn_train[start:end]
            batch_target = y_train[start:end]

            ext_lin = np.concatenate([params["lin_w"], np.zeros(1, dtype=np.float32)], axis=0)
            ext_emb = np.concatenate([params["emb"], zero_hidden], axis=0)
            ext_red_fac = np.concatenate([params["red_fac"], zero_factor], axis=0)
            ext_black_fac = np.concatenate([params["black_fac"], zero_factor], axis=0)

            linear = ext_lin[batch_idx].sum(axis=1)
            linear += params["lin_tempo"][batch_turn]
            linear += params["king_pair_bias"][batch_red, batch_black]

            hidden_pre = params["hidden_bias"][None, :] + ext_emb[batch_idx].sum(axis=1)
            hidden_pre += params["tempo"][batch_turn]
            hidden_pre += batch_phase[:, None] * params["phase_vec"][None, :]
            hidden_pre += params["red_king_bias"][batch_red]
            hidden_pre += params["black_king_bias"][batch_black]
            hidden = np.clip(hidden_pre, 0.0, ACT_CLIP)

            red_sum = ext_red_fac[batch_idx].sum(axis=1)
            black_sum = ext_black_fac[batch_idx].sum(axis=1)
            bilinear = np.sum(red_sum * params["red_king_vec"][batch_red], axis=1)
            bilinear += np.sum(black_sum * params["black_king_vec"][batch_black], axis=1)

            pred = linear + bilinear + hidden @ params["out_w"]
            pred += float(params["out_bias"]) + batch_phase * float(params["phase_out"])
            pred = np.nan_to_num(pred, nan=0.0, posinf=TARGET_CLIP, neginf=-TARGET_CLIP)
            pred = np.clip(pred, -TARGET_CLIP, TARGET_CLIP)

            batch_n = float(len(batch_idx))
            err = (pred - batch_target).astype(np.float32)
            abs_err = np.abs(err)
            grad_pred = np.where(abs_err <= HUBER_DELTA, err, HUBER_DELTA * np.sign(err)) / batch_n

            grad = {
                "lin_w": np.zeros_like(params["lin_w"], dtype=np.float32),
                "emb": np.zeros_like(params["emb"], dtype=np.float32),
                "red_fac": np.zeros_like(params["red_fac"], dtype=np.float32),
                "black_fac": np.zeros_like(params["black_fac"], dtype=np.float32),
                "hidden_bias": np.zeros_like(params["hidden_bias"], dtype=np.float32),
                "lin_tempo": np.zeros_like(params["lin_tempo"], dtype=np.float32),
                "tempo": np.zeros_like(params["tempo"], dtype=np.float32),
                "phase_vec": np.zeros_like(params["phase_vec"], dtype=np.float32),
                "red_king_bias": np.zeros_like(params["red_king_bias"], dtype=np.float32),
                "black_king_bias": np.zeros_like(params["black_king_bias"], dtype=np.float32),
                "red_king_vec": np.zeros_like(params["red_king_vec"], dtype=np.float32),
                "black_king_vec": np.zeros_like(params["black_king_vec"], dtype=np.float32),
                "king_pair_bias": np.zeros_like(params["king_pair_bias"], dtype=np.float32),
                "out_w": hidden.T @ grad_pred + l2 * params["out_w"],
                "out_bias": float(np.sum(grad_pred)),
                "phase_out": float(np.dot(batch_phase, grad_pred) + l2 * float(params["phase_out"])),
            }

            grad_hidden = grad_pred[:, None] * params["out_w"][None, :]
            grad_hidden[(hidden_pre <= 0.0) | (hidden_pre >= ACT_CLIP)] = 0.0

            grad["hidden_bias"] = grad_hidden.sum(axis=0) + l2 * params["hidden_bias"]
            for side in (0, 1):
                mask = batch_turn == side
                if np.any(mask):
                    grad["lin_tempo"][side] = float(
                        np.sum(grad_pred[mask]) + l2 * params["lin_tempo"][side]
                    )
                    grad["tempo"][side] = grad_hidden[mask].sum(axis=0) + l2 * params["tempo"][side]
            grad["phase_vec"] = (batch_phase[:, None] * grad_hidden).sum(axis=0) + l2 * params["phase_vec"]

            for bucket in range(KING_BUCKETS):
                red_mask = batch_red == bucket
                if np.any(red_mask):
                    grad["red_king_bias"][bucket] = (
                        grad_hidden[red_mask].sum(axis=0) + l2 * params["red_king_bias"][bucket]
                    )
                    grad["red_king_vec"][bucket] = (
                        (grad_pred[red_mask, None] * red_sum[red_mask]).sum(axis=0)
                        + l2 * params["red_king_vec"][bucket]
                    )
                else:
                    grad["red_king_bias"][bucket] = l2 * params["red_king_bias"][bucket]
                    grad["red_king_vec"][bucket] = l2 * params["red_king_vec"][bucket]

                black_mask = batch_black == bucket
                if np.any(black_mask):
                    grad["black_king_bias"][bucket] = (
                        grad_hidden[black_mask].sum(axis=0)
                        + l2 * params["black_king_bias"][bucket]
                    )
                    grad["black_king_vec"][bucket] = (
                        (grad_pred[black_mask, None] * black_sum[black_mask]).sum(axis=0)
                        + l2 * params["black_king_vec"][bucket]
                    )
                else:
                    grad["black_king_bias"][bucket] = l2 * params["black_king_bias"][bucket]
                    grad["black_king_vec"][bucket] = l2 * params["black_king_vec"][bucket]

            np.add.at(grad["king_pair_bias"], (batch_red, batch_black), grad_pred)
            grad["king_pair_bias"] += l2 * params["king_pair_bias"]

            sample_ids = np.repeat(np.arange(len(batch_idx)), batch_idx.shape[1])
            flat_idx = batch_idx.reshape(-1)
            valid = flat_idx != SENTINEL
            np.add.at(grad["lin_w"], flat_idx[valid], grad_pred[sample_ids[valid]])
            np.add.at(grad["emb"], flat_idx[valid], grad_hidden[sample_ids[valid]])
            np.add.at(
                grad["red_fac"],
                flat_idx[valid],
                grad_pred[sample_ids[valid], None] * params["red_king_vec"][batch_red][sample_ids[valid]],
            )
            np.add.at(
                grad["black_fac"],
                flat_idx[valid],
                grad_pred[sample_ids[valid], None]
                * params["black_king_vec"][batch_black][sample_ids[valid]],
            )
            grad["lin_w"] += l2 * params["lin_w"]
            grad["emb"] += l2 * params["emb"]
            grad["red_fac"] += l2 * params["red_fac"]
            grad["black_fac"] += l2 * params["black_fac"]

            for key, value in grad.items():
                if isinstance(value, np.ndarray):
                    np.clip(value, -grad_clip, grad_clip, out=value)
                else:
                    grad[key] = float(max(-grad_clip, min(grad_clip, value)))

            step += 1
            beta1 = 0.9
            beta2 = 0.999
            eps = 1e-8

            for key, value in params.items():
                g = grad[key]
                if isinstance(value, np.ndarray):
                    adam_m[key] = beta1 * adam_m[key] + (1.0 - beta1) * g
                    adam_v[key] = beta2 * adam_v[key] + (1.0 - beta2) * (g * g)
                    m_hat = adam_m[key] / (1.0 - beta1**step)
                    v_hat = adam_v[key] / (1.0 - beta2**step)
                    params[key] = value - lr * m_hat / (np.sqrt(v_hat) + eps)
                else:
                    adam_m[key] = beta1 * adam_m[key] + (1.0 - beta1) * g
                    adam_v[key] = beta2 * adam_v[key] + (1.0 - beta2) * (g * g)
                    m_hat = adam_m[key] / (1.0 - beta1**step)
                    v_hat = adam_v[key] / (1.0 - beta2**step)
                    params[key] = np.float32(value - lr * m_hat / (v_hat**0.5 + eps))

            _clip_params(params)

        train_resid = predict_batch(idx_train, red_train, black_train, phase_train, turn_train, params)
        val_resid = predict_batch(idx_val, red_val, black_val, phase_val, turn_val, params)
        train_full = base_train + train_resid
        val_full = base_val + val_resid
        train_target = base_train + y_train
        val_target = base_val + y_val
        val_rmse = float(np.sqrt(np.mean((val_full - val_target) ** 2)))

        history.append(
            {
                "epoch": epoch,
                "train_loss": float(np.mean((train_resid - y_train) ** 2)),
                "val_loss": float(np.mean((val_resid - y_val) ** 2)),
                "val_rmse": val_rmse,
            }
        )

        if val_rmse < best_val_rmse:
            best_val_rmse = val_rmse
            best_snapshot = {
                key: value.copy() if isinstance(value, np.ndarray) else np.float32(value)
                for key, value in params.items()
            }

    if best_snapshot is not None:
        params = best_snapshot

    train_resid = predict_batch(idx_train, red_train, black_train, phase_train, turn_train, params)
    val_resid = predict_batch(idx_val, red_val, black_val, phase_val, turn_val, params)
    train_full = base_train + train_resid
    val_full = base_val + val_resid
    train_target = base_train + y_train
    val_target = base_val + y_val

    base_train_metrics = metrics(base_train, train_target)
    base_val_metrics = metrics(base_val, val_target)
    train_metrics = metrics(train_full, train_target)
    val_metrics = metrics(val_full, val_target)

    report = {
        "samples_train": int(len(idx_train)),
        "samples_val": int(len(idx_val)),
        "hidden_dim": hidden_dim,
        "factor_dim": factor_dim,
        "epochs": epochs,
        "batch_size": batch_size,
        "learning_rate": lr,
        "l2": l2,
        "grad_clip": grad_clip,
        "huber_delta": HUBER_DELTA,
        "base_train": base_train_metrics,
        "base_val": base_val_metrics,
        "train": train_metrics,
        "val": val_metrics,
        "residual_std_train": float(np.std(y_train)),
        "residual_std_val": float(np.std(y_val)),
        "history_tail": history[-5:],
    }
    return params, report


def save_model(params: dict[str, np.ndarray | float], report: dict) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    emb = np.asarray(params["emb"], dtype=np.float32)
    hidden_dim = emb.shape[1]
    red_fac = np.asarray(params["red_fac"], dtype=np.float32)
    black_fac = np.asarray(params["black_fac"], dtype=np.float32)
    factor_dim = red_fac.shape[1]
    np.savez_compressed(
        MODEL_PATH,
        emb=emb.reshape(FEATURE_PLANES, teacher.BOARD_SIZE, hidden_dim),
        lin_w=np.asarray(params["lin_w"], dtype=np.float32).reshape(FEATURE_PLANES, teacher.BOARD_SIZE),
        red_fac=red_fac.reshape(FEATURE_PLANES, teacher.BOARD_SIZE, factor_dim),
        black_fac=black_fac.reshape(FEATURE_PLANES, teacher.BOARD_SIZE, factor_dim),
        hidden_bias=np.asarray(params["hidden_bias"], dtype=np.float32),
        lin_tempo=np.asarray(params["lin_tempo"], dtype=np.float32),
        tempo=np.asarray(params["tempo"], dtype=np.float32),
        phase_vec=np.asarray(params["phase_vec"], dtype=np.float32),
        red_king_bias=np.asarray(params["red_king_bias"], dtype=np.float32),
        black_king_bias=np.asarray(params["black_king_bias"], dtype=np.float32),
        red_king_vec=np.asarray(params["red_king_vec"], dtype=np.float32),
        black_king_vec=np.asarray(params["black_king_vec"], dtype=np.float32),
        king_pair_bias=np.asarray(params["king_pair_bias"], dtype=np.float32),
        out_w=np.asarray(params["out_w"], dtype=np.float32),
        out_bias=np.float32(params["out_bias"]),
        phase_out=np.float32(params["phase_out"]),
        act_clip=np.float32(ACT_CLIP),
        max_correction=np.float32(640.0),
        red_bucket=RED_KING_BUCKET,
        black_bucket=BLACK_KING_BUCKET,
    )
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train a stronger residual Xiangqi evaluator from SmartPy-Opt search."
    )
    parser.add_argument("--samples", type=int, default=5000)
    parser.add_argument("--games", type=int, default=180)
    parser.add_argument("--depth", type=int, default=4)
    parser.add_argument("--opening-random-plies", type=int, default=12)
    parser.add_argument("--max-game-plies", type=int, default=36)
    parser.add_argument("--hidden-dim", type=int, default=24)
    parser.add_argument("--factor-dim", type=int, default=8)
    parser.add_argument("--epochs", type=int, default=28)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.0025)
    parser.add_argument("--l2", type=float, default=2e-5)
    parser.add_argument("--grad-clip", type=float, default=4.0)
    parser.add_argument("--seed", type=int, default=20260324)
    args = parser.parse_args()

    t0 = time.perf_counter()
    indices, red_buckets, black_buckets, phases, turns, base_scores, residuals, stats = collect_samples(
        games=args.games,
        sample_limit=args.samples,
        search_depth=args.depth,
        opening_random_plies=args.opening_random_plies,
        max_game_plies=args.max_game_plies,
        seed=args.seed,
    )
    if len(residuals) == 0:
        print("No samples generated.", file=sys.stderr)
        return 1

    params, report = train_model(
        indices=indices,
        red_buckets=red_buckets,
        black_buckets=black_buckets,
        phases=phases,
        turns=turns,
        base_scores=base_scores,
        residual_targets=residuals,
        hidden_dim=args.hidden_dim,
        factor_dim=args.factor_dim,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        l2=args.l2,
        grad_clip=args.grad_clip,
        seed=args.seed,
    )

    report.update(stats)
    report["elapsed_sec"] = time.perf_counter() - t0
    save_model(params, report)

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
