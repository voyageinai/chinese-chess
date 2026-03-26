#!/usr/bin/env python3
"""Build a single-file uploadable XiangqiModelV14 engine."""

from __future__ import annotations

import pprint
import sys
import textwrap
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.build_xiangqi_model_v12 as base  # noqa: E402


MODEL_PATH = ROOT / "models" / "xiangqi_model_v14.npz"
OUTPUT_PATH = ROOT / "engines" / "xiangqi_model_v14.py"

OLD_EVAL_BLOCK = """    def eval(self):
        base = self.score if self.red_turn else -self.score
        phase = (self.red_phase + self.black_phase) * MODEL_PHASE_INV
        side = 0 if self.red_turn else 1
        red_bucket = MODEL_RED_BUCKET[self.red_king] if self.red_king >= 0 else 4
        black_bucket = MODEL_BLACK_BUCKET[self.black_king] if self.black_king >= 0 else 4

        corr = self.lin_score + MODEL_LIN_TEMPO[side]
        corr += MODEL_OUT_BIAS + phase * MODEL_PHASE_OUT
        corr += MODEL_KING_PAIR_BIAS[red_bucket][black_bucket]

        acc = self.acc
        tempo = MODEL_TEMPO[side]
        red_bias = MODEL_RED_KING_BIAS[red_bucket]
        black_bias = MODEL_BLACK_KING_BIAS[black_bucket]
        for i in range(MODEL_HIDDEN_SIZE):
            x = acc[i] + tempo[i] + phase * MODEL_PHASE_VECTOR[i] + red_bias[i] + black_bias[i]
            if x <= 0.0:
                continue
            if x > MODEL_ACT_CLIP:
                x = MODEL_ACT_CLIP
            corr += MODEL_OUT_W[i] * x

        red_sum = self.red_sum
        black_sum = self.black_sum
        red_vec = MODEL_RED_KING_VEC[red_bucket]
        black_vec = MODEL_BLACK_KING_VEC[black_bucket]
        for i in range(MODEL_FACTOR_SIZE):
            corr += red_sum[i] * red_vec[i] + black_sum[i] * black_vec[i]

        if corr > MODEL_MAX_CORRECTION:
            corr = MODEL_MAX_CORRECTION
        elif corr < -MODEL_MAX_CORRECTION:
            corr = -MODEL_MAX_CORRECTION
        return int(round(base + corr))
"""

NEW_EVAL_BLOCK = """    def eval(self):
        base = self.score if self.red_turn else -self.score
        phase = (self.red_phase + self.black_phase) * MODEL_PHASE_INV
        side = 0 if self.red_turn else 1
        red_bucket = MODEL_RED_BUCKET[self.red_king] if self.red_king >= 0 else 4
        black_bucket = MODEL_BLACK_BUCKET[self.black_king] if self.black_king >= 0 else 4

        corr = self.lin_score + MODEL_LIN_TEMPO[side]
        corr += MODEL_OUT_BIAS + phase * MODEL_PHASE_OUT
        corr += MODEL_KING_PAIR_BIAS[red_bucket][black_bucket]

        acc = self.acc
        tempo = MODEL_TEMPO[side]
        red_bias = MODEL_RED_KING_BIAS[red_bucket]
        black_bias = MODEL_BLACK_KING_BIAS[black_bucket]
        for i in range(MODEL_HIDDEN_SIZE):
            x = acc[i] + tempo[i] + phase * MODEL_PHASE_VECTOR[i] + red_bias[i] + black_bias[i]
            if x <= 0.0:
                continue
            if x > MODEL_ACT_CLIP:
                x = MODEL_ACT_CLIP
            corr += MODEL_OUT_W[i] * x

        red_sum = self.red_sum
        black_sum = self.black_sum
        red_vec = MODEL_RED_KING_VEC[red_bucket]
        black_vec = MODEL_BLACK_KING_VEC[black_bucket]
        for i in range(MODEL_FACTOR_SIZE):
            corr += red_sum[i] * red_vec[i] + black_sum[i] * black_vec[i]

        corr += MODEL_EXPLICIT_SCALE * _explicit_correction(self, phase)

        if corr > MODEL_MAX_CORRECTION:
            corr = MODEL_MAX_CORRECTION
        elif corr < -MODEL_MAX_CORRECTION:
            corr = -MODEL_MAX_CORRECTION
        return int(round(base + corr))
"""


def _explicit_runtime(model: dict[str, list]) -> str:
    consts = "\n".join(
        [
            f"MODEL_EXPLICIT_MEAN = {pprint.pformat(model['explicit_mean'], width=100)}",
            f"MODEL_EXPLICIT_INVSTD = {pprint.pformat(model['explicit_invstd'], width=100)}",
            f"MODEL_EXPLICIT_W = {pprint.pformat(model['explicit_w'], width=100)}",
            f"MODEL_EXPLICIT_PHASE_W = {pprint.pformat(model['explicit_phase_w'], width=100)}",
            f"MODEL_EXPLICIT_BIAS = {float(model['explicit_bias'])}",
            f"MODEL_EXPLICIT_PHASE_BIAS = {float(model['explicit_phase_bias'])}",
            f"MODEL_EXPLICIT_CLIP = {float(model['explicit_clip'])}",
            "MODEL_EXPLICIT_SCALE = 0.25",
            f"MODEL_EXPLICIT_SIZE = {len(model['explicit_w'])}",
        ]
    )
    body = textwrap.dedent(
        """
        def _explicit_line_blockers(sq, fr, to):
            if fr == to:
                return None
            fr_r = ROW_OF[fr]
            to_r = ROW_OF[to]
            fr_c = COL_OF[fr]
            to_c = COL_OF[to]
            if fr_r == to_r:
                step = 1 if to > fr else -1
            elif fr_c == to_c:
                step = COLS if to > fr else -COLS
            else:
                return None
            blockers = 0
            pos = fr + step
            while pos != to:
                if sq[pos]:
                    blockers += 1
                pos += step
            return blockers


        def _explicit_knight_stats(sq, fr, side):
            mobility = 0
            blocked = 0
            for block, to in KNIGHT_MOVES[fr]:
                if sq[block]:
                    blocked += 1
                    continue
                if sq[to] * side <= 0:
                    mobility += 1
            return mobility, blocked


        def _explicit_connected_crossed(pawns):
            by_row = {}
            for row, col in pawns:
                by_row.setdefault(row, []).append(col)
            total = 0
            for cols in by_row.values():
                cols.sort()
                for left, right in zip(cols, cols[1:]):
                    if right == left + 1:
                        total += 1
            return total


        def _explicit_features(board):
            sq = board.sq
            red_advisors = 0
            black_advisors = 0
            red_bishops = 0
            black_bishops = 0
            red_crossed = 0
            black_crossed = 0
            red_center_crossed = 0
            black_center_crossed = 0
            red_flank_crossed = 0
            black_flank_crossed = 0
            red_pawn_advance = 0
            black_pawn_advance = 0
            red_advanced_rooks = 0
            black_advanced_rooks = 0
            red_advanced_cannons = 0
            black_advanced_cannons = 0
            red_advanced_knights = 0
            black_advanced_knights = 0
            red_crossed_pos = []
            black_crossed_pos = []
            red_rook_file = 0
            black_rook_file = 0
            red_rook_rank = 0
            black_rook_rank = 0
            red_cannon_file = 0
            black_cannon_file = 0
            red_cannon_rank = 0
            black_cannon_rank = 0
            red_knight_mobility = 0
            black_knight_mobility = 0
            red_knight_blocks = 0
            black_knight_blocks = 0

            for fr, piece in enumerate(sq):
                if not piece:
                    continue
                pt = piece if piece > 0 else -piece
                row = ROW_OF[fr]
                col = COL_OF[fr]
                if piece > 0:
                    if pt == A:
                        red_advisors += 1
                    elif pt == B:
                        red_bishops += 1
                    elif pt == P:
                        adv = 6 - row
                        if adv > 0:
                            red_pawn_advance += adv
                        if row <= 4:
                            red_crossed += 1
                            red_crossed_pos.append((row, col))
                            if 3 <= col <= 5:
                                red_center_crossed += 1
                            if col <= 2 or col >= 6:
                                red_flank_crossed += 1
                    elif pt == R and row <= 4:
                        red_advanced_rooks += 1
                    elif pt == C and row <= 4:
                        red_advanced_cannons += 1
                    elif pt == N and row <= 4:
                        red_advanced_knights += 1
                else:
                    if pt == A:
                        black_advisors += 1
                    elif pt == B:
                        black_bishops += 1
                    elif pt == P:
                        adv = row - 3
                        if adv > 0:
                            black_pawn_advance += adv
                        if row >= 5:
                            black_crossed += 1
                            black_crossed_pos.append((row, col))
                            if 3 <= col <= 5:
                                black_center_crossed += 1
                            if col <= 2 or col >= 6:
                                black_flank_crossed += 1
                    elif pt == R and row >= 5:
                        black_advanced_rooks += 1
                    elif pt == C and row >= 5:
                        black_advanced_cannons += 1
                    elif pt == N and row >= 5:
                        black_advanced_knights += 1

            for fr, piece in enumerate(sq):
                if not piece:
                    continue
                pt = piece if piece > 0 else -piece
                if pt == N:
                    mobility, blocked = _explicit_knight_stats(sq, fr, 1 if piece > 0 else -1)
                    if piece > 0:
                        red_knight_mobility += mobility
                        red_knight_blocks += blocked
                    else:
                        black_knight_mobility += mobility
                        black_knight_blocks += blocked
                    continue
                if pt != R and pt != C:
                    continue
                target = board.black_king if piece > 0 else board.red_king
                if target < 0:
                    continue
                blockers = _explicit_line_blockers(sq, fr, target)
                if blockers is None:
                    continue
                same_file = COL_OF[fr] == COL_OF[target]
                same_rank = ROW_OF[fr] == ROW_OF[target]
                if pt == R and blockers == 0:
                    if piece > 0:
                        if same_file:
                            red_rook_file += 1
                        if same_rank:
                            red_rook_rank += 1
                    else:
                        if same_file:
                            black_rook_file += 1
                        if same_rank:
                            black_rook_rank += 1
                elif pt == C and blockers == 1:
                    if piece > 0:
                        if same_file:
                            red_cannon_file += 1
                        if same_rank:
                            red_cannon_rank += 1
                    else:
                        if same_file:
                            black_cannon_file += 1
                        if same_rank:
                            black_cannon_rank += 1

            feats = [
                red_advisors - black_advisors,
                red_bishops - black_bishops,
                (1 if red_advisors >= 2 else 0) - (1 if black_advisors >= 2 else 0),
                (1 if red_bishops >= 2 else 0) - (1 if black_bishops >= 2 else 0),
                (red_advisors * 2 + red_bishops) - (black_advisors * 2 + black_bishops),
                red_crossed - black_crossed,
                red_center_crossed - black_center_crossed,
                red_flank_crossed - black_flank_crossed,
                _explicit_connected_crossed(red_crossed_pos) - _explicit_connected_crossed(black_crossed_pos),
                red_pawn_advance - black_pawn_advance,
                red_rook_file - black_rook_file,
                red_rook_rank - black_rook_rank,
                red_cannon_file - black_cannon_file,
                red_cannon_rank - black_cannon_rank,
                red_knight_mobility - black_knight_mobility,
                red_knight_blocks - black_knight_blocks,
                red_advanced_rooks - black_advanced_rooks,
                red_advanced_cannons - black_advanced_cannons,
                red_advanced_knights - black_advanced_knights,
            ]
            if not board.red_turn:
                for i in range(MODEL_EXPLICIT_SIZE):
                    feats[i] = -feats[i]
            return feats


        def _explicit_correction(board, phase):
            if MODEL_EXPLICIT_CLIP <= 0.0:
                return 0.0
            feats = _explicit_features(board)
            corr = MODEL_EXPLICIT_BIAS + phase * MODEL_EXPLICIT_PHASE_BIAS
            for i in range(MODEL_EXPLICIT_SIZE):
                x = (feats[i] - MODEL_EXPLICIT_MEAN[i]) * MODEL_EXPLICIT_INVSTD[i]
                corr += MODEL_EXPLICIT_W[i] * x + MODEL_EXPLICIT_PHASE_W[i] * x * phase
            if corr > MODEL_EXPLICIT_CLIP:
                return MODEL_EXPLICIT_CLIP
            if corr < -MODEL_EXPLICIT_CLIP:
                return -MODEL_EXPLICIT_CLIP
            return corr
        """
    ).strip()
    return consts + "\n\n" + body


def build() -> None:
    base.base.base.MODEL_PATH = MODEL_PATH
    base.base.base.OUTPUT_PATH = OUTPUT_PATH
    base.build()

    with np.load(MODEL_PATH) as data:
        model = {key: data[key].tolist() for key in data.files}

    text = OUTPUT_PATH.read_text()
    text = text.replace("XiangqiModelV12", "XiangqiModelV14")
    text = text.replace("builtin-residual-policy-v12", "builtin-residual-policy-v14")

    marker = "\n\nclass ModelBoard(Board):"
    if marker not in text:
        raise RuntimeError("failed to find ModelBoard marker in generated engine")
    text = text.replace(marker, "\n\n" + _explicit_runtime(model) + "\n\n\nclass ModelBoard(Board):", 1)

    if OLD_EVAL_BLOCK not in text:
        raise RuntimeError("failed to find eval block in generated engine")
    text = text.replace(OLD_EVAL_BLOCK, NEW_EVAL_BLOCK, 1)

    OUTPUT_PATH.write_text(text)


if __name__ == "__main__":
    build()
