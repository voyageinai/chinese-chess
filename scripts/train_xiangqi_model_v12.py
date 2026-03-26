#!/usr/bin/env python3
"""Train XiangqiModelV12 with Pikafish plus configurable Fairy secondary teacher."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.train_xiangqi_model_v10 as base  # noqa: E402


base.base.MODEL_PATH = base.base.MODEL_DIR / "xiangqi_model_v12.npz"
base.base.REPORT_PATH = base.base.MODEL_DIR / "xiangqi_model_v12_report.json"
base.base.POLICY_SCALE = 56.0
PREV_MODEL_PATH = ROOT / "models" / "xiangqi_model_v10.npz"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train XiangqiModelV12 from Pikafish + Fairy-Stockfish Classic/NNUE labels."
    )
    parser.add_argument("--primary-teacher", type=str, default=str(ROOT / "data/default-engines/pikafish"))
    parser.add_argument("--secondary-teacher", type=str, default=str(ROOT / "data/default-engines/fairy-stockfish"))
    parser.add_argument(
        "--secondary-mode",
        choices=("classic", "nnue"),
        default="classic",
    )
    parser.add_argument(
        "--secondary-evalfile",
        type=str,
        default=str(ROOT / "data/default-engines/fairy-xiangqi.nnue"),
    )
    parser.add_argument("--samples", type=int, default=5400)
    parser.add_argument("--games", type=int, default=220)
    parser.add_argument("--primary-movetime", type=int, default=75)
    parser.add_argument("--secondary-movetime", type=int, default=55)
    parser.add_argument("--primary-weight", type=float, default=0.78)
    parser.add_argument("--secondary-weight", type=float, default=0.22)
    parser.add_argument("--disagreement-cp", type=int, default=60)
    parser.add_argument("--opening-random-plies", type=int, default=22)
    parser.add_argument("--max-game-plies", type=int, default=36)
    parser.add_argument("--hidden-dim", type=int, default=16)
    parser.add_argument("--factor-dim", type=int, default=5)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.00034)
    parser.add_argument("--l2", type=float, default=6e-5)
    parser.add_argument("--grad-clip", type=float, default=0.7)
    parser.add_argument("--seed", type=int, default=20260324)
    args = parser.parse_args()

    t0 = time.perf_counter()
    primary_teacher = base.UciTeacher(
        args.primary_teacher,
        options={"Threads": 1, "Hash": 16},
    )

    secondary_options: dict[str, str | int | bool] = {
        "Threads": 1,
        "Hash": 16,
        "Use NNUE": args.secondary_mode == "nnue",
    }
    if args.secondary_mode == "nnue":
        secondary_options["EvalFile"] = args.secondary_evalfile

    secondary_teacher = base.UciTeacher(
        args.secondary_teacher,
        variant="xiangqi",
        options=secondary_options,
    )

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
        primary_teacher=primary_teacher,
        secondary_teacher=secondary_teacher,
        sample_limit=args.samples,
        games=args.games,
        primary_movetime=args.primary_movetime,
        secondary_movetime=args.secondary_movetime,
        primary_weight=args.primary_weight,
        secondary_weight=args.secondary_weight,
        disagreement_cp=args.disagreement_cp,
        opening_random_plies=args.opening_random_plies,
        max_game_plies=args.max_game_plies,
        seed=args.seed,
    )
    if len(residuals) == 0:
        print("No samples generated.", file=sys.stderr)
        return 1

    idx_val, red_val, black_val, phase_val, turn_val, base_val, y_val = base._make_val_split(
        indices=indices,
        red_buckets=red_buckets,
        black_buckets=black_buckets,
        phases=phases,
        turns=turns,
        base_scores=base_scores,
        residuals=residuals,
        seed=args.seed,
    )

    value_params, report = base.value_base.train_model(
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
    policy_tables = base.base.build_policy_tables(policy)

    trained_eval = base._eval_value_params(
        value_params,
        idx_val,
        red_val,
        black_val,
        phase_val,
        turn_val,
        base_val,
        y_val,
    )
    report["same_split_eval"] = {"trained": trained_eval}

    value_source = "v12_trained"
    if PREV_MODEL_PATH.exists():
        prev_params = base.base.load_value_params(PREV_MODEL_PATH)
        prev_eval = base._eval_value_params(
            prev_params,
            idx_val,
            red_val,
            black_val,
            phase_val,
            turn_val,
            base_val,
            y_val,
        )
        report["same_split_eval"]["previous_v10"] = prev_eval
        trained_rmse = float(trained_eval["model"]["rmse"])
        prev_rmse = float(prev_eval["model"]["rmse"])
        if prev_rmse <= trained_rmse:
            value_params = prev_params
            value_source = "v10_fallback"
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
    report["policy_scale"] = base.base.POLICY_SCALE
    report["policy_smooth"] = base.base.POLICY_SMOOTH
    report["value_source"] = value_source
    report["secondary_mode"] = args.secondary_mode
    report["policy_preview"] = {
        "opening_piece": policy_tables["policy_piece"][0].astype(int).tolist(),
        "opening_to_pawn": policy_tables["policy_to"][0, base.board_engine.P].astype(int)[:18].tolist(),
    }
    base.base.save_model(value_params, policy_tables, report)

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
