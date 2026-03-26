#!/usr/bin/env python3
"""Generate policy tables for move ordering using Pikafish as teacher.

For each board position, asks Pikafish for the best move and records statistics
about which piece types move most often and where they go.  Builds log-ratio
tables that encode priors like "horses tend to go to these squares" and "rooks
are the most active pieces in the opening."

Output tables (saved as NPZ):
  policy_piece[3, 8]    — int16, per-phase piece-type frequency bias
  policy_to[3, 8, 90]   — int16, per-phase destination-square bias per piece
  norm_black[90]         — int16, square mapping to flip black to red perspective

Usage:
  python scripts/generate_policy.py
  python scripts/generate_policy.py --positions 5000 --movetime 80
  python scripts/generate_policy.py --engine data/default-engines/pikafish \\
                                    --output autoresearch/models/policy_v11.npz
"""

from __future__ import annotations

import argparse
import multiprocessing as mp
import math
import random
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engines.smartpy_opt import Board, PHASE, MOVE_STRIDE, COLS, ROWS, BOARD_SIZE, START_FEN
from autoresearch.fen_utils import board_to_fen
from scripts.uci_teacher import UciTeacher

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NUM_PIECE_TYPES = 8        # indices 0..7; piece type = abs(piece), 0 unused
NUM_BUCKETS = 3
PHASE_W = (0, 0, 1, 1, 2, 4, 2, 0)  # indexed by piece type (K=1..P=7)
MAX_PHASE = 40             # 2 sides × (2A×1 + 2B×1 + 2N×2 + 2R×4 + 2C×2) = 40
BUCKET_THRESHOLDS = (27, 14)  # bucket 0: >=27, bucket 1: >=14, bucket 2: else

RANDOM_OPENING_PLIES = 4   # play random moves for plies 0-3
MAX_GAME_PLIES = 200
LOG_SCALE = 64.0
LAPLACE = 2.0
CLIP_MIN = -384
CLIP_MAX = 384
ENGINE_HASH_MB = 16
SEED_STRIDE = 9973


def compute_norm_black() -> np.ndarray:
    """Build square mapping to flip black's perspective to red's (vertical flip).

    Row 0 (black back rank) ↔ Row 9 (red back rank), column unchanged.
    """
    table = np.zeros(BOARD_SIZE, dtype=np.int16)
    for sq in range(BOARD_SIZE):
        r = sq // COLS
        c = sq % COLS
        flipped_r = (ROWS - 1) - r
        table[sq] = flipped_r * COLS + c
    return table


def phase_bucket(board: Board) -> int:
    """Determine phase bucket from current board material."""
    total = board.red_phase + board.black_phase
    if total >= BUCKET_THRESHOLDS[0]:
        return 0
    if total >= BUCKET_THRESHOLDS[1]:
        return 1
    return 2


def normalize_to_sq(to_sq: int, is_black: bool, norm_black: np.ndarray) -> int:
    """Normalize destination square: flip for black pieces so tables are red-relative."""
    if is_black:
        return int(norm_black[to_sq])
    return to_sq


def play_one_game(
    teacher: UciTeacher,
    norm_black: np.ndarray,
    movetime: int,
    rng: random.Random,
    *,
    legal_piece: np.ndarray,
    legal_to: np.ndarray,
    best_piece: np.ndarray,
    best_to: np.ndarray,
    max_positions: int,
) -> int:
    """Play a self-play game using Pikafish, collecting policy statistics.

    Returns the number of new positions collected.
    """
    board = Board()
    board.load_fen(START_FEN)
    count = 0

    for ply in range(MAX_GAME_PLIES):
        if count >= max_positions:
            break

        legal_moves = board.gen_legal()
        if not legal_moves:
            break

        if ply < RANDOM_OPENING_PLIES:
            # Random opening moves for diversity
            move = rng.choice(legal_moves)
            cap = board.make(move)
            continue

        # Get best move from Pikafish
        fen = board_to_fen(board)
        try:
            _score, best_uci = teacher.analyze(fen, movetime=movetime)
        except (TimeoutError, RuntimeError):
            break

        best_move_int = teacher.uci_to_move(best_uci)
        if best_move_int < 0 or best_move_int not in legal_moves:
            # Engine returned invalid/illegal move — skip this game
            break

        bucket = phase_bucket(board)

        # Collect statistics for ALL legal moves
        for m in legal_moves:
            fr = m // MOVE_STRIDE
            to = m - fr * MOVE_STRIDE
            piece = board.sq[fr]
            pt = abs(piece)
            is_black = piece < 0
            norm_to = normalize_to_sq(to, is_black, norm_black)

            legal_piece[bucket, pt] += 1
            legal_to[bucket, pt, norm_to] += 1

        # Collect statistics for best move
        best_fr = best_move_int // MOVE_STRIDE
        best_to_sq = best_move_int - best_fr * MOVE_STRIDE
        best_piece_val = board.sq[best_fr]
        best_pt = abs(best_piece_val)
        best_is_black = best_piece_val < 0
        best_norm_to = normalize_to_sq(best_to_sq, best_is_black, norm_black)

        best_piece[bucket, best_pt] += 1
        best_to[bucket, best_pt, best_norm_to] += 1

        count += 1

        # Play the best move
        cap = board.make(best_move_int)

    return count


def counts_to_log_ratio(best: np.ndarray, legal: np.ndarray) -> np.ndarray:
    """Convert best/legal counts to log-ratio scores, scaled and clipped."""
    ratio = np.log((best + LAPLACE) / (legal + LAPLACE)) * LOG_SCALE
    return np.clip(ratio, CLIP_MIN, CLIP_MAX).astype(np.float64)


def _split_total(total: int, parts: int) -> list[int]:
    base = total // parts
    extra = total % parts
    return [base + (1 if idx < extra else 0) for idx in range(parts)]


def _new_policy_accumulators() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    return (
        np.zeros((NUM_BUCKETS, NUM_PIECE_TYPES), dtype=np.float64),
        np.zeros((NUM_BUCKETS, NUM_PIECE_TYPES, BOARD_SIZE), dtype=np.float64),
        np.zeros((NUM_BUCKETS, NUM_PIECE_TYPES), dtype=np.float64),
        np.zeros((NUM_BUCKETS, NUM_PIECE_TYPES, BOARD_SIZE), dtype=np.float64),
    )


def _policy_worker(config: dict) -> dict:
    target_positions = int(config["positions"])
    rng = random.Random(int(config["seed"]))
    norm_black = compute_norm_black()
    legal_piece, legal_to, best_piece_arr, best_to_arr = _new_policy_accumulators()

    teacher = UciTeacher(
        config["engine"],
        options={"Threads": 1, "Hash": ENGINE_HASH_MB},
    )

    total_positions = 0
    game_num = 0
    t0 = time.perf_counter()

    teacher.start()
    try:
        while total_positions < target_positions:
            game_num += 1
            count = play_one_game(
                teacher,
                norm_black,
                int(config["movetime"]),
                rng,
                legal_piece=legal_piece,
                legal_to=legal_to,
                best_piece=best_piece_arr,
                best_to=best_to_arr,
                max_positions=target_positions - total_positions,
            )
            total_positions += count
    finally:
        teacher.close()

    return {
        "worker_idx": int(config["worker_idx"]),
        "positions": total_positions,
        "games": game_num,
        "elapsed": time.perf_counter() - t0,
        "legal_piece": legal_piece,
        "legal_to": legal_to,
        "best_piece": best_piece_arr,
        "best_to": best_to_arr,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate policy tables using Pikafish as teacher"
    )
    parser.add_argument(
        "--positions", type=int, default=5000,
        help="Target number of positions to collect (default: 5000)"
    )
    parser.add_argument(
        "--movetime", type=int, default=80,
        help="Pikafish analysis time per position in ms (default: 80)"
    )
    parser.add_argument(
        "--engine", type=str, default=str(ROOT / "data" / "default-engines" / "pikafish"),
        help="Path to Pikafish binary"
    )
    parser.add_argument(
        "--output", type=str, default=str(ROOT / "autoresearch" / "models" / "policy_v11.npz"),
        help="Output NPZ path"
    )
    parser.add_argument(
        "--seed", type=int, default=42,
        help="Random seed for opening diversity (default: 42)"
    )
    parser.add_argument(
        "--workers", type=int, default=1,
        help="Number of parallel workers, each with its own Pikafish (default: 1)"
    )
    parser.add_argument(
        "--output-mode",
        choices=("final", "shard"),
        default="final",
        help="Save final policy tables or raw shard counts (default: final)",
    )
    args = parser.parse_args()

    if args.positions <= 0:
        parser.error("--positions must be >= 1")
    if args.workers <= 0:
        parser.error("--workers must be >= 1")

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    norm_black = compute_norm_black()
    worker_count = max(1, min(args.workers, args.positions))
    work_parts = _split_total(args.positions, worker_count)
    configs = [
        {
            "worker_idx": idx,
            "positions": work_parts[idx],
            "movetime": args.movetime,
            "engine": args.engine,
            "seed": args.seed + idx * SEED_STRIDE,
        }
        for idx in range(worker_count)
        if work_parts[idx] > 0
    ]

    legal_piece, legal_to, best_piece_arr, best_to_arr = _new_policy_accumulators()
    total_positions = 0
    game_num = 0
    t0 = time.perf_counter()

    try:
        if len(configs) == 1:
            parts = [_policy_worker(configs[0])]
        else:
            ctx = mp.get_context("spawn")
            parts = []
            with ProcessPoolExecutor(max_workers=len(configs), mp_context=ctx) as executor:
                futures = {executor.submit(_policy_worker, config): config for config in configs}
                for future in as_completed(futures):
                    part = future.result()
                    parts.append(part)
                    print(
                        f"  worker {part['worker_idx'] + 1}/{len(configs)}: "
                        f"{part['positions']} positions from {part['games']} games "
                        f"in {part['elapsed']:.1f}s",
                        flush=True,
                    )
    except KeyboardInterrupt:
        print("\nInterrupted, waiting for running workers to stop...", flush=True)
        raise

    for part in sorted(parts, key=lambda item: item["worker_idx"]):
        total_positions += int(part["positions"])
        game_num += int(part["games"])
        legal_piece += part["legal_piece"]
        legal_to += part["legal_to"]
        best_piece_arr += part["best_piece"]
        best_to_arr += part["best_to"]

    elapsed_total = time.perf_counter() - t0
    print(
        f"\nCollected {total_positions} positions in {elapsed_total:.1f}s "
        f"({game_num} games, {len(configs)} worker{'s' if len(configs) != 1 else ''})"
    )

    if args.output_mode == "shard":
        np.savez(
            out_path,
            legal_piece=legal_piece,
            legal_to=legal_to,
            best_piece=best_piece_arr,
            best_to=best_to_arr,
            norm_black=norm_black,
            positions=np.asarray(total_positions, dtype=np.int32),
            games=np.asarray(game_num, dtype=np.int32),
        )
        print(f"\nSaved shard counts to {out_path}")
        print(f"  positions: {total_positions}")
        print(f"  games:     {game_num}")
        return

    # Convert counts to log-ratio scores
    policy_piece = counts_to_log_ratio(best_piece_arr, legal_piece)
    policy_to_raw = counts_to_log_ratio(best_to_arr, legal_to)

    # Normalize policy_to: subtract mean per piece/bucket
    for b in range(NUM_BUCKETS):
        for pt in range(NUM_PIECE_TYPES):
            row = policy_to_raw[b, pt]
            # Only consider squares that have any data
            mask = (legal_to[b, pt] > 0)
            if mask.any():
                row -= row[mask].mean()

    # Clip again after normalization
    policy_piece = np.clip(policy_piece, CLIP_MIN, CLIP_MAX).astype(np.int16)
    policy_to_final = np.clip(policy_to_raw, CLIP_MIN, CLIP_MAX).astype(np.int16)

    # Save
    np.savez(
        out_path,
        policy_piece=policy_piece,
        policy_to=policy_to_final,
        norm_black=norm_black,
    )
    print(f"\nSaved to {out_path}")
    print(f"  policy_piece: {policy_piece.shape} {policy_piece.dtype}")
    print(f"  policy_to:    {policy_to_final.shape} {policy_to_final.dtype}")
    print(f"  norm_black:   {norm_black.shape} {norm_black.dtype}")

    # Print summary statistics
    print("\nPhase bucket statistics (positions per bucket):")
    for b in range(NUM_BUCKETS):
        total = int(legal_piece[b].sum())
        best = int(best_piece_arr[b].sum())
        label = ["opening", "middlegame", "endgame"][b]
        print(f"  bucket {b} ({label}): {best} best moves from {total} legal moves")

    print("\nTop piece-type biases (policy_piece):")
    pt_names = ["?", "K", "A", "B", "N", "R", "C", "P"]
    for b in range(NUM_BUCKETS):
        label = ["opening", "middlegame", "endgame"][b]
        vals = [(pt_names[pt], int(policy_piece[b, pt])) for pt in range(1, 8)]
        vals.sort(key=lambda x: -x[1])
        top = ", ".join(f"{name}={v}" for name, v in vals[:4])
        print(f"  {label}: {top}")


if __name__ == "__main__":
    main()
