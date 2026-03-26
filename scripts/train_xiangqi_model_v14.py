#!/usr/bin/env python3
"""Train XiangqiModelV14 with larger dual-teacher data and explicit features."""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import sys
import time
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.train_xiangqi_model_v3 as value_base  # noqa: E402
import scripts.train_xiangqi_model_v6 as v6  # noqa: E402
import scripts.train_xiangqi_model_v10 as v10  # noqa: E402
from scripts.uci_teacher import UciTeacher  # noqa: E402
from scripts.xiangqi_explicit_features import (  # noqa: E402
    FEATURE_COUNT,
    FEATURE_NAMES,
    ExplicitHead,
    apply_explicit_head,
    extract_side_features_from_sparse,
    fit_explicit_head,
)


MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "xiangqi_model_v14.npz"
REPORT_PATH = MODEL_DIR / "xiangqi_model_v14_report.json"
DATASET_CACHE_PATH = MODEL_DIR / "xiangqi_model_v14_samples.npz"
PREV_MODEL_PATH = ROOT / "models" / "xiangqi_model_v13.npz"

POLICY_SCALE = 52.0
v6.POLICY_SCALE = POLICY_SCALE


def _split_total(total: int, parts: int) -> list[int]:
    base = total // parts
    extra = total % parts
    return [base + (1 if i < extra else 0) for i in range(parts)]


def _worker_collect(config: dict) -> dict:
    primary_teacher = UciTeacher(
        config["primary_teacher"],
        options={"Threads": 1, "Hash": 16},
    )
    secondary_options: dict[str, str | int | bool] = {
        "Threads": 1,
        "Hash": 16,
        "Use NNUE": config["secondary_mode"] == "nnue",
    }
    if config["secondary_mode"] == "nnue":
        secondary_options["EvalFile"] = config["secondary_evalfile"]

    secondary_teacher = UciTeacher(
        config["secondary_teacher"],
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
    ) = v10.collect_samples(
        primary_teacher=primary_teacher,
        secondary_teacher=secondary_teacher,
        sample_limit=config["samples"],
        games=config["games"],
        primary_movetime=config["primary_movetime"],
        secondary_movetime=config["secondary_movetime"],
        primary_weight=config["primary_weight"],
        secondary_weight=config["secondary_weight"],
        disagreement_cp=config["disagreement_cp"],
        opening_random_plies=config["opening_random_plies"],
        max_game_plies=config["max_game_plies"],
        seed=config["seed"],
    )
    return {
        "indices": indices,
        "red_buckets": red_buckets,
        "black_buckets": black_buckets,
        "phases": phases,
        "turns": turns,
        "base_scores": base_scores,
        "residuals": residuals,
        "policy": policy,
        "stats": stats,
    }


def _collect_parallel(args: argparse.Namespace) -> tuple:
    worker_count = max(1, min(args.workers, args.samples, args.games))
    sample_parts = _split_total(args.samples, worker_count)
    game_parts = _split_total(args.games, worker_count)
    configs = []
    for idx in range(worker_count):
        configs.append(
            {
                "primary_teacher": args.primary_teacher,
                "secondary_teacher": args.secondary_teacher,
                "secondary_mode": args.secondary_mode,
                "secondary_evalfile": args.secondary_evalfile,
                "samples": sample_parts[idx],
                "games": game_parts[idx],
                "primary_movetime": args.primary_movetime,
                "secondary_movetime": args.secondary_movetime,
                "primary_weight": args.primary_weight,
                "secondary_weight": args.secondary_weight,
                "disagreement_cp": args.disagreement_cp,
                "opening_random_plies": args.opening_random_plies,
                "max_game_plies": args.max_game_plies,
                "seed": args.seed + idx * 9973,
            }
        )

    if worker_count == 1:
        parts = [_worker_collect(configs[0])]
    else:
        ctx = mp.get_context("spawn")
        with ctx.Pool(processes=worker_count) as pool:
            parts = pool.map(_worker_collect, configs)

    indices = np.concatenate([part["indices"] for part in parts], axis=0)
    red_buckets = np.concatenate([part["red_buckets"] for part in parts], axis=0)
    black_buckets = np.concatenate([part["black_buckets"] for part in parts], axis=0)
    phases = np.concatenate([part["phases"] for part in parts], axis=0)
    turns = np.concatenate([part["turns"] for part in parts], axis=0)
    base_scores = np.concatenate([part["base_scores"] for part in parts], axis=0)
    residuals = np.concatenate([part["residuals"] for part in parts], axis=0)

    policy = v6._new_policy_counts()
    for key in policy:
        for part in parts:
            policy[key] += part["policy"][key]

    non_oversampled = [max(1, int(part["stats"]["samples"]) - int(part["stats"]["oversample_count"])) for part in parts]
    total_non_oversampled = sum(non_oversampled)

    stats = {
        "collection_mode": "parallel" if worker_count > 1 else "single",
        "workers": worker_count,
        "worker_samples": [int(len(part["residuals"])) for part in parts],
        "primary_teacher_path": args.primary_teacher,
        "secondary_teacher_path": args.secondary_teacher,
        "primary_teacher_movetime": args.primary_movetime,
        "secondary_teacher_movetime": args.secondary_movetime,
        "primary_weight": args.primary_weight,
        "secondary_weight": args.secondary_weight,
        "disagreement_cp": args.disagreement_cp,
        "games": int(sum(int(part["stats"]["games"]) for part in parts)),
        "samples": int(len(residuals)),
        "primary_policy_hits": int(sum(int(part["stats"]["primary_policy_hits"]) for part in parts)),
        "secondary_policy_hits": int(sum(int(part["stats"]["secondary_policy_hits"]) for part in parts)),
        "agreement_samples": int(sum(int(part["stats"]["agreement_samples"]) for part in parts)),
        "disagreement_samples": int(sum(int(part["stats"]["disagreement_samples"]) for part in parts)),
        "oversample_count": int(sum(int(part["stats"]["oversample_count"]) for part in parts)),
        "avg_primary_ms": float(
            sum(float(part["stats"]["avg_primary_ms"]) * weight for part, weight in zip(parts, non_oversampled))
            / max(1, total_non_oversampled)
        ),
        "avg_secondary_ms": float(
            sum(float(part["stats"]["avg_secondary_ms"]) * weight for part, weight in zip(parts, non_oversampled))
            / max(1, total_non_oversampled)
        ),
        "seed": args.seed,
    }
    return (
        indices,
        red_buckets,
        black_buckets,
        phases,
        turns,
        base_scores,
        residuals,
        policy,
        stats,
    )


def _save_dataset_cache(
    path: Path,
    arrays: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray],
    policy: dict[str, np.ndarray],
    stats: dict,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    indices, red_buckets, black_buckets, phases, turns, base_scores, residuals = arrays
    np.savez_compressed(
        path,
        indices=indices,
        red_buckets=red_buckets,
        black_buckets=black_buckets,
        phases=phases,
        turns=turns,
        base_scores=base_scores,
        residuals=residuals,
        policy_best_piece=policy["best_piece"],
        policy_legal_piece=policy["legal_piece"],
        policy_best_to=policy["best_to"],
        policy_legal_to=policy["legal_to"],
        stats_json=np.asarray(json.dumps(stats)),
    )


def _load_dataset_cache(path: Path) -> tuple:
    with np.load(path, allow_pickle=False) as data:
        policy = {
            "best_piece": data["policy_best_piece"].astype(np.float64),
            "legal_piece": data["policy_legal_piece"].astype(np.float64),
            "best_to": data["policy_best_to"].astype(np.float64),
            "legal_to": data["policy_legal_to"].astype(np.float64),
        }
        stats = json.loads(str(data["stats_json"]))
        return (
            data["indices"].astype(np.int32),
            data["red_buckets"].astype(np.int8),
            data["black_buckets"].astype(np.int8),
            data["phases"].astype(np.float32),
            data["turns"].astype(np.int8),
            data["base_scores"].astype(np.float32),
            data["residuals"].astype(np.float32),
            policy,
            stats,
        )


def _split_order(size: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    order = rng.permutation(size)
    split = max(1, int(size * 0.9))
    train_idx = order[:split]
    val_idx = order[split:] if split < size else order[:1]
    return train_idx, val_idx


def _disabled_head() -> ExplicitHead:
    return ExplicitHead(
        mean=np.zeros(FEATURE_COUNT, dtype=np.float32),
        invstd=np.ones(FEATURE_COUNT, dtype=np.float32),
        weights=np.zeros(FEATURE_COUNT, dtype=np.float32),
        phase_weights=np.zeros(FEATURE_COUNT, dtype=np.float32),
        bias=0.0,
        phase_bias=0.0,
        clip=0.0,
        ridge=0.0,
    )


def _save_model(
    value_params: dict[str, np.ndarray | float],
    policy_tables: dict[str, np.ndarray],
    explicit_head: ExplicitHead,
    report: dict,
) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    emb = np.asarray(value_params["emb"], dtype=np.float32)
    hidden_dim = emb.shape[1]
    red_fac = np.asarray(value_params["red_fac"], dtype=np.float32)
    black_fac = np.asarray(value_params["black_fac"], dtype=np.float32)
    factor_dim = red_fac.shape[1]
    np.savez_compressed(
        MODEL_PATH,
        emb=emb.reshape(value_base.FEATURE_PLANES, v10.board_engine.BOARD_SIZE, hidden_dim),
        lin_w=np.asarray(value_params["lin_w"], dtype=np.float32).reshape(
            value_base.FEATURE_PLANES, v10.board_engine.BOARD_SIZE
        ),
        red_fac=red_fac.reshape(value_base.FEATURE_PLANES, v10.board_engine.BOARD_SIZE, factor_dim),
        black_fac=black_fac.reshape(value_base.FEATURE_PLANES, v10.board_engine.BOARD_SIZE, factor_dim),
        hidden_bias=np.asarray(value_params["hidden_bias"], dtype=np.float32),
        lin_tempo=np.asarray(value_params["lin_tempo"], dtype=np.float32),
        tempo=np.asarray(value_params["tempo"], dtype=np.float32),
        phase_vec=np.asarray(value_params["phase_vec"], dtype=np.float32),
        red_king_bias=np.asarray(value_params["red_king_bias"], dtype=np.float32),
        black_king_bias=np.asarray(value_params["black_king_bias"], dtype=np.float32),
        red_king_vec=np.asarray(value_params["red_king_vec"], dtype=np.float32),
        black_king_vec=np.asarray(value_params["black_king_vec"], dtype=np.float32),
        king_pair_bias=np.asarray(value_params["king_pair_bias"], dtype=np.float32),
        out_w=np.asarray(value_params["out_w"], dtype=np.float32),
        out_bias=np.float32(value_params["out_bias"]),
        phase_out=np.float32(value_params["phase_out"]),
        act_clip=np.float32(value_base.ACT_CLIP),
        max_correction=np.float32(640.0),
        red_bucket=value_base.RED_KING_BUCKET,
        black_bucket=value_base.BLACK_KING_BUCKET,
        policy_piece=policy_tables["policy_piece"],
        policy_to=policy_tables["policy_to"],
        norm_black=policy_tables["norm_black"],
        explicit_mean=np.asarray(explicit_head.mean, dtype=np.float32),
        explicit_invstd=np.asarray(explicit_head.invstd, dtype=np.float32),
        explicit_w=np.asarray(explicit_head.weights, dtype=np.float32),
        explicit_phase_w=np.asarray(explicit_head.phase_weights, dtype=np.float32),
        explicit_bias=np.float32(explicit_head.bias),
        explicit_phase_bias=np.float32(explicit_head.phase_bias),
        explicit_clip=np.float32(explicit_head.clip),
    )
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train XiangqiModelV14 from large Pikafish + Fairy classic labels."
    )
    parser.add_argument("--primary-teacher", type=str, default=str(ROOT / "data/default-engines/pikafish"))
    parser.add_argument("--secondary-teacher", type=str, default=str(ROOT / "data/default-engines/fairy-stockfish"))
    parser.add_argument("--secondary-mode", choices=("classic", "nnue"), default="classic")
    parser.add_argument(
        "--secondary-evalfile",
        type=str,
        default=str(ROOT / "data/default-engines/fairy-xiangqi.nnue"),
    )
    parser.add_argument("--samples", type=int, default=80000)
    parser.add_argument("--games", type=int, default=3200)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--primary-movetime", type=int, default=80)
    parser.add_argument("--secondary-movetime", type=int, default=60)
    parser.add_argument("--primary-weight", type=float, default=0.80)
    parser.add_argument("--secondary-weight", type=float, default=0.20)
    parser.add_argument("--disagreement-cp", type=int, default=70)
    parser.add_argument("--opening-random-plies", type=int, default=24)
    parser.add_argument("--max-game-plies", type=int, default=40)
    parser.add_argument("--hidden-dim", type=int, default=20)
    parser.add_argument("--factor-dim", type=int, default=6)
    parser.add_argument("--epochs", type=int, default=22)
    parser.add_argument("--batch-size", type=int, default=384)
    parser.add_argument("--lr", type=float, default=0.00030)
    parser.add_argument("--l2", type=float, default=6e-5)
    parser.add_argument("--grad-clip", type=float, default=0.7)
    parser.add_argument("--seed", type=int, default=20260324)
    parser.add_argument("--cache-path", type=str, default=str(DATASET_CACHE_PATH))
    parser.add_argument("--reuse-cache", action="store_true")
    args = parser.parse_args()

    cache_path = Path(args.cache_path)
    t0 = time.perf_counter()

    if args.reuse_cache and cache_path.exists():
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
        ) = _load_dataset_cache(cache_path)
    else:
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
        ) = _collect_parallel(args)
        _save_dataset_cache(
            cache_path,
            (indices, red_buckets, black_buckets, phases, turns, base_scores, residuals),
            policy,
            stats,
        )

    if len(residuals) == 0:
        print("No samples generated.", file=sys.stderr)
        return 1

    train_idx, val_idx = _split_order(len(indices), args.seed)

    value_params_trained, report = value_base.train_model(
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
    policy_tables = v6.build_policy_tables(policy)

    trained_eval = v10._eval_value_params(
        value_params_trained,
        indices[val_idx],
        red_buckets[val_idx],
        black_buckets[val_idx],
        phases[val_idx],
        turns[val_idx],
        base_scores[val_idx],
        residuals[val_idx],
    )
    report["same_split_eval"] = {"trained": trained_eval}

    value_source = "v14_trained"
    value_params = value_params_trained
    previous_eval = None
    if PREV_MODEL_PATH.exists():
        previous_params = v6.load_value_params(PREV_MODEL_PATH)
        previous_eval = v10._eval_value_params(
            previous_params,
            indices[val_idx],
            red_buckets[val_idx],
            black_buckets[val_idx],
            phases[val_idx],
            turns[val_idx],
            base_scores[val_idx],
            residuals[val_idx],
        )
        report["same_split_eval"]["previous_v13"] = previous_eval
        trained_rmse = float(trained_eval["model"]["rmse"])
        previous_rmse = float(previous_eval["model"]["rmse"])
        if previous_rmse <= trained_rmse:
            value_params = previous_params
            value_source = "v13_fallback"
            report["value_fallback"] = {
                "used": True,
                "trained_val_rmse": trained_rmse,
                "fallback_val_rmse": previous_rmse,
                "fallback_model": PREV_MODEL_PATH.name,
            }
        else:
            report["value_fallback"] = {
                "used": False,
                "trained_val_rmse": trained_rmse,
                "fallback_val_rmse": previous_rmse,
                "fallback_model": PREV_MODEL_PATH.name,
            }

    chosen_residual = value_base.predict_batch(indices, red_buckets, black_buckets, phases, turns, value_params)
    explicit_targets = (residuals - chosen_residual).astype(np.float32)
    explicit_features = extract_side_features_from_sparse(indices, turns, value_base.SENTINEL)

    explicit_head, explicit_fit_report = fit_explicit_head(
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
    base_train_pred = base_scores[train_idx] + chosen_residual[train_idx]
    base_val_pred = base_scores[val_idx] + chosen_residual[val_idx]
    full_train_pred = base_train_pred + explicit_train
    full_val_pred = base_val_pred + explicit_val

    base_val_metrics = value_base.metrics(base_val_pred, target_val)
    explicit_val_metrics = value_base.metrics(full_val_pred, target_val)
    explicit_train_metrics = value_base.metrics(full_train_pred, target_train)

    explicit_used = float(explicit_val_metrics["rmse"]) < float(base_val_metrics["rmse"])
    if not explicit_used:
        explicit_head = _disabled_head()
        explicit_train = np.zeros_like(explicit_train)
        explicit_val = np.zeros_like(explicit_val)
        full_train_pred = base_train_pred
        full_val_pred = base_val_pred
        explicit_train_metrics = value_base.metrics(full_train_pred, target_train)
        explicit_val_metrics = base_val_metrics

    report["same_split_eval"]["current_base"] = {
        "base": value_base.metrics(base_scores[val_idx], target_val),
        "model": base_val_metrics,
    }
    report["same_split_eval"]["current_full"] = {
        "base": value_base.metrics(base_scores[val_idx], target_val),
        "model": explicit_val_metrics,
    }
    report["explicit_head"] = {
        "used": explicit_used,
        "feature_count": FEATURE_COUNT,
        "feature_names": list(FEATURE_NAMES),
        "fit": explicit_fit_report,
        "base_model": base_val_metrics,
        "full_model": explicit_val_metrics,
        "train_full_model": explicit_train_metrics,
    }

    report.update(stats)
    report["elapsed_sec"] = time.perf_counter() - t0
    report["policy_scale"] = POLICY_SCALE
    report["policy_smooth"] = v6.POLICY_SMOOTH
    report["value_source"] = value_source
    report["secondary_mode"] = args.secondary_mode
    report["dataset_cache"] = str(cache_path)
    report["policy_preview"] = {
        "opening_piece": policy_tables["policy_piece"][0].astype(int).tolist(),
        "opening_to_pawn": policy_tables["policy_to"][0, v10.board_engine.P].astype(int)[:18].tolist(),
    }

    _save_model(value_params, policy_tables, explicit_head, report)

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
