#!/usr/bin/env python3
"""Merge distributed research shard outputs into final NPZ artifacts."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.generate_policy as policy_mod


def merge_policy(inputs: list[Path], output: Path) -> None:
    legal_piece, legal_to, best_piece, best_to = policy_mod._new_policy_accumulators()
    norm_black: np.ndarray | None = None
    total_positions = 0
    total_games = 0

    for input_path in inputs:
        with np.load(input_path, allow_pickle=False) as data:
            legal_piece += data["legal_piece"].astype(np.float64)
            legal_to += data["legal_to"].astype(np.float64)
            best_piece += data["best_piece"].astype(np.float64)
            best_to += data["best_to"].astype(np.float64)
            shard_norm = data["norm_black"].astype(np.int16)
            if norm_black is None:
                norm_black = shard_norm
            total_positions += int(data["positions"])
            total_games += int(data["games"])

    if norm_black is None:
        raise RuntimeError("No policy shard inputs provided")

    policy_piece = policy_mod.counts_to_log_ratio(best_piece, legal_piece)
    policy_to_raw = policy_mod.counts_to_log_ratio(best_to, legal_to)
    for bucket in range(policy_mod.NUM_BUCKETS):
        for pt in range(policy_mod.NUM_PIECE_TYPES):
            row = policy_to_raw[bucket, pt]
            mask = legal_to[bucket, pt] > 0
            if mask.any():
                row -= row[mask].mean()

    np.savez(
        output,
        policy_piece=np.clip(policy_piece, policy_mod.CLIP_MIN, policy_mod.CLIP_MAX).astype(np.int16),
        policy_to=np.clip(policy_to_raw, policy_mod.CLIP_MIN, policy_mod.CLIP_MAX).astype(np.int16),
        norm_black=norm_black,
    )
    print(f"Merged policy shards: {total_positions} positions from {total_games} games -> {output}")


def merge_balanced(inputs: list[Path], output: Path) -> None:
    indices = []
    red_buckets = []
    black_buckets = []
    phases = []
    turns = []
    base_scores = []
    residuals = []
    policy_best_piece = None
    policy_legal_piece = None
    policy_best_to = None
    policy_legal_to = None

    for input_path in inputs:
        with np.load(input_path, allow_pickle=False) as data:
            indices.append(data["indices"].astype(np.int32))
            red_buckets.append(data["red_buckets"].astype(np.int8))
            black_buckets.append(data["black_buckets"].astype(np.int8))
            phases.append(data["phases"].astype(np.float32))
            turns.append(data["turns"].astype(np.int8))
            base_scores.append(data["base_scores"].astype(np.float32))
            residuals.append(data["residuals"].astype(np.float32))

            if policy_best_piece is None:
                policy_best_piece = data["policy_best_piece"].astype(np.float64)
                policy_legal_piece = data["policy_legal_piece"].astype(np.float64)
                policy_best_to = data["policy_best_to"].astype(np.float64)
                policy_legal_to = data["policy_legal_to"].astype(np.float64)
            else:
                policy_best_piece += data["policy_best_piece"].astype(np.float64)
                policy_legal_piece += data["policy_legal_piece"].astype(np.float64)
                policy_best_to += data["policy_best_to"].astype(np.float64)
                policy_legal_to += data["policy_legal_to"].astype(np.float64)

    if policy_best_piece is None:
        raise RuntimeError("No balanced shard inputs provided")

    merged_residuals = np.concatenate(residuals, axis=0).astype(np.float32, copy=False)
    np.savez(
        output,
        indices=np.concatenate(indices, axis=0).astype(np.int32, copy=False),
        red_buckets=np.concatenate(red_buckets, axis=0).astype(np.int8, copy=False),
        black_buckets=np.concatenate(black_buckets, axis=0).astype(np.int8, copy=False),
        phases=np.concatenate(phases, axis=0).astype(np.float32, copy=False),
        turns=np.concatenate(turns, axis=0).astype(np.int8, copy=False),
        base_scores=np.concatenate(base_scores, axis=0).astype(np.float32, copy=False),
        residuals=merged_residuals,
        policy_best_piece=policy_best_piece,
        policy_legal_piece=policy_legal_piece,
        policy_best_to=policy_best_to,
        policy_legal_to=policy_legal_to,
    )
    print(f"Merged balanced shards: {len(merged_residuals)} positions -> {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge distributed research shard outputs")
    parser.add_argument("--kind", choices=("policy", "balanced"), required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("inputs", nargs="+")
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    inputs = [Path(item) for item in args.inputs]

    if args.kind == "policy":
        merge_policy(inputs, output)
    else:
        merge_balanced(inputs, output)


if __name__ == "__main__":
    main()
