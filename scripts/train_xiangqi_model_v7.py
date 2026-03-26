#!/usr/bin/env python3
"""Train XiangqiModelV7 from Pikafish value labels plus a richer lightweight policy prior."""

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
MODEL_PATH = MODEL_DIR / "xiangqi_model_v7.npz"
REPORT_PATH = MODEL_DIR / "xiangqi_model_v7_report.json"
V6_MODEL_PATH = MODEL_DIR / "xiangqi_model_v6.npz"
V6_REPORT_PATH = MODEL_DIR / "xiangqi_model_v6_report.json"

PHASE_BUCKETS = 3
POLICY_SMOOTH = 2.0
POLICY_SCALE = 112.0
POLICY_CLIP = 448

NORM_BLACK = np.zeros(board_engine.BOARD_SIZE, dtype=np.int16)
for sq in range(board_engine.BOARD_SIZE):
    r = board_engine.ROW_OF[sq]
    c = board_engine.COL_OF[sq]
    NORM_BLACK[sq] = (board_engine.ROWS - 1 - r) * board_engine.COLS + c


def _uci_to_move(uci: str) -> int:
    if not uci or uci == "0000":
        return board_engine.NO_MOVE
    try:
        return board_engine._uci2m(uci)
    except Exception:
        return board_engine.NO_MOVE


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
        "best_from": np.zeros((PHASE_BUCKETS, 8, board_engine.BOARD_SIZE), dtype=np.float64),
        "legal_from": np.zeros((PHASE_BUCKETS, 8, board_engine.BOARD_SIZE), dtype=np.float64),
        "best_to": np.zeros((PHASE_BUCKETS, 8, board_engine.BOARD_SIZE), dtype=np.float64),
        "legal_to": np.zeros((PHASE_BUCKETS, 8, board_engine.BOARD_SIZE), dtype=np.float64),
    }


def _update_policy_counts(
    counts: dict[str, np.ndarray],
    board: board_engine.Board,
    legal: list[int],
    best: int,
    phase: float,
) -> bool:
    bucket = _phase_bucket(phase)
    red_turn = board.red_turn

    for move in legal:
        fr = move // board_engine.MOVE_STRIDE
        to = move % board_engine.MOVE_STRIDE
        piece = board.sq[fr]
        pt = piece if piece > 0 else -piece
        nfr = _norm_sq(fr, red_turn)
        nto = _norm_sq(to, red_turn)
        counts["legal_piece"][bucket, pt] += 1.0
        counts["legal_from"][bucket, pt, nfr] += 1.0
        counts["legal_to"][bucket, pt, nto] += 1.0

    if best not in legal:
        return False

    fr = best // board_engine.MOVE_STRIDE
    to = best % board_engine.MOVE_STRIDE
    piece = board.sq[fr]
    pt = piece if piece > 0 else -piece
    nfr = _norm_sq(fr, red_turn)
    nto = _norm_sq(to, red_turn)
    counts["best_piece"][bucket, pt] += 1.0
    counts["best_from"][bucket, pt, nfr] += 1.0
    counts["best_to"][bucket, pt, nto] += 1.0
    return True


def collect_samples(
    teacher_path: str,
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
    teacher = UciTeacher(teacher_path)
    teacher.start()

    feat_idx: list[np.ndarray] = []
    red_buckets: list[int] = []
    black_buckets: list[int] = []
    phases: list[float] = []
    turns: list[int] = []
    base_scores: list[float] = []
    targets: list[float] = []
    policy = _new_policy_counts()

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
                best_move = _uci_to_move(best_uci)
                if _update_policy_counts(policy, board, legal, best_move, phase):
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
                elif ply < 10 and rng.random() < 0.18:
                    move = rng.choice(legal[: min(12, len(legal))])
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


def _policy_log_ratio(best: np.ndarray, legal: np.ndarray) -> np.ndarray:
    weights = np.log((best + POLICY_SMOOTH) / (legal + POLICY_SMOOTH)) * POLICY_SCALE
    return np.clip(np.rint(weights), -POLICY_CLIP, POLICY_CLIP).astype(np.int16)


def build_policy_tables(policy: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    piece = _policy_log_ratio(policy["best_piece"], policy["legal_piece"])
    from_sq = _policy_log_ratio(policy["best_from"], policy["legal_from"])
    to_sq = _policy_log_ratio(policy["best_to"], policy["legal_to"])
    for bucket in range(PHASE_BUCKETS):
        for pt in range(1, 8):
            from_sq[bucket, pt] -= np.int16(int(np.mean(from_sq[bucket, pt])))
            to_sq[bucket, pt] -= np.int16(int(np.mean(to_sq[bucket, pt])))
    return {
        "policy_piece": piece,
        "policy_from": from_sq,
        "policy_to": to_sq,
        "norm_black": NORM_BLACK.astype(np.int16),
    }


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
        emb=emb.reshape(value_base.FEATURE_PLANES, board_engine.BOARD_SIZE, hidden_dim),
        lin_w=np.asarray(value_params["lin_w"], dtype=np.float32).reshape(
            value_base.FEATURE_PLANES, board_engine.BOARD_SIZE
        ),
        red_fac=red_fac.reshape(value_base.FEATURE_PLANES, board_engine.BOARD_SIZE, factor_dim),
        black_fac=black_fac.reshape(value_base.FEATURE_PLANES, board_engine.BOARD_SIZE, factor_dim),
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
        norm_black=policy_tables["norm_black"],
    )
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train XiangqiModelV7 from Pikafish labels with a richer lightweight policy prior."
    )
    parser.add_argument("--teacher", type=str, default=str(ROOT / "data/default-engines/pikafish"))
    parser.add_argument("--samples", type=int, default=3200)
    parser.add_argument("--games", type=int, default=120)
    parser.add_argument("--teacher-depth", type=int, default=0)
    parser.add_argument("--teacher-movetime", type=int, default=40)
    parser.add_argument("--opening-random-plies", type=int, default=18)
    parser.add_argument("--max-game-plies", type=int, default=34)
    parser.add_argument("--hidden-dim", type=int, default=12)
    parser.add_argument("--factor-dim", type=int, default=4)
    parser.add_argument("--epochs", type=int, default=16)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.00045)
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

    value_source = "v7_trained"
    if V6_MODEL_PATH.exists() and V6_REPORT_PATH.exists():
        v6_report = json.loads(V6_REPORT_PATH.read_text(encoding="utf-8"))
        v6_val_rmse = float(v6_report.get("val", {}).get("rmse", float("inf")))
        if report["val"]["rmse"] >= v6_val_rmse:
            value_params = load_value_params(V6_MODEL_PATH)
            value_source = "v6_fallback"
            report["value_fallback"] = {
                "used": True,
                "trained_val_rmse": report["val"]["rmse"],
                "fallback_val_rmse": v6_val_rmse,
            }
        else:
            report["value_fallback"] = {
                "used": False,
                "trained_val_rmse": report["val"]["rmse"],
                "fallback_val_rmse": v6_val_rmse,
            }

    report.update(stats)
    report["elapsed_sec"] = time.perf_counter() - t0
    report["policy_scale"] = POLICY_SCALE
    report["policy_smooth"] = POLICY_SMOOTH
    report["value_source"] = value_source
    report["policy_preview"] = {
        "opening_piece": policy_tables["policy_piece"][0].astype(int).tolist(),
        "opening_from_rook": policy_tables["policy_from"][0, board_engine.R].astype(int)[:18].tolist(),
        "opening_to_pawn": policy_tables["policy_to"][0, board_engine.P].astype(int)[:18].tolist(),
    }
    save_model(value_params, policy_tables, report)

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
