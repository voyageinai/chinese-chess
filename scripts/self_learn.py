#!/usr/bin/env python3
"""Self-learning loop for XiangqiEngine-JS via Texel Tuning.

Pipeline:
1. Self-play: JS engine plays N games against itself → positions + results
2. Feature extraction: each position → feature vector
3. Texel tuning: gradient descent to find optimal eval weights
4. Export: generate new JS engine with tuned weights
5. Validate: match new vs old engine

Usage:
  python3 scripts/self_learn.py              # Full pipeline
  python3 scripts/self_learn.py --games 500  # More games for better data
  python3 scripts/self_learn.py --iter 3     # Multiple self-learning iterations
"""

import subprocess, sys, os, json, math, time, argparse, random, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE_PATH = ROOT / "engines" / "xiangqi-engine.js"

# ============================================================
# 1. Self-play data generation
# ============================================================

def self_play(engine_cmd, n_games=200, movetime=100, max_moves=150):
    """Play engine against itself, return list of (positions, result) tuples."""
    all_data = []

    for game_idx in range(n_games):
        p = subprocess.Popen(
            engine_cmd, shell=True,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True
        )

        def send(cmd):
            p.stdin.write(cmd + "\n")
            p.stdin.flush()

        def read_until(prefix, timeout=15):
            while True:
                line = p.stdout.readline()
                if not line:
                    return None
                if line.strip().startswith(prefix):
                    return line.strip()

        send("uci")
        read_until("uciok")
        send("isready")
        read_until("readyok")
        send("ucinewgame")

        moves = []
        positions = []
        result = 0.5  # default draw

        for turn in range(max_moves):
            # Build position command
            if moves:
                pos_cmd = f'position startpos moves {" ".join(moves)}'
            else:
                pos_cmd = "position startpos"
            send(pos_cmd)

            # Record position FEN (approximate: use move list)
            # We'll reconstruct positions from the move sequence later
            positions.append(list(moves))  # snapshot of moves at this point

            send(f"go movetime {movetime}")
            line = read_until("bestmove", timeout=movetime / 1000 + 10)
            if line is None:
                result = 0.0 if turn % 2 == 0 else 1.0  # timeout = loss
                break
            best = line.split()[1]
            if best == "0000":
                result = 0.0 if turn % 2 == 0 else 1.0  # no move = loss
                break
            moves.append(best)

        send("quit")
        try:
            p.wait(timeout=3)
        except:
            p.kill()

        # Record game data (skip first 8 moves for opening bias)
        for i in range(8, len(positions)):
            side = i % 2  # 0 = red moved, 1 = black moved
            # Result from red's perspective
            r = result
            all_data.append((positions[i], r))

        if (game_idx + 1) % 50 == 0:
            print(f"  Self-play: {game_idx+1}/{n_games} games, {len(all_data)} positions")

    return all_data


# ============================================================
# 2. Position evaluation with parameterized features
# ============================================================

ROWS, COLS = 10, 9
BS = 90
K, A, B, N, R, C, P = 1, 2, 3, 4, 5, 6, 7
PO = 7

PIECE_FROM_CHAR = {
    "K": K, "A": A, "B": B, "N": N, "R": R, "C": C, "P": P,
    "k": -K, "a": -A, "b": -B, "n": -N, "r": -R, "c": -C, "p": -P,
}
START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


def parse_fen(fen):
    """Parse FEN to board array."""
    board = [0] * BS
    parts = fen.split()
    rows = parts[0].split("/")
    for r, row_s in enumerate(rows):
        c = 0
        for ch in row_s:
            if ch.isdigit():
                c += int(ch)
                continue
            board[r * COLS + c] = PIECE_FROM_CHAR[ch]
            c += 1
    red_turn = len(parts) <= 1 or parts[1] == "w"
    return board, red_turn


def replay_moves(moves):
    """Replay a move sequence from startpos, return (board, red_turn)."""
    board, red_turn = parse_fen(START_FEN)

    for move_str in moves:
        fc = ord(move_str[0]) - 97
        fr = 9 - int(move_str[1])
        tc = ord(move_str[2]) - 97
        tr = 9 - int(move_str[3])

        from_sq = fr * COLS + fc
        to_sq = tr * COLS + tc

        board[to_sq] = board[from_sq]
        board[from_sq] = 0
        red_turn = not red_turn

    return board, red_turn


def extract_features(board, red_turn):
    """Extract evaluation features from a position.

    Features:
    - PSQ: 14 piece types * 90 squares = 1260 features (sparse)
    - King safety: red_advisor_count, red_bishop_count, black_advisor_count, black_bishop_count
    - Crossed pawns: red_crossed, black_crossed
    - King file danger: red_danger, black_danger

    Returns: feature dict {index: value}
    """
    features = {}

    red_king = black_king = -1
    red_adv = red_bish = black_adv = black_bish = 0
    red_cp = black_cp = 0

    for sq in range(BS):
        piece = board[sq]
        if not piece:
            continue

        # PSQ feature: piece_type * 90 + square
        pt = piece if piece > 0 else -piece
        if piece > 0:
            idx = (pt - 1) * BS + sq  # Red pieces: indices 0-629
            features[idx] = features.get(idx, 0) + 1
            if pt == A:
                red_adv += 1
            elif pt == B:
                red_bish += 1
            elif pt == P and sq // COLS <= 4:
                red_cp += 1
            elif pt == K:
                red_king = sq
        else:
            idx = (pt - 1 + 7) * BS + sq  # Black pieces: indices 630-1259
            features[idx] = features.get(idx, 0) + 1
            if pt == A:
                black_adv += 1
            elif pt == B:
                black_bish += 1
            elif pt == P and sq // COLS >= 5:
                black_cp += 1
            elif pt == K:
                black_king = sq

    # King safety features (index 1260-1263)
    features[1260] = min(red_adv, 2)
    features[1261] = min(red_bish, 2)
    features[1262] = min(black_adv, 2)
    features[1263] = min(black_bish, 2)

    # Crossed pawn features (index 1264-1265)
    features[1264] = red_cp
    features[1265] = black_cp

    # King file danger (index 1266-1267)
    red_danger = black_danger = 0
    if red_king >= 0:
        kc = red_king % COLS
        for r in range(ROWS):
            p = board[r * COLS + kc]
            if p < 0:
                pt = -p
                if pt == R:
                    red_danger += 1
                elif pt == C:
                    red_danger += 1
    if black_king >= 0:
        kc = black_king % COLS
        for r in range(ROWS):
            p = board[r * COLS + kc]
            if p > 0:
                if p == R:
                    black_danger += 1
                elif p == C:
                    black_danger += 1
    features[1266] = red_danger
    features[1267] = black_danger

    # Side to move
    features[1268] = 1 if red_turn else -1

    return features


# ============================================================
# 3. Texel Tuning (gradient descent)
# ============================================================

N_FEATURES = 1269
SCALE = 400.0


def sigmoid(x):
    if x > 500:
        return 1.0
    if x < -500:
        return 0.0
    return 1.0 / (1.0 + math.exp(-x))


def texel_tune(data, n_epochs=100, lr=1.0, batch_size=256):
    """Optimize evaluation weights using Texel tuning.

    data: list of (features_dict, result) where result is from red's perspective (1.0=red win)
    Returns: optimized weight array
    """
    n = len(data)
    print(f"  Texel tuning: {n} positions, {n_epochs} epochs, lr={lr}")

    # Initialize weights (zero = learn from scratch)
    weights = [0.0] * N_FEATURES

    # Set initial piece values as starting point
    for pt in range(1, 8):
        for sq in range(BS):
            # Red piece PSQ initial value
            weights[(pt - 1) * BS + sq] = 1.0  # Will be scaled
            # Black piece PSQ initial value
            weights[(pt - 1 + 7) * BS + sq] = -1.0

    best_loss = float("inf")
    best_weights = list(weights)

    for epoch in range(n_epochs):
        # Shuffle data
        random.shuffle(data)

        total_loss = 0.0
        grad = [0.0] * N_FEATURES

        for features, result in data:
            # Compute eval
            ev = 0.0
            for idx, val in features.items():
                ev += weights[idx] * val

            # Sigmoid prediction
            pred = sigmoid(ev / SCALE)

            # Loss
            error = result - pred
            total_loss += error * error

            # Gradient
            sig_deriv = pred * (1.0 - pred) / SCALE
            for idx, val in features.items():
                grad[idx] += -2.0 * error * sig_deriv * val

        # Update weights
        for i in range(N_FEATURES):
            weights[i] -= lr * grad[i] / n

        avg_loss = total_loss / n
        if (epoch + 1) % 10 == 0:
            print(f"    Epoch {epoch+1}/{n_epochs}: loss={avg_loss:.6f}")

        if avg_loss < best_loss:
            best_loss = avg_loss
            best_weights = list(weights)

    print(f"  Best loss: {best_loss:.6f}")
    return best_weights


# ============================================================
# 4. Export tuned weights to JS engine
# ============================================================

def extract_tuned_params(weights):
    """Convert weight array to named evaluation parameters."""
    params = {}

    # Piece values (average PSQ value per piece type)
    for pt in range(1, 8):
        red_vals = []
        for sq in range(BS):
            red_vals.append(weights[(pt - 1) * BS + sq])
        params[f"piece_{pt}_avg"] = sum(red_vals) / len(red_vals)

    # PSQ tables (relative to piece average)
    pst = {}
    for pt in range(1, 8):
        avg = params[f"piece_{pt}_avg"]
        table = []
        for sq in range(BS):
            table.append(weights[(pt - 1) * BS + sq] - avg)
        pst[pt] = table

    # King safety, crossed pawns, king danger
    params["ks_1260"] = weights[1260]  # red advisor bonus
    params["ks_1261"] = weights[1261]  # red bishop bonus
    params["ks_1262"] = weights[1262]  # black advisor bonus
    params["ks_1263"] = weights[1263]  # black bishop bonus
    params["crossed_red"] = weights[1264]
    params["crossed_black"] = weights[1265]
    params["king_danger_red"] = weights[1266]
    params["king_danger_black"] = weights[1267]
    params["tempo"] = weights[1268]

    return params, pst


def patch_js_engine(original_path, output_path, weights):
    """Generate new JS engine with tuned PST values."""
    with open(original_path, "r") as f:
        code = f.read()

    # Extract tuned piece values and PST adjustments
    piece_names = {1: "K", 2: "A", 3: "B", 4: "N", 5: "R", 6: "C", 7: "P"}

    # Calculate tuned PST bonus adjustments
    print("\n  Tuned evaluation adjustments:")
    for pt in range(1, 8):
        vals = [weights[(pt - 1) * BS + sq] for sq in range(BS)]
        avg = sum(vals) / len(vals)
        print(f"    {piece_names[pt]}: avg_weight={avg:.1f}")

    crossed_w = weights[1264]
    danger_w = weights[1266]
    print(f"    Crossed pawn weight: {crossed_w:.1f}")
    print(f"    King danger weight: {danger_w:.1f}")

    # Patch crossed pawn bonus
    if abs(crossed_w) > 0.1:
        new_val = int(round(crossed_w * 100))  # Scale to centipawns
        new_val = max(5, min(80, new_val))
        code = re.sub(
            r"s\+=redCrP\*\d+\-blackCrP\*\d+",
            f"s+=redCrP*{new_val}-blackCrP*{new_val}",
            code,
        )
        print(f"    Applied crossed pawn bonus: {new_val}")

    # Patch king file danger
    if abs(danger_w) > 0.1:
        r_val = int(round(abs(danger_w) * 120))
        r_val = max(10, min(80, r_val))
        c_val = int(round(r_val * 0.7))
        code = re.sub(r"if\(pt===R\)s-=\d+", f"if(pt===R)s-={r_val}", code)
        code = re.sub(
            r"else if\(pt===C\)s-=\d+", f"else if(pt===C)s-={c_val}", code
        )
        code = re.sub(r"if\(p===R\)s\+=\d+", f"if(p===R)s+={r_val}", code)
        code = re.sub(
            r"else if\(p===C\)s\+=\d+", f"else if(p===C)s+={c_val}", code
        )
        print(f"    Applied king danger: R={r_val}, C={c_val}")

    with open(output_path, "w") as f:
        f.write(code)

    print(f"\n  Wrote tuned engine to {output_path}")


# ============================================================
# 5. Validation match
# ============================================================

def validate(engine_a, engine_b, n_games=10, movetime=200):
    """Play a match between two engines, return (a_wins, draws, b_wins)."""
    aw = bw = dr = 0

    for g in range(n_games):
        if g < n_games // 2:
            cmd1, cmd2 = engine_a, engine_b
            a_is_red = True
        else:
            cmd1, cmd2 = engine_b, engine_a
            a_is_red = False

        # Start engines
        procs = []
        for cmd in [cmd1, cmd2]:
            p = subprocess.Popen(
                cmd,
                shell=True,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            p.stdin.write("uci\n")
            p.stdin.flush()
            while True:
                line = p.stdout.readline()
                if line.strip().startswith("uciok"):
                    break
            p.stdin.write("isready\n")
            p.stdin.flush()
            while True:
                line = p.stdout.readline()
                if line.strip().startswith("readyok"):
                    break
            procs.append(p)

        moves = []
        result = 0  # 1=red wins, -1=black wins, 0=draw
        for turn in range(200):
            side = turn % 2
            p = procs[side]
            pos = (
                f'position startpos moves {" ".join(moves)}'
                if moves
                else "position startpos"
            )
            p.stdin.write(pos + "\n")
            p.stdin.flush()
            p.stdin.write(f"go movetime {movetime}\n")
            p.stdin.flush()
            best_line = None
            while True:
                line = p.stdout.readline()
                if not line:
                    break
                if line.strip().startswith("bestmove"):
                    best_line = line.strip()
                    break
            if best_line is None:
                result = -1 if side == 0 else 1
                break
            best = best_line.split()[1]
            if best == "0000":
                result = -1 if side == 0 else 1
                break
            moves.append(best)

        for p in procs:
            try:
                p.stdin.write("quit\n")
                p.stdin.flush()
                p.wait(timeout=3)
            except:
                p.kill()

        # Convert to a's perspective
        if a_is_red:
            a_result = result
        else:
            a_result = -result

        if a_result > 0:
            aw += 1
        elif a_result < 0:
            bw += 1
        else:
            dr += 1

        tag = "A wins" if a_result > 0 else "B wins" if a_result < 0 else "Draw"
        print(f"    Game {g+1}/{n_games}: {tag} ({len(moves)} moves)")

    return aw, dr, bw


# ============================================================
# Main pipeline
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Self-learning for XiangqiEngine-JS")
    parser.add_argument("--games", type=int, default=200, help="Self-play games per iteration")
    parser.add_argument("--movetime", type=int, default=80, help="ms per move in self-play")
    parser.add_argument("--epochs", type=int, default=80, help="Texel tuning epochs")
    parser.add_argument("--iter", type=int, default=1, help="Number of self-learning iterations")
    parser.add_argument("--validate", type=int, default=10, help="Validation games")
    args = parser.parse_args()

    engine_path = str(ENGINE_PATH)
    current_cmd = f"node {engine_path}"

    for iteration in range(args.iter):
        print(f"\n{'='*60}")
        print(f"SELF-LEARNING ITERATION {iteration+1}/{args.iter}")
        print(f"{'='*60}")

        # Step 1: Self-play
        print(f"\n[1/4] Self-play: {args.games} games at {args.movetime}ms/move...")
        raw_data = self_play(current_cmd, n_games=args.games, movetime=args.movetime)
        print(f"  Collected {len(raw_data)} positions")

        # Step 2: Extract features
        print(f"\n[2/4] Extracting features...")
        tuning_data = []
        for move_list, result in raw_data:
            try:
                board, red_turn = replay_moves(move_list)
                features = extract_features(board, red_turn)
                tuning_data.append((features, result))
            except Exception:
                continue
        print(f"  {len(tuning_data)} positions ready for tuning")

        if len(tuning_data) < 100:
            print("  Not enough data, skipping tuning")
            continue

        # Step 3: Texel tune
        print(f"\n[3/4] Texel tuning ({args.epochs} epochs)...")
        weights = texel_tune(tuning_data, n_epochs=args.epochs)

        # Step 4: Export tuned engine
        print(f"\n[4/4] Exporting tuned engine...")
        tuned_path = str(ROOT / "engines" / f"xiangqi-engine-v{iteration+2}.js")
        patch_js_engine(engine_path, tuned_path, weights)

        # Validate
        if args.validate > 0:
            print(f"\n[Validation] Tuned vs Original ({args.validate} games, 200ms/move)...")
            tuned_cmd = f"node {tuned_path}"
            aw, dr, bw = validate(tuned_cmd, current_cmd, n_games=args.validate, movetime=200)
            print(f"\n  Result: Tuned {aw} - {dr} - {bw} Original")
            wr = aw / (aw + dr + bw) * 100
            print(f"  Tuned win rate: {wr:.0f}%")

            if aw >= bw:
                print("  ✓ Tuned engine is better or equal. Adopting for next iteration.")
                current_cmd = tuned_cmd
                engine_path = tuned_path
            else:
                print("  ✗ Tuned engine is worse. Keeping original for next iteration.")

    print(f"\nFinal engine: {engine_path}")
    print("Upload this file to the platform.")


if __name__ == "__main__":
    main()
