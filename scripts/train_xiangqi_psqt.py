#!/usr/bin/env python3
"""Train a bootstrap Xiangqi PSQT model by distilling SmartPy-Opt."""

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
MODEL_PATH = MODEL_DIR / "xiangqi_psqt_v0.npz"
REPORT_PATH = MODEL_DIR / "xiangqi_psqt_v0_report.json"

NON_EMPTY_PIECES = tuple(range(-7, 0)) + tuple(range(1, 8))
PIECE_TO_CHAR = {
    teacher.K: "K",
    teacher.A: "A",
    teacher.B: "B",
    teacher.N: "N",
    teacher.R: "R",
    teacher.C: "C",
    teacher.P: "P",
    -teacher.K: "k",
    -teacher.A: "a",
    -teacher.B: "b",
    -teacher.N: "n",
    -teacher.R: "r",
    -teacher.C: "c",
    -teacher.P: "p",
}


def piece_plane(piece: int) -> int:
    idx = piece + teacher.PIECE_OFFSET
    return idx if idx < teacher.PIECE_OFFSET else idx - 1


def board_to_fen(board: teacher.Board) -> str:
    rows = []
    sq = board.sq
    for r in range(teacher.ROWS):
        empties = 0
        parts = []
        base = r * teacher.COLS
        for c in range(teacher.COLS):
            piece = sq[base + c]
            if piece == teacher.EMPTY:
                empties += 1
                continue
            if empties:
                parts.append(str(empties))
                empties = 0
            parts.append(PIECE_TO_CHAR[piece])
        if empties:
            parts.append(str(empties))
        rows.append("".join(parts))
    side = "w" if board.red_turn else "b"
    return "/".join(rows) + f" {side} - - 0 1"


def board_to_feature(board: teacher.Board) -> np.ndarray:
    feat = np.zeros(14 * teacher.BOARD_SIZE + 1, dtype=np.float32)
    for sq, piece in enumerate(board.sq):
        if piece:
            feat[piece_plane(piece) * teacher.BOARD_SIZE + sq] = 1.0
    feat[-1] = 1.0
    return feat


def evaluate_position(engine: teacher.Engine, fen: str, depth: int) -> tuple[int, int]:
    engine.board.load_fen(fen)
    engine.start_time = time.perf_counter()
    engine.stop_time = engine.start_time + 3600.0
    engine.stopped = False
    engine.nodes = 0
    engine.best_root = teacher.NO_MOVE
    score = engine._search(depth, -teacher.INF, teacher.INF, 0, True)
    return int(round(score)), engine.best_root


def collect_samples(
    games: int,
    sample_limit: int,
    search_depth: int,
    opening_random_plies: int,
    max_game_plies: int,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, dict]:
    rng = random.Random(seed)
    searcher = teacher.Engine()
    features = []
    labels = []
    total_nodes = 0
    generated_games = 0

    for game_idx in range(games):
        if len(labels) >= sample_limit:
            break

        generated_games += 1
        board = teacher.Board()
        board.load_fen(teacher.START_FEN)

        # Randomize the first few plies to avoid only learning startpos-ish structure.
        for _ in range(rng.randint(0, opening_random_plies)):
            legal = board.gen_legal()
            if not legal:
                break
            board.make(rng.choice(legal))

        for ply in range(max_game_plies):
            legal = board.gen_legal()
            if not legal:
                break

            fen = board_to_fen(board)
            score_stm, best = evaluate_position(searcher, fen, search_depth)
            total_nodes += searcher.nodes

            # Train in red-perspective so the same board with flipped side-to-move
            # doesn't force contradictory targets.
            label = score_stm if board.red_turn else -score_stm
            features.append(board_to_feature(board))
            labels.append(label)

            if len(labels) >= sample_limit:
                break

            move = best
            if move == teacher.NO_MOVE or move not in legal:
                move = rng.choice(legal)
            elif ply < 6 and rng.random() < 0.20:
                # Keep some diversity even after the random opening.
                move = rng.choice(legal[: min(8, len(legal))])

            board.make(move)

    stats = {
        "games": generated_games,
        "samples": len(labels),
        "avg_nodes_per_sample": (total_nodes / len(labels)) if labels else 0.0,
        "search_depth": search_depth,
        "seed": seed,
    }
    return np.asarray(features, dtype=np.float32), np.asarray(labels, dtype=np.float32), stats


def train_ridge_psqt(
    x: np.ndarray,
    y: np.ndarray,
    reg: float,
    seed: int,
) -> tuple[np.ndarray, dict]:
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(x))
    x = x[order]
    y = y[order]

    split = max(1, int(len(x) * 0.9))
    x_train = x[:split]
    y_train = y[:split]
    x_val = x[split:] if split < len(x) else x[:1]
    y_val = y[split:] if split < len(y) else y[:1]

    y_train64 = y_train.astype(np.float64, copy=False)
    dim = x_train.shape[1]
    xtx = np.zeros((dim, dim), dtype=np.float64)
    xty = np.zeros(dim, dtype=np.float64)

    for row, target in zip(x_train, y_train64):
        active = np.flatnonzero(row)
        xty[active] += target
        xtx[np.ix_(active, active)] += 1.0

    xtx += np.eye(xtx.shape[0], dtype=np.float64) * reg
    xtx[-1, -1] -= reg  # Don't regularize the bias term.

    weights = np.linalg.solve(xtx, xty).astype(np.float32)

    def predict_sparse(x_data: np.ndarray) -> np.ndarray:
        pred = np.empty(len(x_data), dtype=np.float32)
        for i, row in enumerate(x_data):
            pred[i] = float(weights[np.flatnonzero(row)].sum())
        return pred

    train_pred = predict_sparse(x_train)
    val_pred = predict_sparse(x_val)

    def metrics(pred: np.ndarray, target: np.ndarray) -> dict:
        err = pred - target
        rmse = float(np.sqrt(np.mean(err * err)))
        mae = float(np.mean(np.abs(err)))
        corr = float(np.corrcoef(pred, target)[0, 1]) if len(target) > 1 else 1.0
        return {"rmse": rmse, "mae": mae, "corr": corr}

    train_metrics = metrics(train_pred, y_train)
    val_metrics = metrics(val_pred, y_val)

    psq = np.zeros((15, teacher.BOARD_SIZE), dtype=np.float32)
    for piece in NON_EMPTY_PIECES:
        plane = piece_plane(piece)
        start = plane * teacher.BOARD_SIZE
        end = start + teacher.BOARD_SIZE
        psq[piece + teacher.PIECE_OFFSET] = weights[start:end]

    report = {
        "samples_train": int(len(x_train)),
        "samples_val": int(len(x_val)),
        "regularization": reg,
        "train": train_metrics,
        "val": val_metrics,
        "bias": float(weights[-1]),
    }
    return np.concatenate([psq.reshape(-1), weights[-1:]]), report


def save_model(flat_weights: np.ndarray, report: dict) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    psq = flat_weights[:-1].reshape(15, teacher.BOARD_SIZE).astype(np.float32)
    bias = np.float32(flat_weights[-1])
    np.savez_compressed(MODEL_PATH, psq=psq, bias=bias)
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train a bootstrap Xiangqi PSQT model from SmartPy-Opt self-play."
    )
    parser.add_argument("--samples", type=int, default=1200)
    parser.add_argument("--games", type=int, default=80)
    parser.add_argument("--depth", type=int, default=3)
    parser.add_argument("--opening-random-plies", type=int, default=8)
    parser.add_argument("--max-game-plies", type=int, default=24)
    parser.add_argument("--reg", type=float, default=32.0)
    parser.add_argument("--seed", type=int, default=20260324)
    args = parser.parse_args()

    t0 = time.perf_counter()
    x, y, stats = collect_samples(
        games=args.games,
        sample_limit=args.samples,
        search_depth=args.depth,
        opening_random_plies=args.opening_random_plies,
        max_game_plies=args.max_game_plies,
        seed=args.seed,
    )
    if len(y) == 0:
        print("No samples generated.", file=sys.stderr)
        return 1

    flat_weights, report = train_ridge_psqt(x, y, reg=args.reg, seed=args.seed)
    report.update(stats)
    report["elapsed_sec"] = time.perf_counter() - t0
    save_model(flat_weights, report)

    print(f"saved model: {MODEL_PATH}")
    print(f"saved report: {REPORT_PATH}")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
