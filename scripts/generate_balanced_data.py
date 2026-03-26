#!/usr/bin/env python3
"""Generate balanced training data with proper endgame representation.

Uses Pikafish self-play to generate positions across all game phases,
oversampling endgame positions to fix the catastrophic imbalance in
previous training datasets (83.8% opening, 0.1% endgame).

Target distribution: ~40% opening, ~40% middlegame, ~20% endgame.
"""

from __future__ import annotations

import argparse
import multiprocessing as mp
import random
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engines.smartpy_opt import (
    Board,
    BOARD_SIZE,
    COLS,
    EMPTY,
    MOVE_STRIDE,
    PIECE_OFFSET,
    START_FEN,
)
from autoresearch.fen_utils import board_to_fen
from scripts.uci_teacher import UciTeacher

# ── Constants ──────────────────────────────────────────────────────────
PIKAFISH_PATH = str(ROOT / "data" / "default-engines" / "pikafish")
RANDOM_OPENING_PLIES = 4
MAX_GAME_MOVES = 250
MAX_TIME_SEC = 1800  # default; overridable via --max-time
ENGINE_HASH_MB = 16
SEED_STRIDE = 9973

# Phase thresholds (raw phase values, not fractions)
PHASE_TOTAL = 40.0
PHASE_OPENING = 27
PHASE_MIDDLEGAME = 14

# Sparse feature encoding (must match autoresearch/train.py)
FEATURE_PLANES = 15
FEATURE_DIM = FEATURE_PLANES * BOARD_SIZE
MAX_PIECES = 34
SENTINEL = FEATURE_DIM

# King bucket mapping (must match autoresearch/train.py)
KING_BUCKETS = 9
MISSING_BUCKET = 4
RED_KING_BUCKET = np.full(BOARD_SIZE, MISSING_BUCKET, dtype=np.int8)
BLACK_KING_BUCKET = np.full(BOARD_SIZE, MISSING_BUCKET, dtype=np.int8)
for _r in range(7, 10):
    for _c in range(3, 6):
        RED_KING_BUCKET[_r * COLS + _c] = (_r - 7) * 3 + (_c - 3)
for _r in range(0, 3):
    for _c in range(3, 6):
        BLACK_KING_BUCKET[_r * COLS + _c] = _r * 3 + (_c - 3)

TARGET_CLIP = 2500.0


def _get_phase_total(board: Board) -> int:
    return board.red_phase + board.black_phase


def _classify_phase(phase_total: int) -> str:
    if phase_total >= PHASE_OPENING:
        return "opening"
    if phase_total >= PHASE_MIDDLEGAME:
        return "middlegame"
    return "endgame"


def _board_to_sparse(board: Board) -> tuple[np.ndarray, int, int, float, int, float]:
    indices = np.full(MAX_PIECES, SENTINEL, dtype=np.int32)
    write = 0
    for sq in range(BOARD_SIZE):
        piece = board.sq[sq]
        if piece == EMPTY:
            continue
        indices[write] = (piece + PIECE_OFFSET) * BOARD_SIZE + sq
        write += 1

    red_bucket = int(RED_KING_BUCKET[board.red_king]) if board.red_king >= 0 else MISSING_BUCKET
    black_bucket = int(BLACK_KING_BUCKET[board.black_king]) if board.black_king >= 0 else MISSING_BUCKET
    phase = (board.red_phase + board.black_phase) / PHASE_TOTAL
    turn = 0 if board.red_turn else 1
    base_score = float(board.score if board.red_turn else -board.score)
    return indices, red_bucket, black_bucket, phase, turn, base_score


def _compute_norm_black() -> np.ndarray:
    rows = BOARD_SIZE // COLS
    table = np.zeros(BOARD_SIZE, dtype=np.int16)
    for sq in range(BOARD_SIZE):
        r = sq // COLS
        c = sq % COLS
        table[sq] = (rows - 1 - r) * COLS + c
    return table


def _normalize_to_sq(to_sq: int, is_black: bool, norm_black: np.ndarray) -> int:
    return int(norm_black[to_sq]) if is_black else to_sq


def _collect_policy_stats(
    board: Board,
    best_move: int,
    phase_total: int,
    policy_best_piece: np.ndarray,
    policy_legal_piece: np.ndarray,
    policy_best_to: np.ndarray,
    policy_legal_to: np.ndarray,
    norm_black: np.ndarray,
) -> None:
    phase_bucket = 0 if phase_total >= PHASE_OPENING else (1 if phase_total >= PHASE_MIDDLEGAME else 2)
    legal_moves = board.gen_legal()

    for move in legal_moves:
        fr = move // MOVE_STRIDE
        to = move % MOVE_STRIDE
        piece = board.sq[fr]
        pt = abs(piece)
        if pt == 0 or pt > 7:
            continue

        norm_to = _normalize_to_sq(to, piece < 0, norm_black)
        policy_legal_piece[phase_bucket, pt] += 1
        policy_legal_to[phase_bucket, pt, norm_to] += 1

        if move == best_move:
            policy_best_piece[phase_bucket, pt] += 1
            policy_best_to[phase_bucket, pt, norm_to] += 1


def _split_total(total: int, parts: int) -> list[int]:
    base = total // parts
    extra = total % parts
    return [base + (1 if idx < extra else 0) for idx in range(parts)]


def _target_distribution(target_positions: int) -> dict[str, int]:
    target_opening = int(target_positions * 0.40)
    target_middlegame = int(target_positions * 0.40)
    target_endgame = target_positions - target_opening - target_middlegame
    return {
        "opening": target_opening,
        "middlegame": target_middlegame,
        "endgame": target_endgame,
    }


def _sample_probability(phase_class: str) -> float:
    if phase_class == "opening":
        return 1.0 / 3.0
    if phase_class == "middlegame":
        return 0.5
    return 1.0


def _new_policy_accumulators() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    return (
        np.zeros((3, 8), dtype=np.float64),
        np.zeros((3, 8), dtype=np.float64),
        np.zeros((3, 8, BOARD_SIZE), dtype=np.float64),
        np.zeros((3, 8, BOARD_SIZE), dtype=np.float64),
    )


def _all_targets_met(counts: dict[str, int], targets: dict[str, int]) -> bool:
    return all(counts[key] >= targets[key] for key in counts)


def _balanced_worker(config: dict) -> dict:
    rng = random.Random(int(config["seed"]))
    norm_black = _compute_norm_black()
    targets = {key: int(value) for key, value in config["targets"].items()}
    counts = {key: 0 for key in targets}

    all_indices: list[np.ndarray] = []
    all_red_buckets: list[int] = []
    all_black_buckets: list[int] = []
    all_phases: list[float] = []
    all_turns: list[int] = []
    all_base_scores: list[float] = []
    all_residuals: list[float] = []
    policy_best_piece, policy_legal_piece, policy_best_to, policy_legal_to = _new_policy_accumulators()

    play_engine = UciTeacher(
        config["engine"],
        options={"Threads": 1, "Hash": ENGINE_HASH_MB},
    )
    analysis_engine = UciTeacher(
        config["engine"],
        options={"Threads": 1, "Hash": ENGINE_HASH_MB},
    )

    board = Board()
    game_count = 0
    t0 = time.perf_counter()

    play_engine.start()
    analysis_engine.start()
    try:
        while not _all_targets_met(counts, targets) and (time.perf_counter() - t0) < int(config["max_time"]):
            game_count += 1
            board.load_fen(START_FEN)

            for _ in range(rng.randint(0, RANDOM_OPENING_PLIES)):
                legal = board.gen_legal()
                if not legal:
                    break
                board.make(rng.choice(legal))
                if board.red_king < 0 or board.black_king < 0:
                    break

            game_positions: list[dict] = []
            move_count = 0

            while move_count < MAX_GAME_MOVES:
                legal = board.gen_legal()
                if not legal:
                    break

                fen = board_to_fen(board)
                phase_total = _get_phase_total(board)
                phase_class = _classify_phase(phase_total)

                should_sample = (
                    counts[phase_class] < targets[phase_class]
                    and rng.random() < _sample_probability(phase_class)
                )
                if should_sample:
                    idx, rb, bb, ph, turn, base_score = _board_to_sparse(board)
                    game_positions.append(
                        {
                            "fen": fen,
                            "phase_class": phase_class,
                            "phase_total": phase_total,
                            "board_indices": idx,
                            "red_bucket": rb,
                            "black_bucket": bb,
                            "phase_frac": ph,
                            "turn": turn,
                            "base_score": base_score,
                        }
                    )

                try:
                    _score, best_uci = play_engine.analyze(fen, movetime=int(config["selfplay_movetime"]))
                    move_int = play_engine.uci_to_move(best_uci)
                    if move_int < 0 or move_int not in legal:
                        break
                except Exception:
                    break

                board.make(move_int)
                move_count += 1

                if board.red_king < 0 or board.black_king < 0:
                    break

            for pos in game_positions:
                phase_class = pos["phase_class"]
                if counts[phase_class] >= targets[phase_class]:
                    continue

                try:
                    score, best_uci = analysis_engine.analyze(
                        pos["fen"],
                        movetime=int(config["analysis_movetime"]),
                    )
                except Exception:
                    continue

                turn = pos["turn"]
                red_score = score if turn == 0 else -score
                if abs(red_score) > TARGET_CLIP:
                    continue

                residual = float(score) - pos["base_score"]
                all_indices.append(pos["board_indices"])
                all_red_buckets.append(pos["red_bucket"])
                all_black_buckets.append(pos["black_bucket"])
                all_phases.append(pos["phase_frac"])
                all_turns.append(turn)
                all_base_scores.append(pos["base_score"])
                all_residuals.append(residual)
                counts[phase_class] += 1

                tmp_board = Board()
                tmp_board.load_fen(pos["fen"])
                best_move_int = analysis_engine.uci_to_move(best_uci)
                _collect_policy_stats(
                    tmp_board,
                    best_move_int,
                    pos["phase_total"],
                    policy_best_piece,
                    policy_legal_piece,
                    policy_best_to,
                    policy_legal_to,
                    norm_black,
                )
    finally:
        play_engine.close()
        analysis_engine.close()

    return {
        "worker_idx": int(config["worker_idx"]),
        "elapsed": time.perf_counter() - t0,
        "games": game_count,
        "counts": counts,
        "indices": np.array(all_indices, dtype=np.int32),
        "red_buckets": np.array(all_red_buckets, dtype=np.int8),
        "black_buckets": np.array(all_black_buckets, dtype=np.int8),
        "phases": np.array(all_phases, dtype=np.float32),
        "turns": np.array(all_turns, dtype=np.int8),
        "base_scores": np.array(all_base_scores, dtype=np.float32),
        "residuals": np.array(all_residuals, dtype=np.float32),
        "policy_best_piece": policy_best_piece,
        "policy_legal_piece": policy_legal_piece,
        "policy_best_to": policy_best_to,
        "policy_legal_to": policy_legal_to,
    }


def generate_balanced_data(
    output_path: str,
    target_positions: int = 8000,
    selfplay_movetime: int = 50,
    analysis_movetime: int = 80,
    seed: int = 42,
    workers: int = 1,
    engine_path: str = PIKAFISH_PATH,
    max_time: int = MAX_TIME_SEC,
) -> None:
    if target_positions <= 0:
        raise ValueError("target_positions must be >= 1")
    if workers <= 0:
        raise ValueError("workers must be >= 1")

    targets = _target_distribution(target_positions)
    print("Target distribution:")
    print(f"  Opening:    {targets['opening']}")
    print(f"  Middlegame: {targets['middlegame']}")
    print(f"  Endgame:    {targets['endgame']}")
    print()

    worker_count = max(1, min(workers, target_positions))
    opening_parts = _split_total(targets["opening"], worker_count)
    middlegame_parts = _split_total(targets["middlegame"], worker_count)
    endgame_parts = _split_total(targets["endgame"], worker_count)

    configs = []
    target_by_worker: dict[int, dict[str, int]] = {}
    for idx in range(worker_count):
        worker_targets = {
            "opening": opening_parts[idx],
            "middlegame": middlegame_parts[idx],
            "endgame": endgame_parts[idx],
        }
        if sum(worker_targets.values()) == 0:
            continue
        config = {
            "worker_idx": idx,
            "targets": worker_targets,
            "engine": engine_path,
            "selfplay_movetime": selfplay_movetime,
            "analysis_movetime": analysis_movetime,
            "seed": seed + idx * SEED_STRIDE,
            "max_time": max_time,
        }
        configs.append(config)
        target_by_worker[idx] = worker_targets

    counts = {"opening": 0, "middlegame": 0, "endgame": 0}
    game_count = 0
    policy_best_piece, policy_legal_piece, policy_best_to, policy_legal_to = _new_policy_accumulators()
    t0 = time.perf_counter()

    try:
        if len(configs) == 1:
            parts = [_balanced_worker(configs[0])]
        else:
            ctx = mp.get_context("spawn")
            parts = []
            with ProcessPoolExecutor(max_workers=len(configs), mp_context=ctx) as executor:
                futures = {executor.submit(_balanced_worker, config): config for config in configs}
                for future in as_completed(futures):
                    part = future.result()
                    parts.append(part)
                    worker_targets = target_by_worker[part["worker_idx"]]
                    worker_total = sum(part["counts"].values())
                    print(
                        f"Worker {part['worker_idx'] + 1:2d}/{len(configs)} | "
                        f"Total: {worker_total:5d} | "
                        f"O: {part['counts']['opening']:5d}/{worker_targets['opening']} | "
                        f"M: {part['counts']['middlegame']:5d}/{worker_targets['middlegame']} | "
                        f"E: {part['counts']['endgame']:5d}/{worker_targets['endgame']} | "
                        f"{part['elapsed']:.0f}s"
                    )
    except KeyboardInterrupt:
        print("\nInterrupted, waiting for running workers to stop...", flush=True)
        raise

    for part in sorted(parts, key=lambda item: item["worker_idx"]):
        game_count += int(part["games"])
        for key in counts:
            counts[key] += int(part["counts"][key])
        policy_best_piece += part["policy_best_piece"]
        policy_legal_piece += part["policy_legal_piece"]
        policy_best_to += part["policy_best_to"]
        policy_legal_to += part["policy_legal_to"]

    total = sum(counts.values())
    elapsed = time.perf_counter() - t0
    print(f"\nGeneration complete: {total} positions from {game_count} games in {elapsed:.1f}s")
    print(f"  Opening:    {counts['opening']:5d} ({100*counts['opening']/max(1,total):.1f}%)")
    print(f"  Middlegame: {counts['middlegame']:5d} ({100*counts['middlegame']/max(1,total):.1f}%)")
    print(f"  Endgame:    {counts['endgame']:5d} ({100*counts['endgame']/max(1,total):.1f}%)")

    if total == 0:
        print("ERROR: No positions collected!")
        sys.exit(1)

    indices_parts = [part["indices"] for part in parts if part["indices"].size > 0]
    red_bucket_parts = [part["red_buckets"] for part in parts if part["red_buckets"].size > 0]
    black_bucket_parts = [part["black_buckets"] for part in parts if part["black_buckets"].size > 0]
    phase_parts = [part["phases"] for part in parts if part["phases"].size > 0]
    turn_parts = [part["turns"] for part in parts if part["turns"].size > 0]
    base_score_parts = [part["base_scores"] for part in parts if part["base_scores"].size > 0]
    residual_parts = [part["residuals"] for part in parts if part["residuals"].size > 0]

    indices_array = np.concatenate(indices_parts, axis=0).astype(np.int32, copy=False)
    red_buckets = np.concatenate(red_bucket_parts, axis=0).astype(np.int8, copy=False)
    black_buckets = np.concatenate(black_bucket_parts, axis=0).astype(np.int8, copy=False)
    phases = np.concatenate(phase_parts, axis=0).astype(np.float32, copy=False)
    turns = np.concatenate(turn_parts, axis=0).astype(np.int8, copy=False)
    base_scores = np.concatenate(base_score_parts, axis=0).astype(np.float32, copy=False)
    residuals = np.concatenate(residual_parts, axis=0).astype(np.float32, copy=False)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        output_path,
        indices=indices_array,
        red_buckets=red_buckets,
        black_buckets=black_buckets,
        phases=phases,
        turns=turns,
        base_scores=base_scores,
        residuals=residuals,
        policy_best_piece=policy_best_piece,
        policy_legal_piece=policy_legal_piece,
        policy_best_to=policy_best_to,
        policy_legal_to=policy_legal_to,
    )
    print(f"\nSaved to {output_path}")
    print(f"  indices shape: {indices_array.shape}")
    print(f"  residuals range: [{residuals.min():.0f}, {residuals.max():.0f}]")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate balanced NNUE training data.")
    parser.add_argument(
        "--output",
        default="autoresearch/models/balanced_v1.npz",
        help="Output NPZ file path",
    )
    parser.add_argument(
        "--positions",
        type=int,
        default=8000,
        help="Target number of positions (default: 8000)",
    )
    parser.add_argument(
        "--selfplay-movetime",
        type=int,
        default=50,
        help="Movetime in ms for self-play moves (default: 50)",
    )
    parser.add_argument(
        "--analysis-movetime",
        type=int,
        default=80,
        help="Movetime in ms for position analysis (default: 80)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed (default: 42)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Number of parallel workers, each with its own Pikafish pair (default: 1)",
    )
    parser.add_argument(
        "--engine",
        type=str,
        default=PIKAFISH_PATH,
        help="Path to Pikafish binary",
    )
    parser.add_argument(
        "--max-time",
        type=int,
        default=MAX_TIME_SEC,
        help=f"Max wall-clock seconds per worker (default: {MAX_TIME_SEC})",
    )
    args = parser.parse_args()

    generate_balanced_data(
        output_path=args.output,
        target_positions=args.positions,
        selfplay_movetime=args.selfplay_movetime,
        analysis_movetime=args.analysis_movetime,
        seed=args.seed,
        workers=args.workers,
        engine_path=args.engine,
        max_time=args.max_time,
    )
