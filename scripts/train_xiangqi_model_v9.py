#!/usr/bin/env python3
"""Train XiangqiModelV9 with stronger Pikafish labels and same-split fallback checks."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.train_xiangqi_model_v3 as value_base  # noqa: E402
import scripts.train_xiangqi_model_v6 as base  # noqa: E402


base.MODEL_PATH = base.MODEL_DIR / "xiangqi_model_v9.npz"
base.REPORT_PATH = base.MODEL_DIR / "xiangqi_model_v9_report.json"

PREV_MODEL_PATH = ROOT / "models" / "xiangqi_model_v6.npz"


def _make_val_split(
    indices: np.ndarray,
    red_buckets: np.ndarray,
    black_buckets: np.ndarray,
    phases: np.ndarray,
    turns: np.ndarray,
    base_scores: np.ndarray,
    residuals: np.ndarray,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(indices))
    indices = indices[order]
    red_buckets = red_buckets[order]
    black_buckets = black_buckets[order]
    phases = phases[order]
    turns = turns[order]
    base_scores = base_scores[order]
    residuals = residuals[order]

    split = max(1, int(len(indices) * 0.9))
    idx_val = indices[split:] if split < len(indices) else indices[:1]
    red_val = red_buckets[split:] if split < len(red_buckets) else red_buckets[:1]
    black_val = black_buckets[split:] if split < len(black_buckets) else black_buckets[:1]
    phase_val = phases[split:] if split < len(phases) else phases[:1]
    turn_val = turns[split:] if split < len(turns) else turns[:1]
    base_val = base_scores[split:] if split < len(base_scores) else base_scores[:1]
    y_val = residuals[split:] if split < len(residuals) else residuals[:1]
    return idx_val, red_val, black_val, phase_val, turn_val, base_val, y_val


def _eval_value_params(
    params: dict[str, np.ndarray | float],
    idx_val: np.ndarray,
    red_val: np.ndarray,
    black_val: np.ndarray,
    phase_val: np.ndarray,
    turn_val: np.ndarray,
    base_val: np.ndarray,
    y_val: np.ndarray,
) -> dict[str, dict[str, float]]:
    val_resid = value_base.predict_batch(idx_val, red_val, black_val, phase_val, turn_val, params)
    val_full = base_val + val_resid
    val_target = base_val + y_val
    return {
        "base": value_base.metrics(base_val, val_target),
        "model": value_base.metrics(val_full, val_target),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train XiangqiModelV9 from stronger Pikafish labels with same-split fallback checks."
    )
    parser.add_argument("--teacher", type=str, default=str(ROOT / "data/default-engines/pikafish"))
    parser.add_argument("--samples", type=int, default=5200)
    parser.add_argument("--games", type=int, default=190)
    parser.add_argument("--teacher-depth", type=int, default=0)
    parser.add_argument("--teacher-movetime", type=int, default=60)
    parser.add_argument("--opening-random-plies", type=int, default=20)
    parser.add_argument("--max-game-plies", type=int, default=36)
    parser.add_argument("--hidden-dim", type=int, default=14)
    parser.add_argument("--factor-dim", type=int, default=4)
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.0004)
    parser.add_argument("--l2", type=float, default=6e-5)
    parser.add_argument("--grad-clip", type=float, default=0.7)
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
        policy,
        stats,
    ) = base.collect_samples(
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

    idx_val, red_val, black_val, phase_val, turn_val, base_val, y_val = _make_val_split(
        indices=indices,
        red_buckets=red_buckets,
        black_buckets=black_buckets,
        phases=phases,
        turns=turns,
        base_scores=base_scores,
        residuals=residuals,
        seed=args.seed,
    )

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
    policy_tables = base.build_policy_tables(policy)

    trained_eval = _eval_value_params(
        value_params,
        idx_val,
        red_val,
        black_val,
        phase_val,
        turn_val,
        base_val,
        y_val,
    )

    value_source = "v9_trained"
    report["same_split_eval"] = {"trained": trained_eval}
    if PREV_MODEL_PATH.exists():
        prev_params = base.load_value_params(PREV_MODEL_PATH)
        prev_eval = _eval_value_params(
            prev_params,
            idx_val,
            red_val,
            black_val,
            phase_val,
            turn_val,
            base_val,
            y_val,
        )
        report["same_split_eval"]["previous_v6"] = prev_eval
        trained_rmse = float(trained_eval["model"]["rmse"])
        prev_rmse = float(prev_eval["model"]["rmse"])
        if prev_rmse <= trained_rmse:
            value_params = prev_params
            value_source = "v6_fallback"
            report["value_fallback"] = {
                "used": True,
                "trained_val_rmse": trained_rmse,
                "fallback_val_rmse": prev_rmse,
                "fallback_model": PREV_MODEL_PATH.name,
            }
        else:
            report["value_fallback"] = {
                "used": False,
                "trained_val_rmse": trained_rmse,
                "fallback_val_rmse": prev_rmse,
                "fallback_model": PREV_MODEL_PATH.name,
            }

    report.update(stats)
    report["elapsed_sec"] = time.perf_counter() - t0
    report["policy_scale"] = base.POLICY_SCALE
    report["policy_smooth"] = base.POLICY_SMOOTH
    report["value_source"] = value_source
    report["policy_preview"] = {
        "opening_piece": policy_tables["policy_piece"][0].astype(int).tolist(),
        "opening_to_pawn": policy_tables["policy_to"][0, base.board_engine.P].astype(int)[:18].tolist(),
    }
    base.save_model(value_params, policy_tables, report)

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
