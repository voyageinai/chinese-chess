#!/usr/bin/env python3
"""Build SmartPy-Pro-NN: SmartPy-Pro advanced search + v16 NN eval + policy.

Combines:
1. SmartPy-Pro's search (futility, LMR, LMP, RFP, IIR, countermoves, etc.)
2. v16 Pikafish-distilled NN evaluation (residual correction + king buckets)
3. v16 policy network (move ordering prior)
4. KNIGHT_ATTACKS fix (correct horse leg block detection)
5. Stalemate = loss (xiangqi rule)
6. Repetition detection
"""

import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
V16_PATH = os.path.join(ROOT, "engines", "xiangqi_model_v16_pikafish_small.py")
OUTPUT_PATH = os.path.join(ROOT, "engines", "smartpy_pro_nn.py")


def extract_weights(v16_code: str) -> str:
    """Extract all MODEL_* variable definitions from v16."""
    lines = v16_code.split("\n")
    weight_lines = []
    in_model = False
    for line in lines:
        if line.startswith("MODEL_"):
            in_model = True
        if in_model:
            weight_lines.append(line)
            # End of a variable: next line starts with MODEL_ or is empty/class
            if not line.endswith(",") and not line.endswith("[") and not line.endswith("("):
                # Check if this terminates a variable
                pass
    # Simpler: extract lines from first MODEL_ to MODEL_FACTOR_SIZE
    start = None
    end = None
    for i, line in enumerate(lines):
        if line.startswith("MODEL_EMB") and start is None:
            start = i
        if line.startswith("MODEL_FACTOR_SIZE"):
            end = i + 1
            break
    if start is None or end is None:
        raise RuntimeError("Cannot find MODEL_* weight data in v16 file")
    return "\n".join(lines[start:end])


def build():
    with open(V16_PATH, "r") as f:
        v16_code = f.read()

    weights = extract_weights(v16_code)

    engine_code = '''#!/usr/bin/env python3
"""SmartPy-Pro-NN: Advanced search + neural network evaluation.

Combines SmartPy-Pro search optimizations with Pikafish-distilled NN eval.
- Futility pruning, reverse futility, razoring, LMR, LMP, IIR
- Countermove heuristic, killer moves, history heuristic
- NN residual evaluation (trained from Pikafish)
- Policy network for move ordering
- Fixed KNIGHT_ATTACKS table (correct horse leg detection)
- Stalemate = loss (xiangqi WXF rules)
- Game history repetition avoidance
"""

import math
import random
import time

ROWS, COLS = 10, 9
BOARD_SIZE = ROWS * COLS
MOVE_STRIDE = BOARD_SIZE

MAT = (0, 10000, 120, 120, 480, 1000, 510, 80)

START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

EMPTY = 0
K, A, B, N, R, C, P = 1, 2, 3, 4, 5, 6, 7
NO_MOVE = -1
PIECE_OFFSET = 7

INF = 32000
MATE = 30000
MAX_PLY = 96
MAX_QS_PLY = 6

TT_EXACT = 0
TT_LOWER = 1
TT_UPPER = 2

PHASE = (0, 0, 1, 1, 2, 4, 2, 0)

PIECE_FROM_CHAR = {
    "K": K, "A": A, "B": B, "N": N, "R": R, "C": C, "P": P,
    "k": -K, "a": -A, "b": -B, "n": -N, "r": -R, "c": -C, "p": -P,
}

# fmt: off
PST_KNIGHT = [
    [ 0, -5,  0,  0,  0,  0,  0, -5,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 0,  5, 10, 10, 15, 10, 10,  5,  0],
    [ 0, 10, 20, 10, 20, 10, 20, 10,  0],
    [ 0,  5, 15, 20, 20, 20, 15,  5,  0],
    [ 0,  5, 15, 25, 25, 25, 15,  5,  0],
    [ 0,  0, 10, 20, 30, 20, 10,  0,  0],
    [ 0,  0,  5, 10, 20, 10,  5,  0,  0],
    [ 0,  0,  0,  5, 10,  5,  0,  0,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
]
PST_ROOK = [
    [ 0,  0,  0, 10, 10, 10,  0,  0,  0],
    [ 0,  0,  0,  5,  5,  5,  0,  0,  0],
    [ 0,  0,  5,  5, 10,  5,  5,  0,  0],
    [ 5,  5,  5, 10, 10, 10,  5,  5,  5],
    [ 5, 10, 10, 10, 15, 10, 10, 10,  5],
    [10, 15, 15, 15, 20, 15, 15, 15, 10],
    [10, 15, 15, 15, 20, 15, 15, 15, 10],
    [15, 15, 15, 15, 20, 15, 15, 15, 15],
    [10, 10, 10, 15, 15, 15, 10, 10, 10],
    [ 5,  5,  5, 10, 10, 10,  5,  5,  5],
]
PST_CANNON = [
    [ 0,  0,  0,  5,  5,  5,  0,  0,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 0,  5,  5,  5, 10,  5,  5,  5,  0],
    [ 0,  5,  5,  5, 10,  5,  5,  5,  0],
    [ 0, 10, 10, 15, 15, 15, 10, 10,  0],
    [ 5, 10, 15, 20, 25, 20, 15, 10,  5],
    [ 5, 10, 10, 15, 20, 15, 10, 10,  5],
    [ 0,  5,  5, 10, 15, 10,  5,  5,  0],
    [ 0,  0,  0,  5,  5,  5,  0,  0,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
]
PST_PAWN = [
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 0,  0,  0,  0,  5,  0,  0,  0,  0],
    [ 0,  0,  5,  0, 10,  0,  5,  0,  0],
    [ 5,  0, 10,  0, 15,  0, 10,  0,  5],
    [10, 20, 30, 40, 50, 40, 30, 20, 10],
    [20, 30, 50, 60, 70, 60, 50, 30, 20],
    [20, 40, 60, 70, 80, 70, 60, 40, 20],
    [10, 30, 50, 60, 70, 60, 50, 30, 10],
    [ 0, 10, 20, 30, 40, 30, 20, 10,  0],
]
# fmt: on

KING_SAFETY = [
    [-30, -10,   0],
    [-10,   5,  25],
    [  5,  30,  55],
]

ROW_OF = tuple(i // COLS for i in range(BOARD_SIZE))
COL_OF = tuple(i % COLS for i in range(BOARD_SIZE))

HORSE_STEPS = (
    (-1, 0, -2, -1), (-1, 0, -2, 1),
    (1, 0, 2, -1), (1, 0, 2, 1),
    (0, -1, -1, -2), (0, -1, 1, -2),
    (0, 1, -1, 2), (0, 1, 1, 2),
)
ELEPHANT_STEPS = ((-1, -1, -2, -2), (-1, 1, -2, 2), (1, -1, 2, -2), (1, 1, 2, 2))
DIAGONAL_1 = ((-1, -1), (-1, 1), (1, -1), (1, 1))
ORTHOGONAL_1 = ((0, 1), (0, -1), (1, 0), (-1, 0))


def _in_bounds(r, c):
    return 0 <= r < ROWS and 0 <= c < COLS

def _in_palace(r, c, red):
    if not (3 <= c <= 5):
        return False
    return (7 <= r <= 9) if red else (0 <= r <= 2)

def _on_own_side(r, red):
    return r >= 5 if red else r <= 4

def _bonus(pt, nr, c):
    if pt == N: return PST_KNIGHT[nr][c]
    if pt == R: return PST_ROOK[nr][c]
    if pt == C: return PST_CANNON[nr][c]
    if pt == P: return PST_PAWN[nr][c]
    if pt == A: return 8 if c == 4 and nr == 1 else 0
    if pt == B: return 5
    return 0

PSQ = [[0] * BOARD_SIZE for _ in range(15)]
for _sq in range(BOARD_SIZE):
    _r, _c = ROW_OF[_sq], COL_OF[_sq]
    for _pt in range(1, 8):
        PSQ[_pt + PIECE_OFFSET][_sq] = MAT[_pt] + _bonus(_pt, 9 - _r, _c)
        PSQ[-_pt + PIECE_OFFSET][_sq] = -(MAT[_pt] + _bonus(_pt, _r, _c))

# Pre-computed move tables
RAYS = []
KNIGHT_MOVES = []
BISHOP_RED = []
BISHOP_BLACK = []
ADVISOR_RED = []
ADVISOR_BLACK = []
KING_RED = []
KING_BLACK = []
PAWN_RED = []
PAWN_BLACK = []

for _sq in range(BOARD_SIZE):
    _r, _c = ROW_OF[_sq], COL_OF[_sq]
    RAYS.append((
        tuple(_r * COLS + cc for cc in range(_c + 1, COLS)),
        tuple(_r * COLS + cc for cc in range(_c - 1, -1, -1)),
        tuple(rr * COLS + _c for rr in range(_r + 1, ROWS)),
        tuple(rr * COLS + _c for rr in range(_r - 1, -1, -1)),
    ))
    knight = []
    for br, bc, tr, tc in HORSE_STEPS:
        block_r, block_c = _r + br, _c + bc
        dest_r, dest_c = _r + tr, _c + tc
        if _in_bounds(block_r, block_c) and _in_bounds(dest_r, dest_c):
            knight.append((block_r * COLS + block_c, dest_r * COLS + dest_c))
    KNIGHT_MOVES.append(tuple(knight))
    br_list, bb_list = [], []
    for mr, mc, tr, tc in ELEPHANT_STEPS:
        mid_r, mid_c = _r + mr, _c + mc
        dest_r, dest_c = _r + tr, _c + tc
        if not (_in_bounds(mid_r, mid_c) and _in_bounds(dest_r, dest_c)):
            continue
        step = (mid_r * COLS + mid_c, dest_r * COLS + dest_c)
        if _on_own_side(dest_r, True): br_list.append(step)
        if _on_own_side(dest_r, False): bb_list.append(step)
    BISHOP_RED.append(tuple(br_list))
    BISHOP_BLACK.append(tuple(bb_list))
    ar, ab, kr_l, kb_l = [], [], [], []
    for dr, dc in DIAGONAL_1:
        nr, nc = _r + dr, _c + dc
        if _in_bounds(nr, nc):
            if _in_palace(nr, nc, True): ar.append(nr * COLS + nc)
            if _in_palace(nr, nc, False): ab.append(nr * COLS + nc)
    for dr, dc in ORTHOGONAL_1:
        nr, nc = _r + dr, _c + dc
        if _in_bounds(nr, nc):
            if _in_palace(nr, nc, True): kr_l.append(nr * COLS + nc)
            if _in_palace(nr, nc, False): kb_l.append(nr * COLS + nc)
    ADVISOR_RED.append(tuple(ar))
    ADVISOR_BLACK.append(tuple(ab))
    KING_RED.append(tuple(kr_l))
    KING_BLACK.append(tuple(kb_l))
    pr, pb = [], []
    if _r > 0: pr.append((_r - 1) * COLS + _c)
    if _r < ROWS - 1: pb.append((_r + 1) * COLS + _c)
    if _r <= 4:
        if _c > 0: pr.append(_r * COLS + _c - 1)
        if _c < COLS - 1: pr.append(_r * COLS + _c + 1)
    if _r >= 5:
        if _c > 0: pb.append(_r * COLS + _c - 1)
        if _c < COLS - 1: pb.append(_r * COLS + _c + 1)
    PAWN_RED.append(tuple(pr))
    PAWN_BLACK.append(tuple(pb))

RAYS = tuple(RAYS)
KNIGHT_MOVES = tuple(KNIGHT_MOVES)
BISHOP_RED = tuple(BISHOP_RED)
BISHOP_BLACK = tuple(BISHOP_BLACK)
ADVISOR_RED = tuple(ADVISOR_RED)
ADVISOR_BLACK = tuple(ADVISOR_BLACK)
KING_RED = tuple(KING_RED)
KING_BLACK = tuple(KING_BLACK)
PAWN_RED = tuple(PAWN_RED)
PAWN_BLACK = tuple(PAWN_BLACK)

# KNIGHT_ATTACKS: correct (block, attacker) pairs for incoming horse attacks.
# KNIGHT_MOVES has WRONG blocks for attack detection (horse legs are asymmetric).
KNIGHT_ATTACKS = [[] for _ in range(BOARD_SIZE)]
for _ksq in range(BOARD_SIZE):
    _kr, _kc = ROW_OF[_ksq], COL_OF[_ksq]
    for _bdr, _bdc, _tdr, _tdc in HORSE_STEPS:
        _hr, _hc = _kr - _tdr, _kc - _tdc
        if not (0 <= _hr < ROWS and 0 <= _hc < COLS): continue
        _blkr, _blkc = _hr + _bdr, _hc + _bdc
        if not (0 <= _blkr < ROWS and 0 <= _blkc < COLS): continue
        KNIGHT_ATTACKS[_ksq].append((_blkr * COLS + _blkc, _hr * COLS + _hc))
    KNIGHT_ATTACKS[_ksq] = tuple(KNIGHT_ATTACKS[_ksq])
KNIGHT_ATTACKS = tuple(KNIGHT_ATTACKS)

# Zobrist
_rng = random.Random(0)
ZOBRIST = [[0] * BOARD_SIZE for _ in range(15)]
for _pi in range(15):
    if _pi == PIECE_OFFSET: continue
    _row = ZOBRIST[_pi]
    for _sq in range(BOARD_SIZE):
        _row[_sq] = _rng.getrandbits(64)
SIDE_KEY = _rng.getrandbits(64)

# Search parameters
LMR_TABLE = [[0] * 64 for _ in range(64)]
for _d in range(1, 64):
    for _m in range(1, 64):
        LMR_TABLE[_d][_m] = max(0, int(1.0 + math.log(_d) * math.log(_m) / 1.75))

LMP_THRESHOLD = [0, 4, 7, 12, 18, 26, 36, 48]
FUTILITY_MARGIN = [0, 100, 200, 310, 430, 560, 700, 850, 1010]
RFP_MARGIN = [0, 80, 160, 250, 350, 460, 580, 710, 850]

_perf_counter = time.perf_counter

def _score_to_tt(score, ply):
    if score > MATE - MAX_PLY: return score + ply
    if score < -MATE + MAX_PLY: return score - ply
    return score

def _score_from_tt(score, ply):
    if score > MATE - MAX_PLY: return score - ply
    if score < -MATE + MAX_PLY: return score + ply
    return score


# ============================================================
# Neural network weight data (distilled from Pikafish)
# ============================================================

''' + weights + '''


# ============================================================
# Board classes
# ============================================================

class Board:
    __slots__ = (
        "sq", "red_turn", "red_king", "black_king",
        "score", "hash", "red_phase", "black_phase",
        "red_advisors", "black_advisors", "red_bishops", "black_bishops",
    )

    def __init__(self):
        self.sq = [EMPTY] * BOARD_SIZE
        self.red_turn = True
        self.red_king = self.black_king = -1
        self.score = self.hash = 0
        self.red_phase = self.black_phase = 0
        self.red_advisors = self.black_advisors = 0
        self.red_bishops = self.black_bishops = 0

    def load_fen(self, fen):
        sq = self.sq
        sq[:] = [EMPTY] * BOARD_SIZE
        self.red_king = self.black_king = -1
        self.score = self.hash = 0
        self.red_phase = self.black_phase = 0
        self.red_advisors = self.black_advisors = 0
        self.red_bishops = self.black_bishops = 0
        parts = fen.split()
        for r, row_s in enumerate(parts[0].split("/")):
            c = 0
            for ch in row_s:
                if ch.isdigit():
                    c += int(ch); continue
                piece = PIECE_FROM_CHAR[ch]
                s = r * COLS + c
                sq[s] = piece
                self.score += PSQ[piece + PIECE_OFFSET][s]
                self.hash ^= ZOBRIST[piece + PIECE_OFFSET][s]
                pt = piece if piece > 0 else -piece
                if piece > 0:
                    self.red_phase += PHASE[pt]
                    if pt == A: self.red_advisors += 1
                    elif pt == B: self.red_bishops += 1
                else:
                    self.black_phase += PHASE[pt]
                    if pt == A: self.black_advisors += 1
                    elif pt == B: self.black_bishops += 1
                if piece == K: self.red_king = s
                elif piece == -K: self.black_king = s
                c += 1
        self.red_turn = len(parts) <= 1 or parts[1] == "w"
        if not self.red_turn: self.hash ^= SIDE_KEY

    def eval(self):
        s = self.score
        ra, rb = min(self.red_advisors, 2), min(self.red_bishops, 2)
        ba, bb = min(self.black_advisors, 2), min(self.black_bishops, 2)
        s += KING_SAFETY[ra][rb] - KING_SAFETY[ba][bb]
        return s if self.red_turn else -s

    def make(self, move):
        fr = move // MOVE_STRIDE
        to = move - fr * MOVE_STRIDE
        sq = self.sq; piece = sq[fr]; cap = sq[to]
        self.hash ^= ZOBRIST[piece + PIECE_OFFSET][fr]
        self.hash ^= ZOBRIST[piece + PIECE_OFFSET][to]
        if cap: self.hash ^= ZOBRIST[cap + PIECE_OFFSET][to]
        self.hash ^= SIDE_KEY
        self.score -= PSQ[piece + PIECE_OFFSET][fr]
        self.score += PSQ[piece + PIECE_OFFSET][to]
        if cap:
            self.score -= PSQ[cap + PIECE_OFFSET][to]
            pt = cap if cap > 0 else -cap
            if cap > 0:
                self.red_phase -= PHASE[pt]
                if pt == A: self.red_advisors -= 1
                elif pt == B: self.red_bishops -= 1
            else:
                self.black_phase -= PHASE[pt]
                if pt == A: self.black_advisors -= 1
                elif pt == B: self.black_bishops -= 1
        sq[to] = piece; sq[fr] = EMPTY
        if piece == K: self.red_king = to
        elif piece == -K: self.black_king = to
        if cap == K: self.red_king = -1
        elif cap == -K: self.black_king = -1
        self.red_turn = not self.red_turn
        return cap

    def undo(self, move, cap):
        fr = move // MOVE_STRIDE
        to = move - fr * MOVE_STRIDE
        sq = self.sq; piece = sq[to]
        self.red_turn = not self.red_turn
        self.hash ^= SIDE_KEY
        self.hash ^= ZOBRIST[piece + PIECE_OFFSET][to]
        self.hash ^= ZOBRIST[piece + PIECE_OFFSET][fr]
        if cap: self.hash ^= ZOBRIST[cap + PIECE_OFFSET][to]
        self.score -= PSQ[piece + PIECE_OFFSET][to]
        self.score += PSQ[piece + PIECE_OFFSET][fr]
        if cap:
            self.score += PSQ[cap + PIECE_OFFSET][to]
            pt = cap if cap > 0 else -cap
            if cap > 0:
                self.red_phase += PHASE[pt]
                if pt == A: self.red_advisors += 1
                elif pt == B: self.red_bishops += 1
            else:
                self.black_phase += PHASE[pt]
                if pt == A: self.black_advisors += 1
                elif pt == B: self.black_bishops += 1
        sq[fr] = piece; sq[to] = cap
        if piece == K: self.red_king = fr
        elif piece == -K: self.black_king = fr
        if cap == K: self.red_king = to
        elif cap == -K: self.black_king = to

    def in_check(self, red):
        king_sq = self.red_king if red else self.black_king
        if king_sq < 0: return True
        sq = self.sq; side = 1 if red else -1
        for ray in RAYS[king_sq]:
            found = 0
            for pos in ray:
                piece = sq[pos]
                if not piece: continue
                if found == 0:
                    if piece * side < 0:
                        pt = piece if piece > 0 else -piece
                        if pt == R or pt == K: return True
                    found = 1
                else:
                    if piece * side < 0 and (piece == C or piece == -C): return True
                    break
        for block, pos in KNIGHT_ATTACKS[king_sq]:
            if sq[block]: continue
            piece = sq[pos]
            if piece * side < 0 and (piece == N or piece == -N): return True
        c = COL_OF[king_sq]
        if red:
            if king_sq >= COLS and sq[king_sq - COLS] == -P: return True
            if c > 0 and sq[king_sq - 1] == -P: return True
            if c + 1 < COLS and sq[king_sq + 1] == -P: return True
        else:
            if king_sq + COLS < BOARD_SIZE and sq[king_sq + COLS] == P: return True
            if c > 0 and sq[king_sq - 1] == P: return True
            if c + 1 < COLS and sq[king_sq + 1] == P: return True
        return False

    def gen_pseudo(self):
        sq = self.sq; side = 1 if self.red_turn else -1
        bsteps = BISHOP_RED if side > 0 else BISHOP_BLACK
        asteps = ADVISOR_RED if side > 0 else ADVISOR_BLACK
        ksteps = KING_RED if side > 0 else KING_BLACK
        psteps = PAWN_RED if side > 0 else PAWN_BLACK
        moves = []; append = moves.append
        for fr in range(BOARD_SIZE):
            piece = sq[fr]
            if piece * side <= 0: continue
            pt = piece if piece > 0 else -piece
            base = fr * MOVE_STRIDE
            if pt == R:
                for ray in RAYS[fr]:
                    for to in ray:
                        t = sq[to]
                        if not t: append(base + to); continue
                        if t * side < 0: append(base + to)
                        break
            elif pt == C:
                for ray in RAYS[fr]:
                    jumped = False
                    for to in ray:
                        t = sq[to]
                        if not jumped:
                            if not t: append(base + to); continue
                            jumped = True
                        elif t:
                            if t * side < 0: append(base + to)
                            break
            elif pt == N:
                for block, to in KNIGHT_MOVES[fr]:
                    if sq[block]: continue
                    if sq[to] * side <= 0: append(base + to)
            elif pt == B:
                for block, to in bsteps[fr]:
                    if not sq[block] and sq[to] * side <= 0: append(base + to)
            elif pt == A:
                for to in asteps[fr]:
                    if sq[to] * side <= 0: append(base + to)
            elif pt == K:
                for to in ksteps[fr]:
                    if sq[to] * side <= 0: append(base + to)
            else:
                for to in psteps[fr]:
                    if sq[to] * side <= 0: append(base + to)
        return moves

    def gen_captures(self):
        sq = self.sq; side = 1 if self.red_turn else -1
        bsteps = BISHOP_RED if side > 0 else BISHOP_BLACK
        asteps = ADVISOR_RED if side > 0 else ADVISOR_BLACK
        ksteps = KING_RED if side > 0 else KING_BLACK
        psteps = PAWN_RED if side > 0 else PAWN_BLACK
        moves = []; append = moves.append
        for fr in range(BOARD_SIZE):
            piece = sq[fr]
            if piece * side <= 0: continue
            pt = piece if piece > 0 else -piece
            base = fr * MOVE_STRIDE
            if pt == R:
                for ray in RAYS[fr]:
                    for to in ray:
                        t = sq[to]
                        if not t: continue
                        if t * side < 0: append(base + to)
                        break
            elif pt == C:
                for ray in RAYS[fr]:
                    jumped = False
                    for to in ray:
                        t = sq[to]
                        if not jumped:
                            if t: jumped = True
                            continue
                        if t:
                            if t * side < 0: append(base + to)
                            break
            elif pt == N:
                for block, to in KNIGHT_MOVES[fr]:
                    if not sq[block] and sq[to] * side < 0: append(base + to)
            elif pt == B:
                for block, to in bsteps[fr]:
                    if not sq[block] and sq[to] * side < 0: append(base + to)
            elif pt == A:
                for to in asteps[fr]:
                    if sq[to] * side < 0: append(base + to)
            elif pt == K:
                for to in ksteps[fr]:
                    if sq[to] * side < 0: append(base + to)
            else:
                for to in psteps[fr]:
                    if sq[to] * side < 0: append(base + to)
        return moves

    def gen_legal(self):
        red = self.red_turn; legal = []
        for move in self.gen_pseudo():
            cap = self.make(move)
            if not self.in_check(red): legal.append(move)
            self.undo(move, cap)
        return legal


class ModelBoard(Board):
    __slots__ = Board.__slots__ + ("acc", "lin_score", "red_sum", "black_sum")

    def __init__(self):
        super().__init__()
        self.acc = [0.0] * MODEL_HIDDEN_SIZE
        self.lin_score = 0.0
        self.red_sum = [0.0] * MODEL_FACTOR_SIZE
        self.black_sum = [0.0] * MODEL_FACTOR_SIZE

    def load_fen(self, fen):
        super().load_fen(fen)
        acc = self.acc; red_sum = self.red_sum; black_sum = self.black_sum
        self.lin_score = 0.0
        for i in range(MODEL_HIDDEN_SIZE): acc[i] = MODEL_HIDDEN_BIAS[i]
        for i in range(MODEL_FACTOR_SIZE): red_sum[i] = 0.0; black_sum[i] = 0.0
        for sq_i, piece in enumerate(self.sq):
            if not piece: continue
            plane = piece + PIECE_OFFSET
            self.lin_score += MODEL_LIN_W[plane][sq_i]
            vec = MODEL_EMB[plane][sq_i]
            rv = MODEL_RED_FAC[plane][sq_i]
            bv = MODEL_BLACK_FAC[plane][sq_i]
            for i in range(MODEL_HIDDEN_SIZE): acc[i] += vec[i]
            for i in range(MODEL_FACTOR_SIZE): red_sum[i] += rv[i]; black_sum[i] += bv[i]

    def make(self, move):
        fr = move // MOVE_STRIDE
        to = move - fr * MOVE_STRIDE
        piece = self.sq[fr]; cap_p = self.sq[to]
        plane = piece + PIECE_OFFSET
        lin_from = MODEL_LIN_W[plane][fr]; lin_to = MODEL_LIN_W[plane][to]
        moved_from = MODEL_EMB[plane][fr]; moved_to = MODEL_EMB[plane][to]
        rf = MODEL_RED_FAC[plane][fr]; rt = MODEL_RED_FAC[plane][to]
        bf = MODEL_BLACK_FAC[plane][fr]; bt = MODEL_BLACK_FAC[plane][to]
        cap_lin = 0.0; cap_vec = cap_red = cap_black = None
        if cap_p:
            cp = cap_p + PIECE_OFFSET
            cap_lin = MODEL_LIN_W[cp][to]
            cap_vec = MODEL_EMB[cp][to]
            cap_red = MODEL_RED_FAC[cp][to]
            cap_black = MODEL_BLACK_FAC[cp][to]
        cap = super().make(move)
        self.lin_score += lin_to - lin_from - cap_lin
        acc = self.acc; rs = self.red_sum; bs = self.black_sum
        for i in range(MODEL_HIDDEN_SIZE):
            acc[i] += moved_to[i] - moved_from[i]
            if cap_vec is not None: acc[i] -= cap_vec[i]
        for i in range(MODEL_FACTOR_SIZE):
            rs[i] += rt[i] - rf[i]; bs[i] += bt[i] - bf[i]
            if cap_red is not None: rs[i] -= cap_red[i]; bs[i] -= cap_black[i]
        return cap

    def undo(self, move, cap):
        fr = move // MOVE_STRIDE
        to = move - fr * MOVE_STRIDE
        piece = self.sq[to]; plane = piece + PIECE_OFFSET
        lin_from = MODEL_LIN_W[plane][fr]; lin_to = MODEL_LIN_W[plane][to]
        moved_from = MODEL_EMB[plane][fr]; moved_to = MODEL_EMB[plane][to]
        rf = MODEL_RED_FAC[plane][fr]; rt = MODEL_RED_FAC[plane][to]
        bf = MODEL_BLACK_FAC[plane][fr]; bt = MODEL_BLACK_FAC[plane][to]
        cap_lin = 0.0; cap_vec = cap_red = cap_black = None
        if cap:
            cp = cap + PIECE_OFFSET
            cap_lin = MODEL_LIN_W[cp][to]
            cap_vec = MODEL_EMB[cp][to]
            cap_red = MODEL_RED_FAC[cp][to]
            cap_black = MODEL_BLACK_FAC[cp][to]
        super().undo(move, cap)
        self.lin_score += lin_from - lin_to + cap_lin
        acc = self.acc; rs = self.red_sum; bs = self.black_sum
        for i in range(MODEL_HIDDEN_SIZE):
            acc[i] += moved_from[i] - moved_to[i]
            if cap_vec is not None: acc[i] += cap_vec[i]
        for i in range(MODEL_FACTOR_SIZE):
            rs[i] += rf[i] - rt[i]; bs[i] += bf[i] - bt[i]
            if cap_red is not None: rs[i] += cap_red[i]; bs[i] += cap_black[i]

    def eval(self):
        base = self.score if self.red_turn else -self.score
        phase = (self.red_phase + self.black_phase) * MODEL_PHASE_INV
        side = 0 if self.red_turn else 1
        rk = MODEL_RED_BUCKET[self.red_king] if self.red_king >= 0 else 4
        bk = MODEL_BLACK_BUCKET[self.black_king] if self.black_king >= 0 else 4
        corr = self.lin_score + MODEL_LIN_TEMPO[side]
        corr += MODEL_OUT_BIAS + phase * MODEL_PHASE_OUT
        corr += MODEL_KING_PAIR_BIAS[rk][bk]
        acc = self.acc; tempo = MODEL_TEMPO[side]
        rb = MODEL_RED_KING_BIAS[rk]; bb = MODEL_BLACK_KING_BIAS[bk]
        for i in range(MODEL_HIDDEN_SIZE):
            x = acc[i] + tempo[i] + phase * MODEL_PHASE_VECTOR[i] + rb[i] + bb[i]
            if x <= 0.0: continue
            if x > MODEL_ACT_CLIP: x = MODEL_ACT_CLIP
            corr += MODEL_OUT_W[i] * x
        rs = self.red_sum; bss = self.black_sum
        rv = MODEL_RED_KING_VEC[rk]; bv = MODEL_BLACK_KING_VEC[bk]
        for i in range(MODEL_FACTOR_SIZE):
            corr += rs[i] * rv[i] + bss[i] * bv[i]
        if corr > MODEL_MAX_CORRECTION: corr = MODEL_MAX_CORRECTION
        elif corr < -MODEL_MAX_CORRECTION: corr = -MODEL_MAX_CORRECTION
        # Add king safety on top of NN
        ra, rbb = min(self.red_advisors, 2), min(self.red_bishops, 2)
        ba, bbb = min(self.black_advisors, 2), min(self.black_bishops, 2)
        ks = KING_SAFETY[ra][rbb] - KING_SAFETY[ba][bbb]
        if not self.red_turn: ks = -ks
        return int(round(base + corr)) + ks


# ============================================================
# Search engine
# ============================================================

class Engine:
    def __init__(self):
        self.board = ModelBoard()
        self.board.load_fen(START_FEN)
        self.nodes = 0
        self.hard_stop = 0.0
        self.start_time = 0.0
        self.stopped = False
        self.best_root = NO_MOVE
        self.history = [0] * (BOARD_SIZE * BOARD_SIZE)
        self.killers = [[NO_MOVE, NO_MOVE] for _ in range(MAX_PLY)]
        self.countermoves = [NO_MOVE] * (BOARD_SIZE * BOARD_SIZE)
        self.tt = {}
        self.eval_stack = [0] * MAX_PLY
        self.pos_history = set()

    def new_game(self):
        self.tt.clear()
        h = self.history
        for i in range(len(h)): h[i] = 0
        for k in self.killers: k[0] = NO_MOVE; k[1] = NO_MOVE
        cm = self.countermoves
        for i in range(len(cm)): cm[i] = NO_MOVE
        self.pos_history = set()

    def _policy_bucket(self):
        pt = self.board.red_phase + self.board.black_phase
        if pt >= 27: return 0
        if pt >= 14: return 1
        return 2

    def think(self, wtime, btime, winc, binc, movetime=None, max_depth=64):
        my_time = wtime if self.board.red_turn else btime
        my_inc = winc if self.board.red_turn else binc
        if movetime is not None:
            soft = max(10.0, float(movetime)); hard = soft
        else:
            soft = my_time / 25.0 + my_inc * 0.75
            hard = min(my_time * 0.4, soft * 5)
            soft = min(soft, my_time * 0.25)
            soft = max(soft, 50.0); hard = max(hard, 100.0)
        now = _perf_counter()
        self.start_time = now
        soft_stop = now + soft / 1000.0
        self.hard_stop = now + hard / 1000.0
        self.stopped = False; self.nodes = 0; self.best_root = NO_MOVE
        h = self.history
        for i in range(len(h)): h[i] >>= 3
        best = NO_MOVE; score = 0; prev_score = 0
        for depth in range(1, max_depth + 1):
            window = 20 if depth >= 5 else INF
            alpha = -INF if depth < 5 else max(-INF, score - window)
            beta = INF if depth < 5 else min(INF, score + window)
            while True:
                self.best_root = best
                score_now = self._search(depth, alpha, beta, 0, True, NO_MOVE)
                if self.stopped and depth > 1:
                    return best if best != NO_MOVE else self.best_root
                if depth < 5 or alpha == -INF or beta == INF:
                    score = score_now; break
                if score_now <= alpha:
                    alpha = max(-INF, alpha - window); window *= 2; continue
                if score_now >= beta:
                    beta = min(INF, beta + window); window *= 2; continue
                score = score_now; break
            if self.best_root != NO_MOVE: best = self.best_root
            elapsed_ms = int((_perf_counter() - self.start_time) * 1000)
            _out(f"info depth {depth} score cp {score} nodes {self.nodes} time {elapsed_ms} pv {_m2uci(best)}")
            if abs(score) > MATE - MAX_PLY: break
            if depth >= 5 and prev_score - score > 25:
                ns = min(self.hard_stop, self.start_time + (_perf_counter() - self.start_time) * 1.5)
                if ns > soft_stop: soft_stop = ns
            if _perf_counter() > soft_stop: break
            prev_score = score
        # Validate move
        legal = self.board.gen_legal()
        if best in legal: return best
        return legal[0] if legal else NO_MOVE

    def _search(self, depth, alpha, beta, ply, allow_null, prev_move):
        board = self.board
        self.nodes += 1
        if self.nodes & 2047 == 0:
            if _perf_counter() > self.hard_stop:
                self.stopped = True; return 0
        if ply >= MAX_PLY - 1: return board.eval()
        red = board.red_turn
        in_check = board.in_check(red)
        if in_check: depth += 1
        if depth <= 0: return self._qs(alpha, beta, ply, 0)
        key = board.hash
        if ply > 0 and key in self.pos_history: return 0
        orig_alpha = alpha
        tt = self.tt; tt_entry = tt.get(key); tt_move = NO_MOVE
        if tt_entry is not None:
            td, tf, ts, tm = tt_entry
            ts = _score_from_tt(ts, ply)
            tt_move = tm
            if td >= depth:
                if tf == TT_EXACT: return ts
                if tf == TT_LOWER:
                    if ts >= beta: return ts
                    if ts > alpha: alpha = ts
                else:
                    if ts <= alpha: return ts
                    if ts < beta: beta = ts
                if alpha >= beta: return ts
        static_eval = board.eval()
        es = self.eval_stack; es[ply] = static_eval
        improving = ply >= 2 and static_eval > es[ply - 2]
        if not in_check:
            if depth <= 8:
                margin = RFP_MARGIN[depth] + (0 if improving else 50)
                if static_eval - margin >= beta: return static_eval
            if depth <= 3 and static_eval + 250 + 200 * depth <= alpha:
                sc = self._qs(alpha, beta, ply, 0)
                if sc <= alpha: return sc
            if allow_null and depth >= 3 and (board.red_phase > 0 if red else board.black_phase > 0):
                rn = 3 + depth // 4
                if static_eval >= beta: rn += min(3, (static_eval - beta) // 200)
                board.red_turn = not board.red_turn; board.hash ^= SIDE_KEY
                sc = -self._search(depth - 1 - rn, -beta, -beta + 1, ply + 1, False, NO_MOVE)
                board.red_turn = not board.red_turn; board.hash ^= SIDE_KEY
                if self.stopped: return 0
                if sc >= beta: return beta
        search_depth = depth
        if depth >= 3 and tt_move == NO_MOVE: search_depth -= 1
        sq = board.sq; moves = board.gen_pseudo(); n_moves = len(moves)
        history = self.history
        kp = self.killers[ply]; k0 = kp[0]; k1 = kp[1]
        cm = self.countermoves[prev_move] if prev_move >= 0 else NO_MOVE
        # Policy-enhanced inline move scoring
        pbucket = self._policy_bucket()
        pp_table = MODEL_POLICY_PIECE[pbucket]
        pt_table = MODEL_POLICY_TO[pbucket]
        scores = [0] * n_moves
        for i in range(n_moves):
            m = moves[i]
            if m == tt_move: scores[i] = 2_000_000; continue
            fr = m // MOVE_STRIDE; to = m % MOVE_STRIDE
            piece = sq[fr]; pt_p = piece if piece > 0 else -piece
            norm_to = to if piece > 0 else MODEL_NORM_BLACK[to]
            prior = pp_table[pt_p] + pt_table[pt_p][norm_to]
            cap_piece = sq[to]
            if cap_piece:
                att = piece
                scores[i] = 1_000_000 + MAT[cap_piece if cap_piece > 0 else -cap_piece] * 16 - MAT[att if att > 0 else -att] + prior // 16
            elif m == k0: scores[i] = 900_000 + prior // 4
            elif m == k1: scores[i] = 800_000 + prior // 4
            elif m == cm: scores[i] = 700_000 + prior // 4
            else: scores[i] = history[m] + prior // 4
        best_move = tt_move; best_score = -INF; legal = 0; searched = 0
        for i in range(n_moves):
            bi = i; bs = scores[i]
            for j in range(i + 1, n_moves):
                if scores[j] > bs: bs = scores[j]; bi = j
            if bi != i:
                moves[i], moves[bi] = moves[bi], moves[i]
                scores[i], scores[bi] = scores[bi], scores[i]
            move = moves[i]
            cap = board.make(move)
            if board.in_check(red): board.undo(move, cap); continue
            legal += 1; is_quiet = not cap
            if is_quiet and not in_check and best_score > -MATE + MAX_PLY:
                if search_depth <= 7:
                    thr = LMP_THRESHOLD[search_depth] + (4 if improving else 0)
                    if searched >= thr: board.undo(move, cap); continue
                if search_depth <= 8:
                    mg = FUTILITY_MARGIN[search_depth] + (80 if improving else 0)
                    if static_eval + mg <= alpha: board.undo(move, cap); continue
                if search_depth <= 5 and searched >= 3:
                    if history[move] < -(search_depth * search_depth * 64):
                        board.undo(move, cap); continue
            searched += 1
            if searched == 1:
                sc = -self._search(search_depth - 1, -beta, -alpha, ply + 1, True, move)
            else:
                reduction = 0
                if is_quiet and search_depth >= 3 and searched >= 3 and not in_check:
                    reduction = LMR_TABLE[min(search_depth, 63)][min(searched, 63)]
                    if not improving: reduction += 1
                    if move == k0 or move == k1: reduction -= 1
                    if move == cm: reduction -= 1
                    reduction = max(0, min(reduction, search_depth - 2))
                sc = -self._search(search_depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, True, move)
                if reduction > 0 and sc > alpha:
                    sc = -self._search(search_depth - 1, -alpha - 1, -alpha, ply + 1, True, move)
                if sc > alpha and sc < beta:
                    sc = -self._search(search_depth - 1, -beta, -alpha, ply + 1, True, move)
            board.undo(move, cap)
            if self.stopped: return 0
            if sc > best_score: best_score = sc
            if sc > alpha:
                alpha = sc; best_move = move
                if ply == 0: self.best_root = move
                if alpha >= beta:
                    if is_quiet:
                        if move != k0: kp[1] = k0; kp[0] = move
                        history[move] += depth * depth
                        if prev_move >= 0: self.countermoves[prev_move] = move
                    if len(tt) > 800000: tt.clear()
                    tt[key] = (depth, TT_LOWER, _score_to_tt(alpha, ply), move)
                    return alpha
        if not legal: return -MATE + ply
        flag = TT_UPPER if best_score <= orig_alpha else TT_EXACT
        if len(tt) > 800000: tt.clear()
        old = tt.get(key)
        if old is None or depth >= old[0]:
            tt[key] = (depth, flag, _score_to_tt(best_score, ply), best_move)
        return best_score

    def _qs(self, alpha, beta, ply, qs_ply):
        board = self.board; self.nodes += 1
        if self.nodes & 2047 == 0:
            if _perf_counter() > self.hard_stop: self.stopped = True; return 0
        red = board.red_turn
        if board.in_check(red): return self._qs_evasion(alpha, beta, ply, qs_ply)
        stand_pat = board.eval()
        if stand_pat >= beta: return beta
        if stand_pat > alpha: alpha = stand_pat
        if ply >= MAX_PLY - 1 or qs_ply >= MAX_QS_PLY: return alpha
        if stand_pat + 800 < alpha: return alpha
        sq = board.sq; captures = board.gen_captures()
        n_cap = len(captures)
        cap_scores = [0] * n_cap
        for i in range(n_cap):
            m = captures[i]; to = m % MOVE_STRIDE; fr = m // MOVE_STRIDE
            v = sq[to]; a = sq[fr]
            cap_scores[i] = MAT[v if v > 0 else -v] * 16 - MAT[a if a > 0 else -a]
        for i in range(n_cap):
            bi = i; bs = cap_scores[i]
            for j in range(i + 1, n_cap):
                if cap_scores[j] > bs: bs = cap_scores[j]; bi = j
            if bi != i:
                captures[i], captures[bi] = captures[bi], captures[i]
                cap_scores[i], cap_scores[bi] = cap_scores[bi], cap_scores[i]
            move = captures[i]; to = move % MOVE_STRIDE; victim = sq[to]
            if stand_pat + MAT[victim if victim > 0 else -victim] + 100 < alpha: continue
            if cap_scores[i] < -200 and stand_pat < alpha + 50: continue
            cap = board.make(move)
            if board.in_check(red): board.undo(move, cap); continue
            sc = -self._qs(-beta, -alpha, ply + 1, qs_ply + 1)
            board.undo(move, cap)
            if self.stopped: return 0
            if sc >= beta: return beta
            if sc > alpha: alpha = sc
        return alpha

    def _qs_evasion(self, alpha, beta, ply, qs_ply):
        if ply >= MAX_PLY - 1: return self.board.eval()
        board = self.board; red = board.red_turn
        best_score = -INF; legal = 0
        for move in board.gen_pseudo():
            cap = board.make(move)
            if board.in_check(red): board.undo(move, cap); continue
            legal += 1
            sc = -self._qs(-beta, -alpha, ply + 1, qs_ply + 1)
            board.undo(move, cap)
            if self.stopped: return 0
            if sc > best_score: best_score = sc
            if sc >= beta: return beta
            if sc > alpha: alpha = sc
        if not legal: return -MATE + ply
        return best_score


def _m2uci(move):
    if move == NO_MOVE: return "0000"
    fr = move // MOVE_STRIDE; to = move - fr * MOVE_STRIDE
    return chr(97 + COL_OF[fr]) + str(9 - ROW_OF[fr]) + chr(97 + COL_OF[to]) + str(9 - ROW_OF[to])

def _uci2m(s):
    fc = ord(s[0]) - 97; fr = 9 - int(s[1])
    tc = ord(s[2]) - 97; tr = 9 - int(s[3])
    return (fr * COLS + fc) * MOVE_STRIDE + (tr * COLS + tc)

def _out(s):
    print(s, flush=True)

def main():
    engine = Engine()
    while True:
        try: line = input()
        except EOFError: break
        line = line.strip()
        if not line: continue
        if line == "uci":
            _out("id name SmartPy-Pro-NN")
            _out("id author Codex")
            _out("uciok")
        elif line == "isready":
            _out("readyok")
        elif line == "ucinewgame":
            engine.new_game(); engine.board.load_fen(START_FEN)
        elif line.startswith("position"):
            tokens = line.split()
            if "fen" in tokens:
                idx = tokens.index("fen")
                end = tokens.index("moves") if "moves" in tokens else len(tokens)
                engine.board.load_fen(" ".join(tokens[idx + 1 : end]))
            elif "startpos" in tokens:
                engine.board.load_fen(START_FEN)
            engine.pos_history = set()
            if "moves" in tokens:
                idx = tokens.index("moves")
                for ms in tokens[idx + 1 :]:
                    engine.pos_history.add(engine.board.hash)
                    engine.board.make(_uci2m(ms))
        elif line.startswith("go"):
            tokens = line.split()
            wtime = btime = 60000; winc = binc = 0
            movetime = None; depth_limit = 64
            for i, token in enumerate(tokens):
                if token == "wtime": wtime = int(tokens[i + 1])
                elif token == "btime": btime = int(tokens[i + 1])
                elif token == "winc": winc = int(tokens[i + 1])
                elif token == "binc": binc = int(tokens[i + 1])
                elif token == "movetime": movetime = int(tokens[i + 1])
                elif token == "depth": depth_limit = int(tokens[i + 1])
            best = engine.think(wtime, btime, winc, binc, movetime, depth_limit)
            if best == NO_MOVE:
                moves = engine.board.gen_legal()
                best = moves[0] if moves else NO_MOVE
            _out(f"bestmove {_m2uci(best)}")
        elif line == "quit":
            break

if __name__ == "__main__":
    main()
'''

    with open(OUTPUT_PATH, "w") as f:
        f.write(engine_code)

    size_kb = os.path.getsize(OUTPUT_PATH) // 1024
    print(f"Built {OUTPUT_PATH} ({size_kb}KB)")


if __name__ == "__main__":
    build()
