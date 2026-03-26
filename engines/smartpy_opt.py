#!/usr/bin/env python3
"""SmartPy-Opt: a compact Xiangqi UCI engine with an optimized Python search core."""

import random
import time

ROWS, COLS = 10, 9
BOARD_SIZE = ROWS * COLS
MOVE_STRIDE = BOARD_SIZE

# Material values
MAT = (0, 10000, 120, 120, 480, 1000, 510, 80)

START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

EMPTY = 0
K, A, B, N, R, C, P = 1, 2, 3, 4, 5, 6, 7
NO_MOVE = -1
PIECE_OFFSET = 7

INF = 32000
MATE = 30000
MAX_PLY = 96

TT_EXACT = 0
TT_LOWER = 1
TT_UPPER = 2

# For null-move pruning, only care whether a side still has non-pawn material.
PHASE = (0, 0, 1, 1, 2, 4, 2, 0)

PIECE_FROM_CHAR = {
    "K": K,
    "A": A,
    "B": B,
    "N": N,
    "R": R,
    "C": C,
    "P": P,
    "k": -K,
    "a": -A,
    "b": -B,
    "n": -N,
    "r": -R,
    "c": -C,
    "p": -P,
}

# fmt: off
# Piece-square tables: indexed [normalized_row][col], row 0 = own back rank
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

ROW_OF = tuple(i // COLS for i in range(BOARD_SIZE))
COL_OF = tuple(i % COLS for i in range(BOARD_SIZE))

HORSE_STEPS = (
    (-1, 0, -2, -1),
    (-1, 0, -2, 1),
    (1, 0, 2, -1),
    (1, 0, 2, 1),
    (0, -1, -1, -2),
    (0, -1, 1, -2),
    (0, 1, -1, 2),
    (0, 1, 1, 2),
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
    if pt == N:
        return PST_KNIGHT[nr][c]
    if pt == R:
        return PST_ROOK[nr][c]
    if pt == C:
        return PST_CANNON[nr][c]
    if pt == P:
        return PST_PAWN[nr][c]
    if pt == A:
        return 8 if c == 4 else 0
    if pt == B:
        return 5
    return 0


PSQ = [[0] * BOARD_SIZE for _ in range(15)]
for sq in range(BOARD_SIZE):
    r = ROW_OF[sq]
    c = COL_OF[sq]
    red_nr = 9 - r
    black_nr = r
    for pt in range(1, 8):
        PSQ[pt + PIECE_OFFSET][sq] = MAT[pt] + _bonus(pt, red_nr, c)
        PSQ[-pt + PIECE_OFFSET][sq] = -(MAT[pt] + _bonus(pt, black_nr, c))


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

for sq in range(BOARD_SIZE):
    r = ROW_OF[sq]
    c = COL_OF[sq]

    RAYS.append(
        (
            tuple(r * COLS + cc for cc in range(c + 1, COLS)),
            tuple(r * COLS + cc for cc in range(c - 1, -1, -1)),
            tuple(rr * COLS + c for rr in range(r + 1, ROWS)),
            tuple(rr * COLS + c for rr in range(r - 1, -1, -1)),
        )
    )

    knight = []
    for br, bc, tr, tc in HORSE_STEPS:
        block_r = r + br
        block_c = c + bc
        dest_r = r + tr
        dest_c = c + tc
        if _in_bounds(block_r, block_c) and _in_bounds(dest_r, dest_c):
            knight.append((block_r * COLS + block_c, dest_r * COLS + dest_c))
    KNIGHT_MOVES.append(tuple(knight))

    bishop_red = []
    bishop_black = []
    for mr, mc, tr, tc in ELEPHANT_STEPS:
        mid_r = r + mr
        mid_c = c + mc
        dest_r = r + tr
        dest_c = c + tc
        if not (_in_bounds(mid_r, mid_c) and _in_bounds(dest_r, dest_c)):
            continue
        step = (mid_r * COLS + mid_c, dest_r * COLS + dest_c)
        if _on_own_side(dest_r, True):
            bishop_red.append(step)
        if _on_own_side(dest_r, False):
            bishop_black.append(step)
    BISHOP_RED.append(tuple(bishop_red))
    BISHOP_BLACK.append(tuple(bishop_black))

    advisor_red = []
    advisor_black = []
    king_red = []
    king_black = []
    for dr, dc in DIAGONAL_1:
        nr = r + dr
        nc = c + dc
        if _in_bounds(nr, nc):
            if _in_palace(nr, nc, True):
                advisor_red.append(nr * COLS + nc)
            if _in_palace(nr, nc, False):
                advisor_black.append(nr * COLS + nc)
    for dr, dc in ORTHOGONAL_1:
        nr = r + dr
        nc = c + dc
        if _in_bounds(nr, nc):
            if _in_palace(nr, nc, True):
                king_red.append(nr * COLS + nc)
            if _in_palace(nr, nc, False):
                king_black.append(nr * COLS + nc)
    ADVISOR_RED.append(tuple(advisor_red))
    ADVISOR_BLACK.append(tuple(advisor_black))
    KING_RED.append(tuple(king_red))
    KING_BLACK.append(tuple(king_black))

    pawn_red = []
    pawn_black = []
    if r > 0:
        pawn_red.append((r - 1) * COLS + c)
    if r < ROWS - 1:
        pawn_black.append((r + 1) * COLS + c)
    if r <= 4:
        if c > 0:
            pawn_red.append(r * COLS + c - 1)
        if c < COLS - 1:
            pawn_red.append(r * COLS + c + 1)
    if r >= 5:
        if c > 0:
            pawn_black.append(r * COLS + c - 1)
        if c < COLS - 1:
            pawn_black.append(r * COLS + c + 1)
    PAWN_RED.append(tuple(pawn_red))
    PAWN_BLACK.append(tuple(pawn_black))

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


_rng = random.Random(0)
ZOBRIST = [[0] * BOARD_SIZE for _ in range(15)]
for piece_idx in range(15):
    if piece_idx == PIECE_OFFSET:
        continue
    row = ZOBRIST[piece_idx]
    for sq in range(BOARD_SIZE):
        row[sq] = _rng.getrandbits(64)
SIDE_KEY = _rng.getrandbits(64)


class Board:
    __slots__ = (
        "sq",
        "red_turn",
        "red_king",
        "black_king",
        "score",
        "hash",
        "red_phase",
        "black_phase",
    )

    def __init__(self):
        self.sq = [EMPTY] * BOARD_SIZE
        self.red_turn = True
        self.red_king = -1
        self.black_king = -1
        self.score = 0
        self.hash = 0
        self.red_phase = 0
        self.black_phase = 0

    def load_fen(self, fen):
        self.sq[:] = [EMPTY] * BOARD_SIZE
        self.red_king = -1
        self.black_king = -1
        self.score = 0
        self.hash = 0
        self.red_phase = 0
        self.black_phase = 0

        parts = fen.split()
        rows = parts[0].split("/")
        for r, row_s in enumerate(rows):
            c = 0
            for ch in row_s:
                if ch.isdigit():
                    c += int(ch)
                    continue
                piece = PIECE_FROM_CHAR[ch]
                sq = r * COLS + c
                self.sq[sq] = piece
                self.score += PSQ[piece + PIECE_OFFSET][sq]
                self.hash ^= ZOBRIST[piece + PIECE_OFFSET][sq]
                pt = piece if piece > 0 else -piece
                if piece > 0:
                    self.red_phase += PHASE[pt]
                else:
                    self.black_phase += PHASE[pt]
                if piece == K:
                    self.red_king = sq
                elif piece == -K:
                    self.black_king = sq
                c += 1

        self.red_turn = len(parts) <= 1 or parts[1] == "w"
        if not self.red_turn:
            self.hash ^= SIDE_KEY

    def eval(self):
        return self.score if self.red_turn else -self.score

    def has_non_pawn_material(self, red):
        return self.red_phase > 0 if red else self.black_phase > 0

    def make_null(self):
        self.red_turn = not self.red_turn
        self.hash ^= SIDE_KEY

    def undo_null(self):
        self.red_turn = not self.red_turn
        self.hash ^= SIDE_KEY

    def make(self, move):
        fr = move // MOVE_STRIDE
        to = move - fr * MOVE_STRIDE
        sq = self.sq
        piece = sq[fr]
        cap = sq[to]

        self.hash ^= ZOBRIST[piece + PIECE_OFFSET][fr]
        self.hash ^= ZOBRIST[piece + PIECE_OFFSET][to]
        if cap:
            self.hash ^= ZOBRIST[cap + PIECE_OFFSET][to]
        self.hash ^= SIDE_KEY

        self.score -= PSQ[piece + PIECE_OFFSET][fr]
        self.score += PSQ[piece + PIECE_OFFSET][to]
        if cap:
            self.score -= PSQ[cap + PIECE_OFFSET][to]
            pt = cap if cap > 0 else -cap
            if cap > 0:
                self.red_phase -= PHASE[pt]
            else:
                self.black_phase -= PHASE[pt]

        sq[to] = piece
        sq[fr] = EMPTY

        if piece == K:
            self.red_king = to
        elif piece == -K:
            self.black_king = to
        if cap == K:
            self.red_king = -1
        elif cap == -K:
            self.black_king = -1

        self.red_turn = not self.red_turn
        return cap

    def undo(self, move, cap):
        fr = move // MOVE_STRIDE
        to = move - fr * MOVE_STRIDE
        sq = self.sq
        piece = sq[to]

        self.red_turn = not self.red_turn
        self.hash ^= SIDE_KEY
        self.hash ^= ZOBRIST[piece + PIECE_OFFSET][to]
        self.hash ^= ZOBRIST[piece + PIECE_OFFSET][fr]
        if cap:
            self.hash ^= ZOBRIST[cap + PIECE_OFFSET][to]

        self.score -= PSQ[piece + PIECE_OFFSET][to]
        self.score += PSQ[piece + PIECE_OFFSET][fr]
        if cap:
            self.score += PSQ[cap + PIECE_OFFSET][to]
            pt = cap if cap > 0 else -cap
            if cap > 0:
                self.red_phase += PHASE[pt]
            else:
                self.black_phase += PHASE[pt]

        sq[fr] = piece
        sq[to] = cap

        if piece == K:
            self.red_king = fr
        elif piece == -K:
            self.black_king = fr
        if cap == K:
            self.red_king = to
        elif cap == -K:
            self.black_king = to

    def in_check(self, red):
        king_sq = self.red_king if red else self.black_king
        if king_sq < 0:
            return True

        sq = self.sq
        side = 1 if red else -1

        for ray in RAYS[king_sq]:
            found = 0
            for pos in ray:
                piece = sq[pos]
                if not piece:
                    continue
                if found == 0:
                    if piece * side < 0:
                        pt = piece if piece > 0 else -piece
                        if pt == R or pt == K:
                            return True
                    found = 1
                else:
                    if piece * side < 0 and (piece == C or piece == -C):
                        return True
                    break

        for block, pos in KNIGHT_MOVES[king_sq]:
            if sq[block]:
                continue
            piece = sq[pos]
            if piece * side < 0 and (piece == N or piece == -N):
                return True

        c = COL_OF[king_sq]
        if red:
            if king_sq >= COLS and sq[king_sq - COLS] == -P:
                return True
            if c > 0 and sq[king_sq - 1] == -P:
                return True
            if c + 1 < COLS and sq[king_sq + 1] == -P:
                return True
        else:
            if king_sq + COLS < BOARD_SIZE and sq[king_sq + COLS] == P:
                return True
            if c > 0 and sq[king_sq - 1] == P:
                return True
            if c + 1 < COLS and sq[king_sq + 1] == P:
                return True

        return False

    def gen_pseudo(self):
        sq = self.sq
        side = 1 if self.red_turn else -1
        bishop_steps = BISHOP_RED if side > 0 else BISHOP_BLACK
        advisor_steps = ADVISOR_RED if side > 0 else ADVISOR_BLACK
        king_steps = KING_RED if side > 0 else KING_BLACK
        pawn_steps = PAWN_RED if side > 0 else PAWN_BLACK

        moves = []
        append = moves.append

        for fr, piece in enumerate(sq):
            if piece * side <= 0:
                continue

            pt = piece if piece > 0 else -piece
            base = fr * MOVE_STRIDE

            if pt == R:
                for ray in RAYS[fr]:
                    for to in ray:
                        target = sq[to]
                        if not target:
                            append(base + to)
                            continue
                        if target * side < 0:
                            append(base + to)
                        break
            elif pt == C:
                for ray in RAYS[fr]:
                    jumped = False
                    for to in ray:
                        target = sq[to]
                        if not jumped:
                            if not target:
                                append(base + to)
                                continue
                            jumped = True
                        elif target:
                            if target * side < 0:
                                append(base + to)
                            break
            elif pt == N:
                for block, to in KNIGHT_MOVES[fr]:
                    if sq[block]:
                        continue
                    if sq[to] * side <= 0:
                        append(base + to)
            elif pt == B:
                for block, to in bishop_steps[fr]:
                    if not sq[block] and sq[to] * side <= 0:
                        append(base + to)
            elif pt == A:
                for to in advisor_steps[fr]:
                    if sq[to] * side <= 0:
                        append(base + to)
            elif pt == K:
                for to in king_steps[fr]:
                    if sq[to] * side <= 0:
                        append(base + to)
            else:
                for to in pawn_steps[fr]:
                    if sq[to] * side <= 0:
                        append(base + to)

        return moves

    def gen_captures(self):
        sq = self.sq
        side = 1 if self.red_turn else -1
        bishop_steps = BISHOP_RED if side > 0 else BISHOP_BLACK
        advisor_steps = ADVISOR_RED if side > 0 else ADVISOR_BLACK
        king_steps = KING_RED if side > 0 else KING_BLACK
        pawn_steps = PAWN_RED if side > 0 else PAWN_BLACK

        moves = []
        append = moves.append

        for fr, piece in enumerate(sq):
            if piece * side <= 0:
                continue

            pt = piece if piece > 0 else -piece
            base = fr * MOVE_STRIDE

            if pt == R:
                for ray in RAYS[fr]:
                    for to in ray:
                        target = sq[to]
                        if not target:
                            continue
                        if target * side < 0:
                            append(base + to)
                        break
            elif pt == C:
                for ray in RAYS[fr]:
                    jumped = False
                    for to in ray:
                        target = sq[to]
                        if not jumped:
                            if target:
                                jumped = True
                            continue
                        if target:
                            if target * side < 0:
                                append(base + to)
                            break
            elif pt == N:
                for block, to in KNIGHT_MOVES[fr]:
                    if not sq[block] and sq[to] * side < 0:
                        append(base + to)
            elif pt == B:
                for block, to in bishop_steps[fr]:
                    if not sq[block] and sq[to] * side < 0:
                        append(base + to)
            elif pt == A:
                for to in advisor_steps[fr]:
                    if sq[to] * side < 0:
                        append(base + to)
            elif pt == K:
                for to in king_steps[fr]:
                    if sq[to] * side < 0:
                        append(base + to)
            else:
                for to in pawn_steps[fr]:
                    if sq[to] * side < 0:
                        append(base + to)

        return moves

    def gen_legal(self):
        red = self.red_turn
        moves = []
        append = moves.append
        for move in self.gen_pseudo():
            cap = self.make(move)
            if not self.in_check(red):
                append(move)
            self.undo(move, cap)
        return moves


def _score_to_tt(score, ply):
    if score > MATE - MAX_PLY:
        return score + ply
    if score < -MATE + MAX_PLY:
        return score - ply
    return score


def _score_from_tt(score, ply):
    if score > MATE - MAX_PLY:
        return score - ply
    if score < -MATE + MAX_PLY:
        return score + ply
    return score


class Engine:
    def __init__(self):
        self.board = Board()
        self.board.load_fen(START_FEN)
        self.nodes = 0
        self.stop_time = 0.0
        self.start_time = 0.0
        self.stopped = False
        self.best_root = NO_MOVE
        self.history = [0] * (BOARD_SIZE * BOARD_SIZE)
        self.killers = [[NO_MOVE, NO_MOVE] for _ in range(MAX_PLY)]
        self.tt = {}

    def new_game(self):
        self.tt.clear()
        for i in range(len(self.history)):
            self.history[i] = 0
        for killers in self.killers:
            killers[0] = NO_MOVE
            killers[1] = NO_MOVE

    def think(self, wtime, btime, winc, binc, movetime=None, max_depth=64):
        my_time = wtime if self.board.red_turn else btime
        my_inc = winc if self.board.red_turn else binc

        if movetime is not None:
            alloc = max(10.0, float(movetime))
        else:
            alloc = my_time / 30.0 + my_inc * 0.8
            alloc = min(alloc, my_time * 0.9)
            alloc = max(alloc, 100.0)

        self.start_time = time.perf_counter()
        self.stop_time = self.start_time + alloc / 1000.0
        self.stopped = False
        self.nodes = 0
        self.best_root = NO_MOVE

        for i, v in enumerate(self.history):
            self.history[i] = v // 8

        best = NO_MOVE
        score = 0
        for depth in range(1, max_depth + 1):
            window = 24 if depth >= 4 else INF
            alpha = -INF if depth < 4 else max(-INF, score - window)
            beta = INF if depth < 4 else min(INF, score + window)

            while True:
                self.best_root = best
                score_now = self._search(depth, alpha, beta, 0, True)
                if self.stopped and depth > 1:
                    return best if best != NO_MOVE else self.best_root
                if depth < 4 or alpha == -INF or beta == INF:
                    score = score_now
                    break
                if score_now <= alpha:
                    alpha = max(-INF, alpha - window)
                    window *= 2
                    continue
                if score_now >= beta:
                    beta = min(INF, beta + window)
                    window *= 2
                    continue
                score = score_now
                break

            if self.best_root != NO_MOVE:
                best = self.best_root

            elapsed_ms = int((time.perf_counter() - self.start_time) * 1000)
            _out(
                f"info depth {depth} score cp {score} nodes {self.nodes} "
                f"time {elapsed_ms} pv {_m2uci(best)}"
            )

            if abs(score) > MATE - MAX_PLY:
                break

        return best

    def _store_tt(self, key, depth, flag, score, move, ply):
        if len(self.tt) > 400000:
            self.tt.clear()
        old = self.tt.get(key)
        if old is None or depth >= old[0]:
            self.tt[key] = (depth, flag, _score_to_tt(score, ply), move)

    def _move_order(self, move, ply, tt_move):
        if move == tt_move:
            return 2_000_000
        to = move % MOVE_STRIDE
        cap = self.board.sq[to]
        if cap:
            fr = move // MOVE_STRIDE
            attacker = self.board.sq[fr]
            return 1_000_000 + MAT[cap if cap > 0 else -cap] * 16 - MAT[attacker if attacker > 0 else -attacker]
        killers = self.killers[ply]
        if move == killers[0]:
            return 900_000
        if move == killers[1]:
            return 800_000
        return self.history[move]

    def _order_moves(self, moves, ply, tt_move):
        moves.sort(key=lambda move: self._move_order(move, ply, tt_move), reverse=True)
        return moves

    def _order_captures(self, moves):
        board_sq = self.board.sq
        moves.sort(
            key=lambda move: (
                MAT[(board_sq[move % MOVE_STRIDE] if board_sq[move % MOVE_STRIDE] > 0 else -board_sq[move % MOVE_STRIDE])]
                * 16
                - MAT[(board_sq[move // MOVE_STRIDE] if board_sq[move // MOVE_STRIDE] > 0 else -board_sq[move // MOVE_STRIDE])]
            ),
            reverse=True,
        )
        return moves

    def _search(self, depth, alpha, beta, ply, allow_null):
        self.nodes += 1
        if self.nodes & 2047 == 0 and time.perf_counter() > self.stop_time:
            self.stopped = True
            return 0

        if ply >= MAX_PLY - 1:
            return self.board.eval()

        board = self.board
        red = board.red_turn
        in_check = board.in_check(red)
        if in_check:
            depth += 1
        if depth <= 0:
            return self._qs(alpha, beta, ply)

        key = board.hash
        orig_alpha = alpha
        orig_beta = beta
        tt_entry = self.tt.get(key)
        tt_move = NO_MOVE
        if tt_entry is not None:
            tt_depth, tt_flag, tt_score, tt_move = tt_entry
            tt_score = _score_from_tt(tt_score, ply)
            if tt_depth >= depth:
                if tt_flag == TT_EXACT:
                    return tt_score
                if tt_flag == TT_LOWER:
                    if tt_score >= beta:
                        return tt_score
                    if tt_score > alpha:
                        alpha = tt_score
                else:
                    if tt_score <= alpha:
                        return tt_score
                    if tt_score < beta:
                        beta = tt_score
                if alpha >= beta:
                    return tt_score

        if (
            allow_null
            and depth >= 3
            and not in_check
            and board.has_non_pawn_material(red)
        ):
            reduction = 2 + depth // 6
            board.make_null()
            score = -self._search(depth - 1 - reduction, -beta, -beta + 1, ply + 1, False)
            board.undo_null()
            if self.stopped:
                return 0
            if score >= beta:
                return beta

        moves = self._order_moves(board.gen_pseudo(), ply, tt_move)
        best_move = tt_move
        legal = 0

        for idx, move in enumerate(moves):
            cap = board.make(move)
            if board.in_check(red):
                board.undo(move, cap)
                continue

            legal += 1
            if idx == 0:
                score = -self._search(depth - 1, -beta, -alpha, ply + 1, True)
            else:
                reduction = 0
                if depth >= 4 and legal >= 4 and not in_check and not cap:
                    reduction = 1
                score = -self._search(
                    depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, True
                )
                if reduction and score > alpha:
                    score = -self._search(depth - 1, -alpha - 1, -alpha, ply + 1, True)
                if score > alpha and score < beta:
                    score = -self._search(depth - 1, -beta, -alpha, ply + 1, True)

            board.undo(move, cap)
            if self.stopped:
                return 0

            if score > alpha:
                alpha = score
                best_move = move
                if ply == 0:
                    self.best_root = move
                if alpha >= beta:
                    if not cap:
                        killers = self.killers[ply]
                        if move != killers[0]:
                            killers[1] = killers[0]
                            killers[0] = move
                        self.history[move] += depth * depth
                    self._store_tt(key, depth, TT_LOWER, alpha, move, ply)
                    return alpha

        if not legal:
            return -MATE + ply if in_check else 0

        flag = TT_UPPER if alpha <= orig_alpha else TT_EXACT
        self._store_tt(key, depth, flag, alpha, best_move, ply)
        return alpha

    def _qs(self, alpha, beta, ply):
        self.nodes += 1
        if self.nodes & 2047 == 0 and time.perf_counter() > self.stop_time:
            self.stopped = True
            return 0

        stand_pat = self.board.eval()
        if stand_pat >= beta:
            return beta
        if stand_pat > alpha:
            alpha = stand_pat
        if ply >= MAX_PLY - 1:
            return alpha

        board = self.board
        red = board.red_turn

        captures = self._order_captures(board.gen_captures())
        for move in captures:
            to = move % MOVE_STRIDE
            victim = board.sq[to]
            if stand_pat + MAT[victim if victim > 0 else -victim] + 100 < alpha:
                continue

            cap = board.make(move)
            if board.in_check(red):
                board.undo(move, cap)
                continue

            score = -self._qs(-beta, -alpha, ply + 1)
            board.undo(move, cap)
            if self.stopped:
                return 0
            if score >= beta:
                return beta
            if score > alpha:
                alpha = score

        return alpha


def _m2uci(move):
    if move == NO_MOVE:
        return "0000"
    fr = move // MOVE_STRIDE
    to = move - fr * MOVE_STRIDE
    fr_r = ROW_OF[fr]
    fr_c = COL_OF[fr]
    to_r = ROW_OF[to]
    to_c = COL_OF[to]
    return f"{chr(97 + fr_c)}{9 - fr_r}{chr(97 + to_c)}{9 - to_r}"


def _uci2m(s):
    fc = ord(s[0]) - 97
    fr = 9 - int(s[1])
    tc = ord(s[2]) - 97
    tr = 9 - int(s[3])
    return (fr * COLS + fc) * MOVE_STRIDE + (tr * COLS + tc)


def _out(s):
    print(s, flush=True)


def main():
    engine = Engine()

    while True:
        try:
            line = input()
        except EOFError:
            break

        line = line.strip()
        if not line:
            continue

        if line == "uci":
            _out("id name SmartPy-Opt")
            _out("id author Codex")
            _out("uciok")

        elif line == "isready":
            _out("readyok")

        elif line == "ucinewgame":
            engine.new_game()
            engine.board.load_fen(START_FEN)

        elif line.startswith("position"):
            tokens = line.split()
            if "fen" in tokens:
                idx = tokens.index("fen")
                end = tokens.index("moves") if "moves" in tokens else len(tokens)
                engine.board.load_fen(" ".join(tokens[idx + 1 : end]))
            elif "startpos" in tokens:
                engine.board.load_fen(START_FEN)
            if "moves" in tokens:
                idx = tokens.index("moves")
                for ms in tokens[idx + 1 :]:
                    engine.board.make(_uci2m(ms))

        elif line.startswith("go"):
            tokens = line.split()
            wtime = btime = 60000
            winc = binc = 0
            movetime = None
            depth = 64
            for i, token in enumerate(tokens):
                if token == "wtime":
                    wtime = int(tokens[i + 1])
                elif token == "btime":
                    btime = int(tokens[i + 1])
                elif token == "winc":
                    winc = int(tokens[i + 1])
                elif token == "binc":
                    binc = int(tokens[i + 1])
                elif token == "movetime":
                    movetime = int(tokens[i + 1])
                elif token == "depth":
                    depth = int(tokens[i + 1])

            best = engine.think(wtime, btime, winc, binc, movetime, depth)
            if best == NO_MOVE:
                moves = engine.board.gen_legal()
                best = moves[0] if moves else NO_MOVE
            _out(f"bestmove {_m2uci(best)}")

        elif line == "quit":
            break


if __name__ == "__main__":
    main()
