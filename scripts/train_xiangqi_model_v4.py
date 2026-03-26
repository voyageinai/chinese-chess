#!/usr/bin/env python3
"""Train XiangqiModelV4: V3-style value residual plus a tiny move-order prior."""

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
from engines import smartpy_opt as teacher  # noqa: E402


MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "xiangqi_model_v4.npz"
REPORT_PATH = MODEL_DIR / "xiangqi_model_v4_report.json"

PHASE_BUCKETS = 3
POLICY_SMOOTH = 2.0
POLICY_SCALE = 192.0
POLICY_CLIP = 768

NORM_BLACK = np.zeros(teacher.BOARD_SIZE, dtype=np.int16)
for sq in range(teacher.BOARD_SIZE):
    r = teacher.ROW_OF[sq]
    c = teacher.COL_OF[sq]
    NORM_BLACK[sq] = (teacher.ROWS - 1 - r) * teacher.COLS + c


def _norm_sq(sq: int, red_turn: bool) -> int:
    return sq if red_turn else int(NORM_BLACK[sq])


def _phase_bucket(phase: float) -> int:
    if phase >= 0.68:
        return 0
    if phase >= 0.34:
        return 1
    return 2


def _new_policy_counts() -> dict[str, np.ndarray]:
    return {
        "best_piece": np.zeros((PHASE_BUCKETS, 8), dtype=np.float64),
        "legal_piece": np.zeros((PHASE_BUCKETS, 8), dtype=np.float64),
        "best_from": np.zeros((PHASE_BUCKETS, 8, teacher.BOARD_SIZE), dtype=np.float64),
        "legal_from": np.zeros((PHASE_BUCKETS, 8, teacher.BOARD_SIZE), dtype=np.float64),
        "best_to": np.zeros((PHASE_BUCKETS, 8, teacher.BOARD_SIZE), dtype=np.float64),
        "legal_to": np.zeros((PHASE_BUCKETS, 8, teacher.BOARD_SIZE), dtype=np.float64),
        "best_capture": np.zeros((PHASE_BUCKETS, 8), dtype=np.float64),
        "legal_capture": np.zeros((PHASE_BUCKETS, 8), dtype=np.float64),
    }


def _update_policy_counts(
    counts: dict[str, np.ndarray],
    board: teacher.Board,
    legal: list[int],
    best: int,
    phase: float,
) -> bool:
    bucket = _phase_bucket(phase)
    red_turn = board.red_turn

    best_ok = best in legal
    for move in legal:
        fr = move // teacher.MOVE_STRIDE
        to = move % teacher.MOVE_STRIDE
        piece = board.sq[fr]
        pt = piece if piece > 0 else -piece
        victim = board.sq[to]
        victim_pt = victim if victim > 0 else -victim
        nfr = _norm_sq(fr, red_turn)
        nto = _norm_sq(to, red_turn)
        counts["legal_piece"][bucket, pt] += 1.0
        counts["legal_from"][bucket, pt, nfr] += 1.0
        counts["legal_to"][bucket, pt, nto] += 1.0
        counts["legal_capture"][bucket, victim_pt] += 1.0

    if not best_ok:
        return False

    fr = best // teacher.MOVE_STRIDE
    to = best % teacher.MOVE_STRIDE
    piece = board.sq[fr]
    pt = piece if piece > 0 else -piece
    victim = board.sq[to]
    victim_pt = victim if victim > 0 else -victim
    nfr = _norm_sq(fr, red_turn)
    nto = _norm_sq(to, red_turn)
    counts["best_piece"][bucket, pt] += 1.0
    counts["best_from"][bucket, pt, nfr] += 1.0
    counts["best_to"][bucket, pt, nto] += 1.0
    counts["best_capture"][bucket, victim_pt] += 1.0
    return True


def collect_samples(
    games: int,
    sample_limit: int,
    search_depth: int,
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
    searcher = teacher.Engine()

    feat_idx = []
    red_buckets = []
    black_buckets = []
    phases = []
    turns = []
    base_scores = []
    targets = []
    policy = _new_policy_counts()

    total_nodes = 0
    generated_games = 0
    policy_best_hits = 0

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

            sparse_idx, red_bucket, black_bucket, phase, turn, base_eval = value_base.board_to_sparse(board)
            fen = value_base.board_to_fen(board)
            teacher_score, best = value_base.evaluate_position(searcher, fen, search_depth)
            teacher_score = max(-value_base.TARGET_CLIP, min(value_base.TARGET_CLIP, float(teacher_score)))
            total_nodes += searcher.nodes

            feat_idx.append(sparse_idx)
            red_buckets.append(red_bucket)
            black_buckets.append(black_bucket)
            phases.append(phase)
            turns.append(turn)
            base_scores.append(base_eval)
            targets.append(float(teacher_score - base_eval))
            if _update_policy_counts(policy, board, legal, best, phase):
                policy_best_hits += 1

            if len(targets) >= sample_limit:
                break

            move = best
            if move == teacher.NO_MOVE or move not in legal:
                move = rng.choice(legal)
            elif ply < 8 and rng.random() < 0.20:
                move = rng.choice(legal[: min(10, len(legal))])
            board.make(move)

    stats = {
        "games": generated_games,
        "samples": len(targets),
        "avg_nodes_per_sample": (total_nodes / len(targets)) if targets else 0.0,
        "search_depth": search_depth,
        "seed": seed,
        "policy_best_hits": policy_best_hits,
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


def _policy_log_ratio(best: np.ndarray, legal: np.ndarray) -> np.ndarray:
    weights = np.log((best + POLICY_SMOOTH) / (legal + POLICY_SMOOTH)) * POLICY_SCALE
    return np.clip(np.rint(weights), -POLICY_CLIP, POLICY_CLIP).astype(np.int16)


def build_policy_tables(policy: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    piece = _policy_log_ratio(policy["best_piece"], policy["legal_piece"])
    from_sq = _policy_log_ratio(policy["best_from"], policy["legal_from"])
    to_sq = _policy_log_ratio(policy["best_to"], policy["legal_to"])
    capture = _policy_log_ratio(policy["best_capture"], policy["legal_capture"])

    for bucket in range(PHASE_BUCKETS):
        for pt in range(1, 8):
            from_sq[bucket, pt] -= np.int16(int(np.mean(from_sq[bucket, pt])))
            to_sq[bucket, pt] -= np.int16(int(np.mean(to_sq[bucket, pt])))

    return {
        "policy_piece": piece,
        "policy_from": from_sq,
        "policy_to": to_sq,
        "policy_capture": capture,
        "norm_black": NORM_BLACK.astype(np.int16),
    }


def save_model(
    value_params: dict[str, np.ndarray | float],
    policy_tables: dict[str, np.ndarray],
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
        emb=emb.reshape(value_base.FEATURE_PLANES, teacher.BOARD_SIZE, hidden_dim),
        lin_w=np.asarray(value_params["lin_w"], dtype=np.float32).reshape(
            value_base.FEATURE_PLANES, teacher.BOARD_SIZE
        ),
        red_fac=red_fac.reshape(value_base.FEATURE_PLANES, teacher.BOARD_SIZE, factor_dim),
        black_fac=black_fac.reshape(value_base.FEATURE_PLANES, teacher.BOARD_SIZE, factor_dim),
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
        policy_from=policy_tables["policy_from"],
        policy_to=policy_tables["policy_to"],
        policy_capture=policy_tables["policy_capture"],
        norm_black=policy_tables["norm_black"],
    )
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")


def load_value_params(model_path: Path) -> dict[str, np.ndarray | float]:
    with np.load(model_path) as data:
        return {
            "lin_w": data["lin_w"].reshape(-1).astype(np.float32),
            "emb": data["emb"].reshape(value_base.FEATURE_DIM, data["emb"].shape[2]).astype(np.float32),
            "red_fac": data["red_fac"].reshape(value_base.FEATURE_DIM, data["red_fac"].shape[2]).astype(np.float32),
            "black_fac": data["black_fac"].reshape(value_base.FEATURE_DIM, data["black_fac"].shape[2]).astype(np.float32),
            "hidden_bias": data["hidden_bias"].astype(np.float32),
            "lin_tempo": data["lin_tempo"].astype(np.float32),
            "tempo": data["tempo"].astype(np.float32),
            "phase_vec": data["phase_vec"].astype(np.float32),
            "red_king_bias": data["red_king_bias"].astype(np.float32),
            "black_king_bias": data["black_king_bias"].astype(np.float32),
            "red_king_vec": data["red_king_vec"].astype(np.float32),
            "black_king_vec": data["black_king_vec"].astype(np.float32),
            "king_pair_bias": data["king_pair_bias"].astype(np.float32),
            "out_w": data["out_w"].astype(np.float32),
            "out_bias": np.float32(data["out_bias"]),
            "phase_out": np.float32(data["phase_out"]),
        }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train XiangqiModelV4 with a residual value head and a move-order prior."
    )
    parser.add_argument("--samples", type=int, default=2400)
    parser.add_argument("--games", type=int, default=110)
    parser.add_argument("--depth", type=int, default=5)
    parser.add_argument("--opening-random-plies", type=int, default=14)
    parser.add_argument("--max-game-plies", type=int, default=36)
    parser.add_argument("--hidden-dim", type=int, default=18)
    parser.add_argument("--factor-dim", type=int, default=6)
    parser.add_argument("--epochs", type=int, default=24)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.0012)
    parser.add_argument("--l2", type=float, default=3e-5)
    parser.add_argument("--grad-clip", type=float, default=2.0)
    parser.add_argument("--seed", type=int, default=20260324)
    args = parser.parse_args()

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

    policy_tables = build_policy_tables(policy)
    value_source = "v4_trained"
    if value_base.MODEL_PATH.exists() and value_base.REPORT_PATH.exists():
        v3_report = json.loads(value_base.REPORT_PATH.read_text(encoding="utf-8"))
        v3_val_rmse = float(v3_report.get("val", {}).get("rmse", float("inf")))
        if report["val"]["rmse"] >= v3_val_rmse:
            value_params = load_value_params(value_base.MODEL_PATH)
            value_source = "v3_fallback"
            report["value_fallback"] = {
                "used": True,
                "trained_val_rmse": report["val"]["rmse"],
                "fallback_val_rmse": v3_val_rmse,
            }
        else:
            report["value_fallback"] = {
                "used": False,
                "trained_val_rmse": report["val"]["rmse"],
                "fallback_val_rmse": v3_val_rmse,
            }
    report.update(stats)
    report["elapsed_sec"] = time.perf_counter() - t0
    report["value_source"] = value_source
    report["policy_scale"] = POLICY_SCALE
    report["policy_smooth"] = POLICY_SMOOTH
    report["policy_preview"] = {
        "opening_piece": policy_tables["policy_piece"][0].astype(int).tolist(),
        "opening_capture": policy_tables["policy_capture"][0].astype(int).tolist(),
    }
    save_model(value_params, policy_tables, report)

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
