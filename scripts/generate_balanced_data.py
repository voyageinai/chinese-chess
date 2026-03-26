#!/usr/bin/env python3
"""Generate balanced training data with proper endgame representation.

Uses Pikafish self-play to generate positions across ALL game phases,
oversampling endgame positions to fix the catastrophic imbalance in
previous training datasets (83.8% opening, 0.1% endgame).

Target distribution: ~40% opening, ~40% middlegame, ~20% endgame.
"""

from __future__ import annotations

import argparse
import sys
import time
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
    PHASE,
    PIECE_OFFSET,
    START_FEN,
)
from autoresearch.fen_utils import board_to_fen, internal_to_uci_fen
from scripts.uci_teacher import UciTeacher

# ── Constants ──────────────────────────────────────────────────────────
PIKAFISH_PATH = str(ROOT / "data" / "default-engines" / "pikafish")

# Phase thresholds (raw phase values, not fractions)
PHASE_TOTAL = 40.0
PHASE_OPENING = 27      # phase_total >= 27 → opening
PHASE_MIDDLEGAME = 14   # 14 <= phase_total < 27 → middlegame
# phase_total < 14 → endgame

# Sparse feature encoding (must match autoresearch/train.py)
FEATURE_PLANES = 15
FEATURE_DIM = FEATURE_PLANES * BOARD_SIZE  # 15 * 90 = 1350
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
    """Get raw phase total for a board position."""
    return board.red_phase + board.black_phase


def _classify_phase(phase_total: int) -> str:
    """Classify phase into opening/middlegame/endgame."""
    if phase_total >= PHASE_OPENING:
        return "opening"
    elif phase_total >= PHASE_MIDDLEGAME:
        return "middlegame"
    else:
        return "endgame"


def _board_to_sparse(board: Board) -> tuple[np.ndarray, int, int, float, int, float]:
    """Convert board to sparse feature representation.

    Returns: (indices, red_bucket, black_bucket, phase_fraction, turn, base_pst_score)
    """
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
    # board.score is always from red's perspective (PSQ table)
    # base_score: side-to-move perspective for residual training
    base_score = float(board.score if board.red_turn else -board.score)
    return indices, red_bucket, black_bucket, phase, turn, base_score


def _collect_policy_stats(
    board: Board,
    best_move: int,
    phase_total: int,
    policy_best_piece: np.ndarray,
    policy_legal_piece: np.ndarray,
    policy_best_to: np.ndarray,
    policy_legal_to: np.ndarray,
) -> None:
    """Accumulate policy statistics for this position."""
    phase_bucket = 0 if phase_total >= PHASE_OPENING else (1 if phase_total >= PHASE_MIDDLEGAME else 2)
    legal_moves = board.gen_legal()

    for move in legal_moves:
        fr = move // MOVE_STRIDE
        to = move % MOVE_STRIDE
        piece = board.sq[fr]
        pt = abs(piece)
        if pt == 0 or pt > 7:
            continue

        policy_legal_piece[phase_bucket, pt] += 1
        policy_legal_to[phase_bucket, pt, to] += 1

        if move == best_move:
            policy_best_piece[phase_bucket, pt] += 1
            policy_best_to[phase_bucket, pt, to] += 1


def generate_balanced_data(
    output_path: str,
    target_positions: int = 8000,
    selfplay_movetime: int = 50,
    analysis_movetime: int = 80,
    seed: int = 42,
) -> None:
    """Generate balanced training data via Pikafish self-play.

    Plays complete games (Pikafish vs itself) and collects positions from
    all phases, oversampling endgame positions.
    """
    rng = np.random.RandomState(seed)

    # Target distribution: 40/40/20
    target_opening = int(target_positions * 0.40)
    target_middlegame = int(target_positions * 0.40)
    target_endgame = target_positions - target_opening - target_middlegame

    print(f"Target distribution:")
    print(f"  Opening:    {target_opening}")
    print(f"  Middlegame: {target_middlegame}")
    print(f"  Endgame:    {target_endgame}")
    print()

    # Storage lists
    all_indices = []
    all_red_buckets = []
    all_black_buckets = []
    all_phases = []
    all_turns = []
    all_base_scores = []
    all_residuals = []

    counts = {"opening": 0, "middlegame": 0, "endgame": 0}
    targets = {"opening": target_opening, "middlegame": target_middlegame, "endgame": target_endgame}

    # Policy accumulators: (3 phase_buckets, 8 piece_types)
    policy_best_piece = np.zeros((3, 8), dtype=np.float64)
    policy_legal_piece = np.zeros((3, 8), dtype=np.float64)
    policy_best_to = np.zeros((3, 8, BOARD_SIZE), dtype=np.float64)
    policy_legal_to = np.zeros((3, 8, BOARD_SIZE), dtype=np.float64)

    # Initialize Pikafish engines (one for self-play, one for analysis)
    print("Starting Pikafish for self-play...")
    play_engine = UciTeacher(PIKAFISH_PATH)
    play_engine.start()

    print("Starting Pikafish for position analysis...")
    analysis_engine = UciTeacher(PIKAFISH_PATH)
    analysis_engine.start()

    board = Board()
    game_count = 0
    t0 = time.time()
    max_time = 1800  # 30 minute safety limit

    def all_targets_met() -> bool:
        return all(counts[k] >= targets[k] for k in counts)

    try:
        while not all_targets_met() and (time.time() - t0) < max_time:
            game_count += 1
            board.load_fen(START_FEN)

            # Collect positions from this game
            game_positions = []  # list of (board_state_dict, phase_class, phase_total)
            move_count = 0
            max_moves = 250  # safety limit per game

            while move_count < max_moves:
                # Check if game is over
                legal = board.gen_legal()
                if not legal:
                    break

                phase_total = _get_phase_total(board)
                phase_class = _classify_phase(phase_total)

                # Decide whether to sample this position based on phase
                should_sample = False
                if phase_class == "endgame" and counts["endgame"] < targets["endgame"]:
                    # Sample EVERY endgame position (they're rare)
                    should_sample = True
                elif phase_class == "middlegame" and counts["middlegame"] < targets["middlegame"]:
                    # Sample every 2nd middlegame position
                    should_sample = (move_count % 2 == 0)
                elif phase_class == "opening" and counts["opening"] < targets["opening"]:
                    # Sample every 3rd opening position
                    should_sample = (move_count % 3 == 0)

                if should_sample:
                    game_positions.append({
                        "fen": board_to_fen(board),
                        "phase_class": phase_class,
                        "phase_total": phase_total,
                        "board_indices": None,  # filled below
                        "red_bucket": None,
                        "black_bucket": None,
                        "phase_frac": None,
                        "turn": None,
                        "base_score": None,
                    })
                    # Extract sparse features now (before the board changes)
                    idx, rb, bb, ph, t, bs = _board_to_sparse(board)
                    pos = game_positions[-1]
                    pos["board_indices"] = idx
                    pos["red_bucket"] = rb
                    pos["black_bucket"] = bb
                    pos["phase_frac"] = ph
                    pos["turn"] = t
                    pos["base_score"] = bs

                # Play a move using Pikafish
                fen = board_to_fen(board)
                try:
                    score, best_uci = play_engine.analyze(fen, movetime=selfplay_movetime)
                    move_int = play_engine.uci_to_move(best_uci)
                    if move_int < 0 or move_int not in legal:
                        # Engine returned invalid move, end game
                        break
                except Exception:
                    break

                board.make(move_int)
                move_count += 1

                # Check for king capture (game over)
                if board.red_king < 0 or board.black_king < 0:
                    break

            # Now analyze collected positions with deeper search
            positions_added = 0
            for pos in game_positions:
                phase_class = pos["phase_class"]
                if counts[phase_class] >= targets[phase_class]:
                    continue

                fen = pos["fen"]
                try:
                    score, best_uci = analysis_engine.analyze(fen, movetime=analysis_movetime)
                except Exception:
                    continue

                # Score is from side-to-move perspective
                # Convert to red perspective for storage
                turn = pos["turn"]
                red_score = score if turn == 0 else -score

                # Skip extreme positions
                if abs(red_score) > TARGET_CLIP:
                    continue

                # Compute residual: pikafish_stm - base_pst_stm
                stm_score = score  # already side-to-move perspective
                residual = float(stm_score) - pos["base_score"]

                all_indices.append(pos["board_indices"])
                all_red_buckets.append(pos["red_bucket"])
                all_black_buckets.append(pos["black_bucket"])
                all_phases.append(pos["phase_frac"])
                all_turns.append(pos["turn"])
                all_base_scores.append(pos["base_score"])
                all_residuals.append(residual)
                counts[phase_class] += 1
                positions_added += 1

                # Collect policy stats
                # Need to recreate board for gen_legal
                tmp_board = Board()
                tmp_board.load_fen(fen)
                best_move_int = analysis_engine.uci_to_move(best_uci)
                _collect_policy_stats(
                    tmp_board, best_move_int, pos["phase_total"],
                    policy_best_piece, policy_legal_piece,
                    policy_best_to, policy_legal_to,
                )

            elapsed = time.time() - t0
            total = sum(counts.values())
            if game_count % 10 == 0 or all_targets_met():
                print(
                    f"Game {game_count:4d} | "
                    f"Total: {total:5d} | "
                    f"O: {counts['opening']:5d}/{targets['opening']} | "
                    f"M: {counts['middlegame']:5d}/{targets['middlegame']} | "
                    f"E: {counts['endgame']:5d}/{targets['endgame']} | "
                    f"{elapsed:.0f}s"
                )

    finally:
        play_engine.close()
        analysis_engine.close()

    total = sum(counts.values())
    elapsed = time.time() - t0
    print(f"\nGeneration complete: {total} positions from {game_count} games in {elapsed:.1f}s")
    print(f"  Opening:    {counts['opening']:5d} ({100*counts['opening']/max(1,total):.1f}%)")
    print(f"  Middlegame: {counts['middlegame']:5d} ({100*counts['middlegame']/max(1,total):.1f}%)")
    print(f"  Endgame:    {counts['endgame']:5d} ({100*counts['endgame']/max(1,total):.1f}%)")

    if total == 0:
        print("ERROR: No positions collected!")
        sys.exit(1)

    # Convert to numpy arrays
    indices_array = np.array(all_indices, dtype=np.int32)       # (N, MAX_PIECES)
    red_buckets = np.array(all_red_buckets, dtype=np.int8)      # (N,)
    black_buckets = np.array(all_black_buckets, dtype=np.int8)  # (N,)
    phases = np.array(all_phases, dtype=np.float32)             # (N,)
    turns = np.array(all_turns, dtype=np.int8)                  # (N,)
    base_scores = np.array(all_base_scores, dtype=np.float32)   # (N,)
    residuals = np.array(all_residuals, dtype=np.float32)       # (N,)

    # Save as NPZ
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
        # Policy counts for policy table generation
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
    args = parser.parse_args()

    generate_balanced_data(
        output_path=args.output,
        target_positions=args.positions,
        selfplay_movetime=args.selfplay_movetime,
        analysis_movetime=args.analysis_movetime,
        seed=args.seed,
    )
