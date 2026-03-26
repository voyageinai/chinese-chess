#!/usr/bin/env python3
"""Train XiangqiModelV10 with Pikafish + Fairy disagreement-aware labels."""

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


base.MODEL_PATH = base.MODEL_DIR / "xiangqi_model_v10.npz"
base.REPORT_PATH = base.MODEL_DIR / "xiangqi_model_v10_report.json"
base.POLICY_SCALE = 64.0

PREV_MODEL_PATH = ROOT / "models" / "xiangqi_model_v6.npz"


def _append_sample(
    feat_idx: list[np.ndarray],
    red_buckets: list[int],
    black_buckets: list[int],
    phases: list[float],
    turns: list[int],
    base_scores: list[float],
    targets: list[float],
    sparse_idx: np.ndarray,
    red_bucket: int,
    black_bucket: int,
    phase: float,
    turn: int,
    base_eval: float,
    teacher_score: float,
    sample_limit: int,
) -> bool:
    if len(targets) >= sample_limit:
        return False
    feat_idx.append(sparse_idx.copy())
    red_buckets.append(red_bucket)
    black_buckets.append(black_bucket)
    phases.append(phase)
    turns.append(turn)
    base_scores.append(base_eval)
    targets.append(float(teacher_score - base_eval))
    return True


def _update_policy_counts_weighted(
    counts: dict[str, np.ndarray],
    board: board_engine.Board,
    legal: list[int],
    best: int,
    phase: float,
    weight: float,
) -> bool:
    if weight <= 0.0:
        return False
    bucket = base._phase_bucket(phase)
    red_turn = board.red_turn

    for move in legal:
        fr = move // board_engine.MOVE_STRIDE
        to = move % board_engine.MOVE_STRIDE
        piece = board.sq[fr]
        pt = piece if piece > 0 else -piece
        nto = base._norm_sq(to, red_turn)
        counts["legal_piece"][bucket, pt] += 1.0
        counts["legal_to"][bucket, pt, nto] += 1.0

    if best not in legal:
        return False

    fr = best // board_engine.MOVE_STRIDE
    to = best % board_engine.MOVE_STRIDE
    piece = board.sq[fr]
    pt = piece if piece > 0 else -piece
    nto = base._norm_sq(to, red_turn)
    counts["best_piece"][bucket, pt] += weight
    counts["best_to"][bucket, pt, nto] += weight
    return True


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


def collect_samples(
    *,
    primary_teacher: UciTeacher,
    secondary_teacher: UciTeacher,
    sample_limit: int,
    games: int,
    primary_movetime: int,
    secondary_movetime: int,
    primary_weight: float,
    secondary_weight: float,
    disagreement_cp: int,
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
    primary_teacher.start()
    secondary_teacher.start()

    feat_idx: list[np.ndarray] = []
    red_buckets: list[int] = []
    black_buckets: list[int] = []
    phases: list[float] = []
    turns: list[int] = []
    base_scores: list[float] = []
    targets: list[float] = []
    policy = base._new_policy_counts()

    generated_games = 0
    primary_ms_total = 0.0
    secondary_ms_total = 0.0
    primary_hits = 0
    secondary_hits = 0
    agree_count = 0
    disagree_count = 0
    oversample_count = 0

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
                primary_score, primary_uci = primary_teacher.analyze(fen, movetime=primary_movetime)
                primary_ms_total += (time.perf_counter() - t0) * 1000.0

                t0 = time.perf_counter()
                secondary_score, secondary_uci = secondary_teacher.analyze(fen, movetime=secondary_movetime)
                secondary_ms_total += (time.perf_counter() - t0) * 1000.0

                primary_score = float(max(-value_base.TARGET_CLIP, min(value_base.TARGET_CLIP, primary_score)))
                secondary_score = float(max(-value_base.TARGET_CLIP, min(value_base.TARGET_CLIP, secondary_score)))

                primary_move = primary_teacher.uci_to_move(primary_uci)
                secondary_move = secondary_teacher.uci_to_move(secondary_uci)

                primary_valid = primary_move in legal
                secondary_valid = secondary_move in legal
                agree = primary_valid and secondary_valid and primary_move == secondary_move
                if agree:
                    agree_count += 1
                else:
                    disagree_count += 1

                if _update_policy_counts_weighted(policy, board, legal, primary_move, phase, 1.0):
                    primary_hits += 1
                secondary_policy_weight = 0.6 if agree else 0.2
                if _update_policy_counts_weighted(
                    policy,
                    board,
                    legal,
                    secondary_move,
                    phase,
                    secondary_policy_weight,
                ):
                    secondary_hits += 1

                teacher_score = primary_score * primary_weight + secondary_score * secondary_weight
                if not _append_sample(
                    feat_idx,
                    red_buckets,
                    black_buckets,
                    phases,
                    turns,
                    base_scores,
                    targets,
                    sparse_idx,
                    red_bucket,
                    black_bucket,
                    phase,
                    turn,
                    base_eval,
                    teacher_score,
                    sample_limit,
                ):
                    break

                score_gap = abs(primary_score - secondary_score)
                if len(targets) < sample_limit and (score_gap >= disagreement_cp or not agree):
                    if _append_sample(
                        feat_idx,
                        red_buckets,
                        black_buckets,
                        phases,
                        turns,
                        base_scores,
                        targets,
                        sparse_idx,
                        red_bucket,
                        black_bucket,
                        phase,
                        turn,
                        base_eval,
                        teacher_score,
                        sample_limit,
                    ):
                        oversample_count += 1

                if len(targets) >= sample_limit:
                    break

                if agree:
                    chosen = primary_move
                else:
                    options: list[int] = []
                    weights: list[float] = []
                    if primary_valid:
                        options.append(primary_move)
                        weights.append(0.60)
                    if secondary_valid and secondary_move != primary_move:
                        options.append(secondary_move)
                        weights.append(0.25)
                    if ply < 10 or not options:
                        options.append(rng.choice(legal))
                        weights.append(0.15 if options else 1.0)
                    chosen = rng.choices(options, weights=weights, k=1)[0]

                if chosen not in legal:
                    chosen = rng.choice(legal)
                board.make(chosen)
    finally:
        primary_teacher.close()
        secondary_teacher.close()

    stats = {
        "primary_teacher_path": primary_teacher.engine_path,
        "secondary_teacher_path": secondary_teacher.engine_path,
        "primary_teacher_movetime": primary_movetime,
        "secondary_teacher_movetime": secondary_movetime,
        "primary_weight": primary_weight,
        "secondary_weight": secondary_weight,
        "disagreement_cp": disagreement_cp,
        "games": generated_games,
        "samples": len(targets),
        "primary_policy_hits": primary_hits,
        "secondary_policy_hits": secondary_hits,
        "agreement_samples": agree_count,
        "disagreement_samples": disagree_count,
        "oversample_count": oversample_count,
        "avg_primary_ms": (primary_ms_total / max(1, len(targets) - oversample_count)),
        "avg_secondary_ms": (secondary_ms_total / max(1, len(targets) - oversample_count)),
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
        description="Train XiangqiModelV10 from Pikafish + Fairy-Stockfish disagreement-aware labels."
    )
    parser.add_argument("--primary-teacher", type=str, default=str(ROOT / "data/default-engines/pikafish"))
    parser.add_argument("--secondary-teacher", type=str, default=str(ROOT / "data/default-engines/fairy-stockfish"))
    parser.add_argument(
        "--secondary-evalfile",
        type=str,
        default=str(ROOT / "data/default-engines/fairy-xiangqi.nnue"),
    )
    parser.add_argument("--samples", type=int, default=3600)
    parser.add_argument("--games", type=int, default=150)
    parser.add_argument("--primary-movetime", type=int, default=60)
    parser.add_argument("--secondary-movetime", type=int, default=45)
    parser.add_argument("--primary-weight", type=float, default=0.75)
    parser.add_argument("--secondary-weight", type=float, default=0.25)
    parser.add_argument("--disagreement-cp", type=int, default=80)
    parser.add_argument("--opening-random-plies", type=int, default=20)
    parser.add_argument("--max-game-plies", type=int, default=34)
    parser.add_argument("--hidden-dim", type=int, default=14)
    parser.add_argument("--factor-dim", type=int, default=4)
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.00038)
    parser.add_argument("--l2", type=float, default=6e-5)
    parser.add_argument("--grad-clip", type=float, default=0.7)
    parser.add_argument("--seed", type=int, default=20260324)
    args = parser.parse_args()

    t0 = time.perf_counter()
    primary_teacher = UciTeacher(
        args.primary_teacher,
        options={"Threads": 1, "Hash": 16},
    )
    secondary_teacher = UciTeacher(
        args.secondary_teacher,
        variant="xiangqi",
        options={
            "Threads": 1,
            "Hash": 16,
            "EvalFile": args.secondary_evalfile,
        },
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
    ) = collect_samples(
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
    report["same_split_eval"] = {"trained": trained_eval}

    value_source = "v10_trained"
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
        "opening_to_pawn": policy_tables["policy_to"][0, board_engine.P].astype(int)[:18].tolist(),
    }
    base.save_model(value_params, policy_tables, report)

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
