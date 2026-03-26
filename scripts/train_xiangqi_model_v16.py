#!/usr/bin/env python3
"""Train a compact distilled Xiangqi model from Pikafish or Fairy-Stockfish Classic."""

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
import scripts.train_xiangqi_model_v6 as base  # noqa: E402
from engines import smartpy_opt as board_engine  # noqa: E402
from scripts.uci_teacher import UciTeacher  # noqa: E402


MODEL_DIR = ROOT / "models"
DEFAULT_POLICY_SCALE = 88.0

TEACHER_PROFILES: dict[str, dict[str, object]] = {
    "pikafish": {
        "path": ROOT / "data/default-engines/pikafish",
        "variant": None,
        "options": {"Threads": 1, "Hash": 16},
        "teacher_movetime": 35,
        "teacher_depth": None,
    },
    "fairy-classic": {
        "path": ROOT / "data/default-engines/fairy-stockfish",
        "variant": "xiangqi",
        "options": {"Threads": 1, "Hash": 16, "Use NNUE": False},
        "teacher_movetime": 45,
        "teacher_depth": None,
    },
}


def _default_model_name(profile: str) -> str:
    return f"xiangqi_model_v16_{profile.replace('-', '_')}_small"


def _resolve_artifacts(model_name: str) -> tuple[Path, Path]:
    return MODEL_DIR / f"{model_name}.npz", MODEL_DIR / f"{model_name}_report.json"


def _make_teacher(profile: str, teacher_path: str | None) -> tuple[UciTeacher, dict[str, object]]:
    config = dict(TEACHER_PROFILES[profile])
    if teacher_path is not None:
        config["path"] = Path(teacher_path)
    engine_path = Path(config["path"])
    teacher = UciTeacher(
        engine_path,
        variant=config["variant"],
        options=dict(config["options"]),
    )
    config["path"] = str(engine_path.resolve())
    return teacher, config


def collect_samples(
    *,
    teacher: UciTeacher,
    teacher_profile: str,
    sample_limit: int,
    games: int,
    teacher_depth: int | None,
    teacher_movetime: int | None,
    opening_random_plies: int,
    max_game_plies: int,
    seed: int,
) -> tuple[
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    dict[str, np.ndarray],
    dict,
]:
    rng = random.Random(seed)
    teacher.start()

    feat_idx: list[np.ndarray] = []
    red_buckets: list[int] = []
    black_buckets: list[int] = []
    phases: list[float] = []
    turns: list[int] = []
    base_scores: list[float] = []
    targets: list[float] = []
    policy = base._new_policy_counts()

    generated_games = 0
    total_teacher_ms = 0.0
    teacher_best_hits = 0

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
                teacher_score, best_uci = teacher.analyze(
                    fen,
                    depth=teacher_depth,
                    movetime=teacher_movetime,
                )
                total_teacher_ms += (time.perf_counter() - t0) * 1000.0

                teacher_score = max(-value_base.TARGET_CLIP, min(value_base.TARGET_CLIP, float(teacher_score)))
                best_move = teacher.uci_to_move(best_uci)
                if base._update_policy_counts(policy, board, legal, best_move, phase):
                    teacher_best_hits += 1
                else:
                    best_move = board_engine.NO_MOVE

                feat_idx.append(sparse_idx)
                red_buckets.append(red_bucket)
                black_buckets.append(black_bucket)
                phases.append(phase)
                turns.append(turn)
                base_scores.append(base_eval)
                targets.append(float(teacher_score - base_eval))

                if len(targets) >= sample_limit:
                    break

                if best_move == board_engine.NO_MOVE:
                    move = rng.choice(legal)
                elif ply < 8 and rng.random() < 0.18:
                    move = rng.choice(legal[: min(10, len(legal))])
                else:
                    move = best_move
                board.make(move)
    finally:
        teacher.close()

    stats = {
        "teacher_profile": teacher_profile,
        "teacher_path": teacher.engine_path,
        "teacher_depth": teacher_depth,
        "teacher_movetime": teacher_movetime,
        "games": generated_games,
        "samples": len(targets),
        "teacher_best_hits": teacher_best_hits,
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
        policy,
        stats,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train a compact distilled model from Pikafish or Fairy-Stockfish Classic."
    )
    parser.add_argument("--teacher-profile", choices=tuple(TEACHER_PROFILES), default="pikafish")
    parser.add_argument("--teacher", type=str, default=None)
    parser.add_argument("--model-name", type=str, default=None)
    parser.add_argument("--samples", type=int, default=2400)
    parser.add_argument("--games", type=int, default=96)
    parser.add_argument("--teacher-depth", type=int, default=0)
    parser.add_argument("--teacher-movetime", type=int, default=0)
    parser.add_argument("--opening-random-plies", type=int, default=18)
    parser.add_argument("--max-game-plies", type=int, default=34)
    parser.add_argument("--hidden-dim", type=int, default=10)
    parser.add_argument("--factor-dim", type=int, default=3)
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.00042)
    parser.add_argument("--l2", type=float, default=6e-5)
    parser.add_argument("--grad-clip", type=float, default=0.75)
    parser.add_argument("--policy-scale", type=float, default=DEFAULT_POLICY_SCALE)
    parser.add_argument("--seed", type=int, default=20260324)
    args = parser.parse_args()

    model_name = args.model_name or _default_model_name(args.teacher_profile)
    model_path, report_path = _resolve_artifacts(model_name)

    teacher, teacher_config = _make_teacher(args.teacher_profile, args.teacher)
    default_depth = teacher_config["teacher_depth"]
    default_movetime = teacher_config["teacher_movetime"]
    teacher_depth = args.teacher_depth if args.teacher_depth > 0 else default_depth
    teacher_movetime = args.teacher_movetime if args.teacher_movetime > 0 else default_movetime

    if not Path(teacher.engine_path).exists():
        print(f"Missing teacher binary: {teacher.engine_path}", file=sys.stderr)
        return 1

    t0 = time.perf_counter()
    (
        indices,
        red_buckets,
        black_buckets,
        phases,
        turns,
        base_scores,
        residuals,
        policy,
        stats,
    ) = collect_samples(
        teacher=teacher,
        teacher_profile=args.teacher_profile,
        sample_limit=args.samples,
        games=args.games,
        teacher_depth=teacher_depth,
        teacher_movetime=teacher_movetime,
        opening_random_plies=args.opening_random_plies,
        max_game_plies=args.max_game_plies,
        seed=args.seed,
    )
    if len(residuals) == 0:
        print("No samples generated.", file=sys.stderr)
        return 1

    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        value_params, report = value_base.train_model(
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

    old_model_path = base.MODEL_PATH
    old_report_path = base.REPORT_PATH
    old_policy_scale = base.POLICY_SCALE
    try:
        base.MODEL_PATH = model_path
        base.REPORT_PATH = report_path
        base.POLICY_SCALE = args.policy_scale

        policy_tables = base.build_policy_tables(policy)

        report.update(stats)
        report["elapsed_sec"] = time.perf_counter() - t0
        report["policy_scale"] = base.POLICY_SCALE
        report["policy_smooth"] = base.POLICY_SMOOTH
        report["value_source"] = "v16_compact_trained"
        report["teacher_variant"] = teacher_config["variant"]
        report["teacher_options"] = teacher_config["options"]
        report["model_name"] = model_name
        report["artifacts"] = {
            "model_path": str(model_path),
            "report_path": str(report_path),
        }
        report["policy_preview"] = {
            "opening_piece": policy_tables["policy_piece"][0].astype(int).tolist(),
            "opening_to_pawn": policy_tables["policy_to"][0, board_engine.P].astype(int)[:18].tolist(),
        }

        base.save_model(value_params, policy_tables, report)
    finally:
        base.MODEL_PATH = old_model_path
        base.REPORT_PATH = old_report_path
        base.POLICY_SCALE = old_policy_scale

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
