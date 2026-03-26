#!/usr/bin/env python3
"""Train XiangqiModelV5 from a strong external UCI teacher."""

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

import scripts.train_xiangqi_model_v3 as value_base  # noqa: E402
from engines import smartpy_opt as board_engine  # noqa: E402
from scripts.uci_teacher import UciTeacher  # noqa: E402


MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "xiangqi_model_v5.npz"
REPORT_PATH = MODEL_DIR / "xiangqi_model_v5_report.json"


def _uci_to_move(uci: str) -> int:
    if not uci or uci == "0000":
        return board_engine.NO_MOVE
    try:
        return board_engine._uci2m(uci)
    except Exception:
        return board_engine.NO_MOVE


def collect_samples(
    teacher_path: str,
    sample_limit: int,
    games: int,
    teacher_depth: int | None,
    teacher_movetime: int | None,
    opening_random_plies: int,
    max_game_plies: int,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    rng = random.Random(seed)
    teacher = UciTeacher(teacher_path)
    teacher.start()

    feat_idx: list[np.ndarray] = []
    red_buckets: list[int] = []
    black_buckets: list[int] = []
    phases: list[float] = []
    turns: list[int] = []
    base_scores: list[float] = []
    targets: list[float] = []

    generated_games = 0
    total_teacher_ms = 0.0
    best_hits = 0

    try:
        for _ in range(games):
            if len(targets) >= sample_limit:
                break

            generated_games += 1
            board = board_engine.Board()
            board.load_fen(board_engine.START_FEN)

            for _ in range(rng.randint(0, opening_random_plies)):
                legal = board.gen_legal()
                if not legal:
                    break
                board.make(rng.choice(legal))

            for ply in range(max_game_plies):
                legal = board.gen_legal()
                if not legal:
                    break

                sparse_idx, red_bucket, black_bucket, phase, turn, base_eval = value_base.board_to_sparse(board)
                fen = value_base.board_to_fen(board)
                t0 = time.perf_counter()
                teacher_score, best_uci = teacher.analyze(fen, depth=teacher_depth, movetime=teacher_movetime)
                total_teacher_ms += (time.perf_counter() - t0) * 1000.0

                teacher_score = max(-value_base.TARGET_CLIP, min(value_base.TARGET_CLIP, float(teacher_score)))
                feat_idx.append(sparse_idx)
                red_buckets.append(red_bucket)
                black_buckets.append(black_bucket)
                phases.append(phase)
                turns.append(turn)
                base_scores.append(base_eval)
                targets.append(float(teacher_score - base_eval))

                best_move = _uci_to_move(best_uci)
                if best_move in legal:
                    best_hits += 1
                else:
                    best_move = board_engine.NO_MOVE

                if len(targets) >= sample_limit:
                    break

                if best_move == board_engine.NO_MOVE:
                    move = rng.choice(legal)
                elif ply < 8 and rng.random() < 0.15:
                    move = rng.choice(legal[: min(10, len(legal))])
                else:
                    move = best_move
                board.make(move)
    finally:
        teacher.close()

    stats = {
        "teacher_path": teacher_path,
        "teacher_depth": teacher_depth,
        "teacher_movetime": teacher_movetime,
        "games": generated_games,
        "samples": len(targets),
        "teacher_best_hits": best_hits,
        "avg_teacher_ms": (total_teacher_ms / len(targets)) if targets else 0.0,
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


def save_model(params: dict[str, np.ndarray | float], report: dict) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    emb = np.asarray(params["emb"], dtype=np.float32)
    hidden_dim = emb.shape[1]
    red_fac = np.asarray(params["red_fac"], dtype=np.float32)
    black_fac = np.asarray(params["black_fac"], dtype=np.float32)
    factor_dim = red_fac.shape[1]
    np.savez_compressed(
        MODEL_PATH,
        emb=emb.reshape(value_base.FEATURE_PLANES, board_engine.BOARD_SIZE, hidden_dim),
        lin_w=np.asarray(params["lin_w"], dtype=np.float32).reshape(
            value_base.FEATURE_PLANES, board_engine.BOARD_SIZE
        ),
        red_fac=red_fac.reshape(value_base.FEATURE_PLANES, board_engine.BOARD_SIZE, factor_dim),
        black_fac=black_fac.reshape(value_base.FEATURE_PLANES, board_engine.BOARD_SIZE, factor_dim),
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
        act_clip=np.float32(value_base.ACT_CLIP),
        max_correction=np.float32(640.0),
        red_bucket=value_base.RED_KING_BUCKET,
        black_bucket=value_base.BLACK_KING_BUCKET,
    )
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train XiangqiModelV5 from a strong external UCI Xiangqi teacher."
    )
    parser.add_argument("--teacher", type=str, required=True)
    parser.add_argument("--samples", type=int, default=1400)
    parser.add_argument("--games", type=int, default=70)
    parser.add_argument("--teacher-depth", type=int, default=6)
    parser.add_argument("--teacher-movetime", type=int, default=None)
    parser.add_argument("--opening-random-plies", type=int, default=14)
    parser.add_argument("--max-game-plies", type=int, default=32)
    parser.add_argument("--hidden-dim", type=int, default=16)
    parser.add_argument("--factor-dim", type=int, default=6)
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.0007)
    parser.add_argument("--l2", type=float, default=5e-5)
    parser.add_argument("--grad-clip", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=20260324)
    args = parser.parse_args()
    teacher_depth = args.teacher_depth if args.teacher_depth and args.teacher_depth > 0 else None

    t0 = time.perf_counter()
    (
        indices,
        red_buckets,
        black_buckets,
        phases,
        turns,
        base_scores,
        residuals,
        stats,
    ) = collect_samples(
        teacher_path=args.teacher,
        sample_limit=args.samples,
        games=args.games,
        teacher_depth=teacher_depth,
        teacher_movetime=args.teacher_movetime,
        opening_random_plies=args.opening_random_plies,
        max_game_plies=args.max_game_plies,
        seed=args.seed,
    )
    if len(residuals) == 0:
        print("No samples generated.", file=sys.stderr)
        return 1

    params, report = value_base.train_model(
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
