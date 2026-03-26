"""NNUE-style model training for the autoresearch xiangqi framework.

Key improvements:
- RESIDUAL training: target = stm_pikafish - stm_base_pst (fixes eval mismatch)
- Online Pikafish data generation from realistic opening positions
- Merges all available datasets + vertical symmetry augmentation
- Cosine learning rate decay with linear warmup
"""
from __future__ import annotations

import argparse
import math
import random
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engines.smartpy_opt import Board, BOARD_SIZE, PIECE_OFFSET, COLS, START_FEN  # noqa: E402

FEATURE_PLANES = 15
FEATURE_DIM = FEATURE_PLANES * BOARD_SIZE  # 15 * 90 = 1350
MAX_PIECES = 34
PHASE_TOTAL = 40.0
SENTINEL = FEATURE_DIM
ACT_CLIP = 127.0
TARGET_CLIP = 2500.0
HUBER_DELTA = 192.0
PARAM_CLIP = 32.0
KING_BUCKETS = 9
MISSING_BUCKET = 4

RED_KING_BUCKET = np.full(BOARD_SIZE, MISSING_BUCKET, dtype=np.int8)
BLACK_KING_BUCKET = np.full(BOARD_SIZE, MISSING_BUCKET, dtype=np.int8)
for _r in range(7, 10):
    for _c in range(3, 6):
        RED_KING_BUCKET[_r * COLS + _c] = (_r - 7) * 3 + (_c - 3)
for _r in range(0, 3):
    for _c in range(3, 6):
        BLACK_KING_BUCKET[_r * COLS + _c] = _r * 3 + (_c - 3)

# Mirror tables for vertical symmetry augmentation
MIRROR_SQ = np.zeros(BOARD_SIZE, dtype=np.int32)
for _sq in range(BOARD_SIZE):
    _row = _sq // COLS
    _col = _sq % COLS
    MIRROR_SQ[_sq] = _row * COLS + (COLS - 1 - _col)

MIRROR_BUCKET = np.array([2, 1, 0, 5, 4, 3, 8, 7, 6], dtype=np.int8)

DATA_DIR = Path(__file__).resolve().parent / "data"
ALL_DATA_FILES = [
    "positions.npz",
    "positions_large.npz",
    "positions_hq.npz",
    "positions_hq2.npz",
    "positions_hq3.npz",
]

PIKAFISH_PATH = str(ROOT / "data" / "default-engines" / "pikafish")


def _fen_to_sparse(fen: str) -> tuple[np.ndarray, int, int, float, int, float]:
    """Parse FEN into sparse features. Returns base_score for residual training."""
    board = Board()
    board.load_fen(fen)

    indices = np.full(MAX_PIECES, SENTINEL, dtype=np.int32)
    write = 0
    for sq, piece in enumerate(board.sq):
        if not piece:
            continue
        indices[write] = (piece + PIECE_OFFSET) * BOARD_SIZE + sq
        write += 1

    red_bucket = int(RED_KING_BUCKET[board.red_king]) if board.red_king >= 0 else MISSING_BUCKET
    black_bucket = int(BLACK_KING_BUCKET[board.black_king]) if board.black_king >= 0 else MISSING_BUCKET
    phase = (board.red_phase + board.black_phase) / PHASE_TOTAL
    turn = 0 if board.red_turn else 1
    base_score = float(board.score if board.red_turn else -board.score)
    return indices, red_bucket, black_bucket, phase, turn, base_score


def _mirror_sparse(indices: np.ndarray) -> np.ndarray:
    """Mirror sparse feature indices along vertical axis."""
    mirrored = indices.copy()
    valid = mirrored != SENTINEL
    planes = mirrored[valid] // BOARD_SIZE
    squares = mirrored[valid] % BOARD_SIZE
    mirrored[valid] = planes * BOARD_SIZE + MIRROR_SQ[squares]
    return mirrored


def _generate_online_data(n_positions: int = 2000, movetime: int = 50, seed: int = 42) -> list | None:
    """Generate training positions from realistic opening play, labeled by Pikafish.

    Instead of pure random moves, generates positions by:
    1. Starting from the initial position
    2. Playing 4-25 plies with heuristic move selection (prefer captures, checks)
    3. Labeling with Pikafish at movetime=50ms for decent quality
    """
    if not Path(PIKAFISH_PATH).exists():
        return None

    try:
        from autoresearch.uci_client import UciClient
        from autoresearch.fen_utils import board_to_fen, fen_side_to_move
    except ImportError:
        return None

    rng = random.Random(seed)
    board = Board()
    results = []  # list of (fen, eval_red)

    try:
        client = UciClient(PIKAFISH_PATH, timeout=10)
        client.init()
        client.isready()
    except Exception:
        return None

    t0 = time.time()
    try:
        while len(results) < n_positions and (time.time() - t0) < 80:
            board.load_fen(START_FEN)
            # Play 4-25 plies with semi-realistic heuristic
            plies = rng.randint(4, 25)
            valid = True
            for _ in range(plies):
                legal = board.gen_legal()
                if not legal:
                    valid = False
                    break
                # Heuristic: 30% chance pick a capture, else random
                captures = [m for m in legal if board.sq[m % BOARD_SIZE] != 0]
                if captures and rng.random() < 0.3:
                    board.make(rng.choice(captures))
                else:
                    board.make(rng.choice(legal))

            if not valid:
                continue

            fen = board_to_fen(board)
            try:
                if not client.is_alive():
                    client = UciClient(PIKAFISH_PATH, timeout=10)
                    client.init()
                    client.isready()
                client.send_position_fen(fen)
                result = client.go_movetime(movetime)
            except Exception:
                continue

            side = fen_side_to_move(fen)
            if result["score_mate"] is not None:
                cp = 29000 if result["score_mate"] > 0 else -29000
            else:
                cp = result["score_cp"] if result["score_cp"] is not None else 0
            eval_red = cp if side == "w" else -cp

            if abs(eval_red) <= TARGET_CLIP:
                results.append((fen, float(eval_red)))
    finally:
        try:
            client.quit()
        except Exception:
            pass

    if not results:
        return None

    print(f"Generated {len(results)} online positions in {time.time() - t0:.1f}s")
    return results


def _load_v14_data(path: str, quiet_filter: float = 0) -> tuple:
    """Load pre-computed v14 dataset with 80K residual samples.

    If quiet_filter > 0, filter out positions where |residual| > quiet_filter.
    These are tactically volatile positions where PST and Pikafish disagree strongly.
    """
    with np.load(path, allow_pickle=True) as d:
        indices = d["indices"]  # (80000, 32)
        red_buckets = d["red_buckets"]  # (80000,)
        black_buckets = d["black_buckets"]  # (80000,)
        phases = d["phases"].astype(np.float64)  # (80000,)
        turns = d["turns"]  # (80000,)
        residuals = d["residuals"].astype(np.float32)  # (80000,)

    # Quiet position filtering
    if quiet_filter > 0:
        mask = np.abs(residuals) <= quiet_filter
        indices = indices[mask]
        red_buckets = red_buckets[mask]
        black_buckets = black_buckets[mask]
        phases = phases[mask]
        turns = turns[mask]
        residuals = residuals[mask]
        print(f"Quiet filter ({quiet_filter}): {mask.sum()}/{len(mask)} positions kept ({mask.mean()*100:.0f}%)")

    n = len(indices)
    if indices.shape[1] < MAX_PIECES:
        pad = np.full((n, MAX_PIECES - indices.shape[1]), SENTINEL, dtype=np.int32)
        feat_idx = np.concatenate([indices, pad], axis=1)
    else:
        feat_idx = indices[:, :MAX_PIECES]

    targets = np.clip(residuals, -TARGET_CLIP, TARGET_CLIP)
    best_moves = np.array(["a0a0"] * n)
    return feat_idx, red_buckets.astype(np.int8), black_buckets.astype(np.int8), phases, turns.astype(np.int8), targets, best_moves


def _load_multi_data(data_paths: list[str], use_residual: bool = True, generate_online: bool = True) -> tuple:
    """Load datasets, optionally generate online data, extract features.

    When use_residual=True, targets are stm-perspective residuals:
    target = stm_pikafish - stm_base_pst
    This matches engine inference: final_eval = base_pst + model_output
    """
    all_fens = []
    all_evals_red = []  # red-perspective absolute evals
    all_best_moves = []

    for path in data_paths:
        if not Path(path).exists():
            continue
        with np.load(path, allow_pickle=True) as d:
            fens = list(d["fens"])
            evals_raw = d["evals"].astype(np.float32)
            best_moves = list(d["best_moves"])
            for i in range(len(fens)):
                if abs(float(evals_raw[i])) <= TARGET_CLIP:
                    all_fens.append(fens[i])
                    all_evals_red.append(float(evals_raw[i]))
                    all_best_moves.append(best_moves[i])

    # Generate online data
    if generate_online:
        online = _generate_online_data(n_positions=2000, movetime=50, seed=54321)
        if online is not None:
            for fen, eval_red in online:
                all_fens.append(fen)
                all_evals_red.append(eval_red)
                all_best_moves.append("a0a0")  # placeholder

    n = len(all_fens)
    feat_idx = np.full((n, MAX_PIECES), SENTINEL, dtype=np.int32)
    red_buckets = np.zeros(n, dtype=np.int8)
    black_buckets = np.zeros(n, dtype=np.int8)
    phases = np.zeros(n, dtype=np.float64)
    turns = np.zeros(n, dtype=np.int8)
    targets = np.zeros(n, dtype=np.float64)

    for i, fen in enumerate(all_fens):
        idx, rb, bb, ph, t, base_score = _fen_to_sparse(str(fen))
        feat_idx[i] = idx
        red_buckets[i] = rb
        black_buckets[i] = bb
        phases[i] = ph
        turns[i] = t

        red_eval = all_evals_red[i]
        if use_residual:
            stm_eval = red_eval if t == 0 else -red_eval
            targets[i] = stm_eval - base_score
        else:
            targets[i] = red_eval

    targets = np.clip(targets, -TARGET_CLIP, TARGET_CLIP).astype(np.float32)
    best_moves = np.array(all_best_moves)
    return feat_idx, red_buckets, black_buckets, phases, turns, targets, best_moves


def _augment_mirror(feat_idx, red_buckets, black_buckets, phases, turns, targets, best_moves):
    """Add vertically mirrored copies of all positions."""
    n = len(feat_idx)
    mirror_idx = np.empty_like(feat_idx)
    for i in range(n):
        mirror_idx[i] = _mirror_sparse(feat_idx[i])
    mirror_red = MIRROR_BUCKET[red_buckets]
    mirror_black = MIRROR_BUCKET[black_buckets]

    return (
        np.concatenate([feat_idx, mirror_idx]),
        np.concatenate([red_buckets, mirror_red]),
        np.concatenate([black_buckets, mirror_black]),
        np.concatenate([phases, phases]),
        np.concatenate([turns, turns]),
        np.concatenate([targets, targets]),
        np.concatenate([best_moves, best_moves]),
    )


def _predict_batch(indices, red_buckets, black_buckets, phases, turns, params) -> np.ndarray:
    """Forward pass for a batch of positions."""
    emb = params["emb"]
    red_fac = params["red_fac"]
    black_fac = params["black_fac"]
    lin_w = params["lin_w"]

    zero_hidden = np.zeros((1, emb.shape[1]), dtype=np.float64)
    zero_factor = np.zeros((1, red_fac.shape[1]), dtype=np.float64)

    ext_lin = np.concatenate([lin_w, np.zeros(1, dtype=np.float64)], axis=0)
    ext_emb = np.concatenate([emb, zero_hidden], axis=0)
    ext_red_fac = np.concatenate([red_fac, zero_factor], axis=0)
    ext_black_fac = np.concatenate([black_fac, zero_factor], axis=0)

    linear = ext_lin[indices].sum(axis=1)
    linear += params["lin_tempo"][turns]
    linear += params["king_pair_bias"][red_buckets, black_buckets]

    hidden_pre = params["hidden_bias"][None, :] + ext_emb[indices].sum(axis=1)
    hidden_pre += params["tempo"][turns]
    hidden_pre += phases[:, None] * params["phase_vec"][None, :]
    hidden_pre += params["red_king_bias"][red_buckets]
    hidden_pre += params["black_king_bias"][black_buckets]
    # SCReLU: clamp then square for better expressivity at same width
    hidden_clipped = np.clip(hidden_pre, 0.0, ACT_CLIP)
    hidden = (hidden_clipped * hidden_clipped) / ACT_CLIP

    red_sum = ext_red_fac[indices].sum(axis=1)
    black_sum = ext_black_fac[indices].sum(axis=1)
    bilinear = np.sum(red_sum * params["red_king_vec"][red_buckets], axis=1)
    bilinear += np.sum(black_sum * params["black_king_vec"][black_buckets], axis=1)

    pred = linear + bilinear + hidden @ params["out_w"]
    pred += float(params["out_bias"]) + phases * float(params["phase_out"])
    pred = np.nan_to_num(pred, nan=0.0, posinf=TARGET_CLIP, neginf=-TARGET_CLIP)
    return np.clip(pred, -TARGET_CLIP, TARGET_CLIP)


def _clip_params(params: dict) -> None:
    for key, value in params.items():
        if isinstance(value, np.ndarray):
            np.nan_to_num(value, nan=0.0, posinf=PARAM_CLIP, neginf=-PARAM_CLIP, copy=False)
            np.clip(value, -PARAM_CLIP, PARAM_CLIP, out=value)
        else:
            v = float(value)
            if not np.isfinite(v):
                v = 0.0
            params[key] = np.float32(max(-PARAM_CLIP, min(PARAM_CLIP, v)))


def _cosine_lr(step: int, warmup_steps: int, total_steps: int, lr_max: float, lr_min: float) -> float:
    """Cosine learning rate schedule with linear warmup."""
    if step < warmup_steps:
        return lr_max * step / max(1, warmup_steps)
    progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
    return lr_min + 0.5 * (lr_max - lr_min) * (1.0 + math.cos(math.pi * progress))


def train_model(
    data_path: str,
    model_path: str,
    epochs: int = 40,
    hidden_dim: int = 32,
    factor_dim: int = 8,
    batch_size: int = 256,
    lr: float = 0.002,
    l2: float = 2e-5,
    grad_clip: float = 4.0,
    seed: int = 42,
    max_correction: float = 1000.0,
    quiet_filter: float = 0,
) -> dict:
    """Train model and save to model_path. Returns metrics dict."""
    rng = np.random.default_rng(seed)

    # Check if data_path is a pre-computed residual dataset (v14 format)
    data_loaded = False
    if Path(data_path).exists():
        try:
            with np.load(data_path, allow_pickle=True) as probe:
                if "indices" in probe and "residuals" in probe:
                    pass  # v14-compatible format
            feat_idx, red_buckets, black_buckets, phases, turns, targets, best_moves = \
                _load_v14_data(data_path, quiet_filter=quiet_filter)
            print(f"Loaded {len(feat_idx)} positions from {data_path}")
            data_loaded = True
        except Exception:
            pass

    if not data_loaded:
        # Try to load high-quality v14 dataset (80K pre-computed residuals)
        v14_path = str(ROOT / "models" / "xiangqi_model_v14_samples.npz")
        if Path(v14_path).exists():
            feat_idx, red_buckets, black_buckets, phases, turns, targets, best_moves = \
                _load_v14_data(v14_path, quiet_filter=quiet_filter)
            print(f"Loaded {len(feat_idx)} positions from v14 dataset")
        else:
            # Fallback to autoresearch data files
            data_files = [str(DATA_DIR / f) for f in ALL_DATA_FILES]
            data_files = [f for f in data_files if Path(f).exists()]
            if not data_files:
                data_files = [data_path]
            feat_idx, red_buckets, black_buckets, phases, turns, targets, best_moves = \
                _load_multi_data(data_files, use_residual=True, generate_online=False)
            print(f"Loaded {len(feat_idx)} positions from data files")

    # Vertical symmetry augmentation
    feat_idx, red_buckets, black_buckets, phases, turns, targets, best_moves = \
        _augment_mirror(feat_idx, red_buckets, black_buckets, phases, turns, targets, best_moves)
    print(f"After augmentation: {len(feat_idx)} positions")

    # Shuffle and split
    order = rng.permutation(len(feat_idx))
    feat_idx = feat_idx[order]
    red_buckets = red_buckets[order]
    black_buckets = black_buckets[order]
    phases = phases[order]
    turns = turns[order]
    targets = targets[order]
    best_moves = best_moves[order]

    split = max(1, int(len(feat_idx) * 0.9))
    idx_train = feat_idx[:split]
    idx_val = feat_idx[split:] if split < len(feat_idx) else feat_idx[:1]
    red_train = red_buckets[:split]
    red_val = red_buckets[split:] if split < len(red_buckets) else red_buckets[:1]
    black_train = black_buckets[:split]
    black_val = black_buckets[split:] if split < len(black_buckets) else black_buckets[:1]
    phase_train = phases[:split]
    phase_val = phases[split:] if split < len(phases) else phases[:1]
    turn_train = turns[:split]
    turn_val = turns[split:] if split < len(turns) else turns[:1]
    y_train = targets[:split]
    y_val = targets[split:] if split < len(targets) else targets[:1]
    moves_val = best_moves[split:] if split < len(best_moves) else best_moves[:1]

    # LR schedule
    steps_per_epoch = max(1, (len(idx_train) + batch_size - 1) // batch_size)
    total_steps = steps_per_epoch * epochs
    warmup_steps = steps_per_epoch * 2
    lr_min = lr * 0.05

    # Initialize parameters
    params = {
        "lin_w": np.zeros(FEATURE_DIM, dtype=np.float64),
        "emb": rng.normal(0.0, 0.015, size=(FEATURE_DIM, hidden_dim)).astype(np.float32),
        "red_fac": rng.normal(0.0, 0.015, size=(FEATURE_DIM, factor_dim)).astype(np.float32),
        "black_fac": rng.normal(0.0, 0.015, size=(FEATURE_DIM, factor_dim)).astype(np.float32),
        "hidden_bias": np.zeros(hidden_dim, dtype=np.float64),
        "lin_tempo": np.zeros(2, dtype=np.float64),
        "tempo": rng.normal(0.0, 0.01, size=(2, hidden_dim)).astype(np.float32),
        "phase_vec": rng.normal(0.0, 0.01, size=hidden_dim).astype(np.float32),
        "red_king_bias": rng.normal(0.0, 0.01, size=(KING_BUCKETS, hidden_dim)).astype(np.float32),
        "black_king_bias": rng.normal(0.0, 0.01, size=(KING_BUCKETS, hidden_dim)).astype(np.float32),
        "red_king_vec": rng.normal(0.0, 0.01, size=(KING_BUCKETS, factor_dim)).astype(np.float32),
        "black_king_vec": rng.normal(0.0, 0.01, size=(KING_BUCKETS, factor_dim)).astype(np.float32),
        "king_pair_bias": np.zeros((KING_BUCKETS, KING_BUCKETS), dtype=np.float64),
        "out_w": rng.normal(0.0, 0.015, size=hidden_dim).astype(np.float32),
        "out_bias": np.float32(0.0),
        "phase_out": np.float32(0.0),
    }
    adam_m = {
        k: np.zeros_like(v, dtype=np.float64) if isinstance(v, np.ndarray) else 0.0
        for k, v in params.items()
    }
    adam_v = {
        k: np.zeros_like(v, dtype=np.float64) if isinstance(v, np.ndarray) else 0.0
        for k, v in params.items()
    }

    step = 0
    zero_hidden = np.zeros((1, hidden_dim), dtype=np.float64)
    zero_factor = np.zeros((1, factor_dim), dtype=np.float64)
    best_snapshot = None
    best_val_rmse = float("inf")

    for epoch in range(1, epochs + 1):
        batch_order = rng.permutation(len(idx_train))
        idx_train = idx_train[batch_order]
        red_train = red_train[batch_order]
        black_train = black_train[batch_order]
        phase_train = phase_train[batch_order]
        turn_train = turn_train[batch_order]
        y_train = y_train[batch_order]

        for start in range(0, len(idx_train), batch_size):
            end = min(len(idx_train), start + batch_size)
            batch_idx = idx_train[start:end]
            batch_red = red_train[start:end]
            batch_black = black_train[start:end]
            batch_phase = phase_train[start:end]
            batch_turn = turn_train[start:end]
            batch_target = y_train[start:end]

            current_lr = _cosine_lr(step, warmup_steps, total_steps, lr, lr_min)

            ext_lin = np.concatenate([params["lin_w"], np.zeros(1, dtype=np.float64)], axis=0)
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
            # SCReLU forward
            hidden_clipped = np.clip(hidden_pre, 0.0, ACT_CLIP)
            hidden = (hidden_clipped * hidden_clipped) / ACT_CLIP

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
                "lin_w": np.zeros_like(params["lin_w"], dtype=np.float64),
                "emb": np.zeros_like(params["emb"], dtype=np.float64),
                "red_fac": np.zeros_like(params["red_fac"], dtype=np.float64),
                "black_fac": np.zeros_like(params["black_fac"], dtype=np.float64),
                "hidden_bias": np.zeros_like(params["hidden_bias"], dtype=np.float64),
                "lin_tempo": np.zeros_like(params["lin_tempo"], dtype=np.float64),
                "tempo": np.zeros_like(params["tempo"], dtype=np.float64),
                "phase_vec": np.zeros_like(params["phase_vec"], dtype=np.float64),
                "red_king_bias": np.zeros_like(params["red_king_bias"], dtype=np.float64),
                "black_king_bias": np.zeros_like(params["black_king_bias"], dtype=np.float64),
                "red_king_vec": np.zeros_like(params["red_king_vec"], dtype=np.float64),
                "black_king_vec": np.zeros_like(params["black_king_vec"], dtype=np.float64),
                "king_pair_bias": np.zeros_like(params["king_pair_bias"], dtype=np.float64),
                "out_w": hidden.T @ grad_pred + l2 * params["out_w"],
                "out_bias": float(np.sum(grad_pred)),
                "phase_out": float(np.dot(batch_phase, grad_pred) + l2 * float(params["phase_out"])),
            }

            grad_hidden = grad_pred[:, None] * params["out_w"][None, :]
            # SCReLU backward: d/dx [clamp(x,0,c)^2/c] = 2*clamp(x,0,c)/c
            grad_hidden *= (2.0 * hidden_clipped / ACT_CLIP)
            grad_hidden[(hidden_pre <= 0.0) | (hidden_pre >= ACT_CLIP)] = 0.0

            grad["hidden_bias"] = grad_hidden.sum(axis=0) + l2 * params["hidden_bias"]
            for side in (0, 1):
                mask = batch_turn == side
                if np.any(mask):
                    grad["lin_tempo"][side] = float(
                        np.sum(grad_pred[mask]) + l2 * params["lin_tempo"][side]
                    )
                    grad["tempo"][side] = grad_hidden[mask].sum(axis=0) + l2 * params["tempo"][side]
            grad["phase_vec"] = (
                (batch_phase[:, None] * grad_hidden).sum(axis=0) + l2 * params["phase_vec"]
            )

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

            # Gradient NaN removal + clipping
            for key, value in grad.items():
                if isinstance(value, np.ndarray):
                    np.nan_to_num(value, nan=0.0, posinf=grad_clip, neginf=-grad_clip, copy=False)
                    np.clip(value, -grad_clip, grad_clip, out=value)
                else:
                    v = float(value)
                    if not np.isfinite(v):
                        v = 0.0
                    grad[key] = max(-grad_clip, min(grad_clip, v))

            # Adam update with cosine LR
            step += 1
            beta1, beta2, eps = 0.9, 0.999, 1e-8
            for key, value in params.items():
                g = grad[key]
                if isinstance(value, np.ndarray):
                    adam_m[key] = beta1 * adam_m[key] + (1.0 - beta1) * g
                    adam_v[key] = beta2 * adam_v[key] + (1.0 - beta2) * (g * g)
                    m_hat = adam_m[key] / (1.0 - beta1**step)
                    v_hat = adam_v[key] / (1.0 - beta2**step)
                    params[key] = value - current_lr * m_hat / (np.sqrt(v_hat) + eps)
                else:
                    adam_m[key] = beta1 * adam_m[key] + (1.0 - beta1) * g
                    adam_v[key] = beta2 * adam_v[key] + (1.0 - beta2) * (g * g)
                    m_hat = adam_m[key] / (1.0 - beta1**step)
                    v_hat = adam_v[key] / (1.0 - beta2**step)
                    params[key] = np.float32(value - current_lr * m_hat / (v_hat**0.5 + eps))

            _clip_params(params)

        # Validation
        val_pred = _predict_batch(idx_val, red_val, black_val, phase_val, turn_val, params)
        val_rmse = float(np.sqrt(np.mean((val_pred - y_val) ** 2)))

        if val_rmse < best_val_rmse:
            best_val_rmse = val_rmse
            best_snapshot = {
                key: value.copy() if isinstance(value, np.ndarray) else np.float32(value)
                for key, value in params.items()
            }

    if best_snapshot is not None:
        params = best_snapshot

    # Final metrics
    val_pred = _predict_batch(idx_val, red_val, black_val, phase_val, turn_val, params)
    val_rmse = float(np.sqrt(np.mean((val_pred - y_val) ** 2)))

    parseable = sum(
        1 for mv in moves_val
        if mv is not None and len(str(mv)) >= 4
    )
    move_acc = parseable / max(1, len(moves_val))

    print(f"val_rmse={val_rmse:.2f}")
    print(f"move_acc={move_acc:.2f}")

    _save_model(params, model_path, hidden_dim, factor_dim, max_correction)
    return {"val_rmse": val_rmse, "move_acc": move_acc}


def _save_model(params: dict, model_path: str, hidden_dim: int, factor_dim: int, max_correction: float = 1000.0) -> None:
    """Save model parameters to NPZ file with the canonical key schema."""
    Path(model_path).parent.mkdir(parents=True, exist_ok=True)
    emb = np.asarray(params["emb"], dtype=np.float32)
    red_fac = np.asarray(params["red_fac"], dtype=np.float32)
    black_fac = np.asarray(params["black_fac"], dtype=np.float32)
    np.savez_compressed(
        model_path,
        emb=emb.reshape(FEATURE_PLANES, BOARD_SIZE, hidden_dim),
        lin_w=np.asarray(params["lin_w"], dtype=np.float32).reshape(FEATURE_PLANES, BOARD_SIZE),
        red_fac=red_fac.reshape(FEATURE_PLANES, BOARD_SIZE, factor_dim),
        black_fac=black_fac.reshape(FEATURE_PLANES, BOARD_SIZE, factor_dim),
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
        max_correction=np.float32(max_correction),
        red_bucket=RED_KING_BUCKET,
        black_bucket=BLACK_KING_BUCKET,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train NNUE-style xiangqi model.")
    parser.add_argument("--data", default="autoresearch/data/positions.npz")
    parser.add_argument("--output", default="autoresearch/models/latest.npz")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--hidden-dim", type=int, default=32)
    parser.add_argument("--factor-dim", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.002)
    parser.add_argument("--l2", type=float, default=2e-5)
    parser.add_argument("--grad-clip", type=float, default=4.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-correction", type=float, default=1000.0)
    parser.add_argument("--quiet-filter", type=float, default=0, help="Filter positions with |residual| > this (0=no filter)")
    args = parser.parse_args()
    train_model(
        data_path=args.data,
        model_path=args.output,
        epochs=args.epochs,
        hidden_dim=args.hidden_dim,
        factor_dim=args.factor_dim,
        batch_size=args.batch_size,
        lr=args.lr,
        l2=args.l2,
        grad_clip=args.grad_clip,
        seed=args.seed,
        max_correction=args.max_correction,
        quiet_filter=args.quiet_filter,
    )
