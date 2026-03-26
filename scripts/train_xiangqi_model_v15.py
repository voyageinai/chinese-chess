#!/usr/bin/env python3
"""Train XiangqiModelV15 by adding an explicit residual head on top of V13."""

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

import scripts.train_xiangqi_model_v14 as base  # noqa: E402
import scripts.train_xiangqi_model_v3 as value_base  # noqa: E402
import scripts.train_xiangqi_model_v6 as v6  # noqa: E402
from scripts.xiangqi_explicit_features import (  # noqa: E402
    FEATURE_COUNT,
    FEATURE_NAMES,
    apply_explicit_head,
    extract_side_features_from_sparse,
    fit_explicit_head,
)


MODEL_PATH = ROOT / "models" / "xiangqi_model_v15.npz"
REPORT_PATH = ROOT / "models" / "xiangqi_model_v15_report.json"
BASELINE_MODEL_PATH = ROOT / "models" / "xiangqi_model_v13.npz"
DEFAULT_CACHE_PATH = ROOT / "models" / "xiangqi_model_v14_samples.npz"


def _load_policy_from_model(model_path: Path) -> dict[str, np.ndarray]:
    with np.load(model_path) as data:
        return {
            "policy_piece": data["policy_piece"].astype(np.int16),
            "policy_to": data["policy_to"].astype(np.int16),
            "norm_black": data["norm_black"].astype(np.int16),
        }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train XiangqiModelV15 from cached V14 samples with a frozen V13 value backbone."
    )
    parser.add_argument("--cache-path", type=str, default=str(DEFAULT_CACHE_PATH))
    parser.add_argument("--baseline-model", type=str, default=str(BASELINE_MODEL_PATH))
    parser.add_argument("--policy-source", choices=("v13", "v14"), default="v13")
    parser.add_argument("--seed", type=int, default=20260324)
    args = parser.parse_args()

    cache_path = Path(args.cache_path)
    baseline_model_path = Path(args.baseline_model)
    if not cache_path.exists():
        print(f"Missing dataset cache: {cache_path}", file=sys.stderr)
        return 1
    if not baseline_model_path.exists():
        print(f"Missing baseline model: {baseline_model_path}", file=sys.stderr)
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
        policy_counts,
        stats,
    ) = base._load_dataset_cache(cache_path)

    train_idx, val_idx = base._split_order(len(indices), args.seed)
    value_params = v6.load_value_params(baseline_model_path)
    value_pred = value_base.predict_batch(indices, red_buckets, black_buckets, phases, turns, value_params)
    explicit_targets = (residuals - value_pred).astype(np.float32)
    explicit_features = extract_side_features_from_sparse(indices, turns, value_base.SENTINEL)

    explicit_head, fit_report = fit_explicit_head(
        train_features=explicit_features[train_idx],
        train_phases=phases[train_idx],
        train_targets=explicit_targets[train_idx],
        val_features=explicit_features[val_idx],
        val_phases=phases[val_idx],
        val_targets=explicit_targets[val_idx],
    )

    explicit_train = apply_explicit_head(explicit_features[train_idx], phases[train_idx], explicit_head)
    explicit_val = apply_explicit_head(explicit_features[val_idx], phases[val_idx], explicit_head)

    target_train = base_scores[train_idx] + residuals[train_idx]
    target_val = base_scores[val_idx] + residuals[val_idx]
    base_train_pred = base_scores[train_idx] + value_pred[train_idx]
    base_val_pred = base_scores[val_idx] + value_pred[val_idx]
    full_train_pred = base_train_pred + explicit_train
    full_val_pred = base_val_pred + explicit_val

    base_model_metrics = value_base.metrics(base_val_pred, target_val)
    full_model_metrics = value_base.metrics(full_val_pred, target_val)
    full_train_metrics = value_base.metrics(full_train_pred, target_train)

    policy_tables = (
        _load_policy_from_model(baseline_model_path)
        if args.policy_source == "v13"
        else v6.build_policy_tables(policy_counts)
    )

    report = {
        "samples": int(len(indices)),
        "samples_train": int(len(train_idx)),
        "samples_val": int(len(val_idx)),
        "baseline_model": baseline_model_path.name,
        "value_source": "v13_frozen",
        "policy_source": args.policy_source,
        "policy_scale": 56.0 if args.policy_source == "v13" else base.POLICY_SCALE,
        "policy_smooth": v6.POLICY_SMOOTH,
        "same_split_eval": {
            "base": {
                "base": value_base.metrics(base_scores[val_idx], target_val),
                "model": base_model_metrics,
            },
            "full": {
                "base": value_base.metrics(base_scores[val_idx], target_val),
                "model": full_model_metrics,
            },
        },
        "explicit_head": {
            "used": True,
            "feature_count": FEATURE_COUNT,
            "feature_names": list(FEATURE_NAMES),
            "fit": fit_report,
            "base_model": base_model_metrics,
            "full_model": full_model_metrics,
            "train_full_model": full_train_metrics,
        },
        "elapsed_sec": time.perf_counter() - t0,
        "dataset_cache": str(cache_path),
        "policy_preview": {
            "opening_piece": policy_tables["policy_piece"][0].astype(int).tolist(),
            "opening_to_pawn": policy_tables["policy_to"][0, base.v10.board_engine.P].astype(int)[:18].tolist(),
        },
    }
    report.update(stats)

    base.MODEL_PATH = MODEL_PATH
    base.REPORT_PATH = REPORT_PATH
    base._save_model(value_params, policy_tables, explicit_head, report)

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
