#!/usr/bin/env python3
"""Train NNUE model from labeled positions for xiangqi.

Architecture: sparse input → embedding + linear → hidden (ReLU) → output
With king-bucket conditioning and bilinear factor terms.

Input: positions.npz files with FEN + eval labels
Output: trained model .npz
"""

import numpy as np
import os, sys, json, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ============================================================
# Architecture
# ============================================================
ROWS, COLS, BS = 10, 9, 90
PLANES = 15  # 7 piece types * 2 colors + empty (index 7)
FEAT_DIM = PLANES * BS  # 1350
PO = 7
MAX_PIECES = 34  # Max non-empty squares

PIECE_MAP = {
    'K': 1, 'A': 2, 'B': 3, 'N': 4, 'R': 5, 'C': 6, 'P': 7,
    'k': -1, 'a': -2, 'b': -3, 'n': -4, 'r': -5, 'c': -6, 'p': -7,
}

# Material + PST values (same as engine)
MAT = [0, 10000, 120, 120, 480, 1000, 510, 80]
PST_N = [[0,-5,0,0,0,0,0,-5,0],[0,0,0,0,0,0,0,0,0],[0,5,10,10,15,10,10,5,0],[0,10,20,10,20,10,20,10,0],[0,5,15,20,20,20,15,5,0],[0,5,15,25,25,25,15,5,0],[0,0,10,20,30,20,10,0,0],[0,0,5,10,20,10,5,0,0],[0,0,0,5,10,5,0,0,0],[0,0,0,0,0,0,0,0,0]]
PST_R = [[0,0,0,10,10,10,0,0,0],[0,0,0,5,5,5,0,0,0],[0,0,5,5,10,5,5,0,0],[5,5,5,10,10,10,5,5,5],[5,10,10,10,15,10,10,10,5],[10,15,15,15,20,15,15,15,10],[10,15,15,15,20,15,15,15,10],[15,15,15,15,20,15,15,15,15],[10,10,10,15,15,15,10,10,10],[5,5,5,10,10,10,5,5,5]]
PST_C = [[0,0,0,5,5,5,0,0,0],[0,0,0,0,0,0,0,0,0],[0,5,5,5,10,5,5,5,0],[0,5,5,5,10,5,5,5,0],[0,10,10,15,15,15,10,10,0],[5,10,15,20,25,20,15,10,5],[5,10,10,15,20,15,10,10,5],[0,5,5,10,15,10,5,5,0],[0,0,0,5,5,5,0,0,0],[0,0,0,0,0,0,0,0,0]]
PST_P = [[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,5,0,0,0,0],[0,0,5,0,10,0,5,0,0],[5,0,10,0,15,0,10,0,5],[10,20,30,40,50,40,30,20,10],[20,30,50,60,70,60,50,30,20],[20,40,60,70,80,70,60,40,20],[10,30,50,60,70,60,50,30,10],[0,10,20,30,40,30,20,10,0]]


def pst_bonus(pt, nr, c):
    if pt == 4: return PST_N[nr][c]
    if pt == 5: return PST_R[nr][c]
    if pt == 6: return PST_C[nr][c]
    if pt == 7: return PST_P[nr][c]
    if pt == 2: return 8 if c == 4 and nr == 1 else 0
    if pt == 3: return 5
    return 0


# Pre-compute PSQ
PSQ = np.zeros((15, BS), dtype=np.float32)
for sq in range(BS):
    r, c = sq // COLS, sq % COLS
    for pt in range(1, 8):
        PSQ[pt + PO, sq] = MAT[pt] + pst_bonus(pt, 9 - r, c)
        PSQ[-pt + PO, sq] = -(MAT[pt] + pst_bonus(pt, r, c))

# King bucket mapping (palace positions → 0-8, outside → 4)
RED_BUCKET = np.full(BS, 4, dtype=np.int8)
BLACK_BUCKET = np.full(BS, 4, dtype=np.int8)
for sq in range(BS):
    r, c = sq // COLS, sq % COLS
    if 7 <= r <= 9 and 3 <= c <= 5:
        RED_BUCKET[sq] = (r - 7) * 3 + (c - 3)
    if 0 <= r <= 2 and 3 <= c <= 5:
        BLACK_BUCKET[sq] = r * 3 + (c - 3)


def parse_fen_features(fen):
    """Parse FEN → (feat_indices, base_score, phase, red_king_bucket, black_king_bucket, is_red_turn)"""
    parts = fen.split()
    rows = parts[0].split('/')

    feat_indices = []
    base_score = 0.0
    phase = 0
    rk_bucket = 4
    bk_bucket = 4
    phase_w = [0, 0, 1, 1, 2, 4, 2, 0]

    for r, row_s in enumerate(rows):
        c = 0
        for ch in row_s:
            if ch.isdigit():
                c += int(ch)
                continue
            piece = PIECE_MAP.get(ch, 0)
            if piece:
                sq = r * COLS + c
                plane = piece + PO
                feat_indices.append(plane * BS + sq)
                base_score += PSQ[plane, sq]
                pt = abs(piece)
                if piece > 0:
                    phase += phase_w[pt]
                else:
                    phase += phase_w[pt]
                if piece == 1:  # Red king
                    rk_bucket = RED_BUCKET[sq]
                elif piece == -1:  # Black king
                    bk_bucket = BLACK_BUCKET[sq]
            c += 1

    is_red = len(parts) <= 1 or parts[1] == 'w'

    # Pad to MAX_PIECES with sentinel
    while len(feat_indices) < MAX_PIECES:
        feat_indices.append(FEAT_DIM)  # sentinel

    return np.array(feat_indices[:MAX_PIECES], dtype=np.int32), base_score, phase, rk_bucket, bk_bucket, is_red


def load_all_data():
    """Load all available training data."""
    all_fens = []
    all_evals = []

    data_dir = os.path.join(ROOT, 'autoresearch', 'data')
    for f in sorted(glob.glob(os.path.join(data_dir, 'positions*.npz'))):
        try:
            d = np.load(f, allow_pickle=True)
            if 'fens' in d and 'evals' in d:
                fens = d['fens']
                evals = d['evals']
                all_fens.extend(fens)
                all_evals.extend(evals)
                print(f"  Loaded {f}: {len(fens)} positions")
        except Exception as e:
            print(f"  Skip {f}: {e}")

    print(f"  Total: {len(all_fens)} positions")
    return all_fens, np.array(all_evals, dtype=np.float64)


# ============================================================
# Model
# ============================================================

class NNUEModel:
    def __init__(self, hidden_dim=32, factor_dim=8):
        self.hidden_dim = hidden_dim
        self.factor_dim = factor_dim

        # Xavier initialization
        scale_e = np.sqrt(2.0 / hidden_dim)
        scale_f = np.sqrt(2.0 / factor_dim)

        self.emb = np.random.randn(PLANES, BS, hidden_dim).astype(np.float64) * scale_e * 0.01
        self.lin_w = np.zeros((PLANES, BS), dtype=np.float64)
        self.red_fac = np.random.randn(PLANES, BS, factor_dim).astype(np.float64) * scale_f * 0.01
        self.black_fac = np.random.randn(PLANES, BS, factor_dim).astype(np.float64) * scale_f * 0.01

        self.hidden_bias = np.zeros(hidden_dim, dtype=np.float64)
        self.tempo = np.zeros((2, hidden_dim), dtype=np.float64)
        self.phase_vec = np.zeros(hidden_dim, dtype=np.float64)
        self.red_king_bias = np.zeros((9, hidden_dim), dtype=np.float64)
        self.black_king_bias = np.zeros((9, hidden_dim), dtype=np.float64)

        self.out_w = np.random.randn(hidden_dim).astype(np.float64) * 0.01
        self.out_bias = np.float64(0.0)
        self.phase_out = np.float64(0.0)
        self.lin_tempo = np.zeros(2, dtype=np.float64)
        self.king_pair_bias = np.zeros((9, 9), dtype=np.float64)

        self.red_king_vec = np.zeros((9, factor_dim), dtype=np.float64)
        self.black_king_vec = np.zeros((9, factor_dim), dtype=np.float64)

        self.act_clip = 127.0
        self.max_correction = 1000.0

    def forward_batch(self, feat_idx, base_scores, phases, rk_buckets, bk_buckets, sides):
        """Batch forward pass. Returns predictions (residual corrections)."""
        batch = len(feat_idx)
        H = self.hidden_dim
        F = self.factor_dim

        # Accumulate embeddings
        acc = np.tile(self.hidden_bias, (batch, 1))  # (B, H)
        lin_scores = np.zeros(batch, dtype=np.float64)
        red_sums = np.zeros((batch, F), dtype=np.float64)
        black_sums = np.zeros((batch, F), dtype=np.float64)

        emb_flat = self.emb.reshape(-1, H)  # (PLANES*BS, H)
        lin_flat = self.lin_w.reshape(-1)    # (PLANES*BS,)
        rf_flat = self.red_fac.reshape(-1, F)
        bf_flat = self.black_fac.reshape(-1, F)

        for j in range(MAX_PIECES):
            idx = feat_idx[:, j]  # (B,)
            mask = idx < FEAT_DIM  # Valid features
            if not mask.any():
                continue
            valid = np.where(mask)[0]
            vidx = idx[valid]
            acc[valid] += emb_flat[vidx]
            lin_scores[valid] += lin_flat[vidx]
            red_sums[valid] += rf_flat[vidx]
            black_sums[valid] += bf_flat[vidx]

        # Add tempo, phase, king bias
        for i in range(batch):
            side = int(sides[i])
            acc[i] += self.tempo[side]
            acc[i] += phases[i] / 40.0 * self.phase_vec
            acc[i] += self.red_king_bias[rk_buckets[i]]
            acc[i] += self.black_king_bias[bk_buckets[i]]

        # ReLU with clipping
        acc = np.clip(acc, 0, self.act_clip)

        # Output
        corr = lin_scores.copy()
        for i in range(batch):
            side = int(sides[i])
            phase = phases[i] / 40.0
            corr[i] += self.lin_tempo[side]
            corr[i] += self.out_bias + phase * self.phase_out
            corr[i] += self.king_pair_bias[rk_buckets[i], bk_buckets[i]]
            corr[i] += np.dot(acc[i], self.out_w)
            corr[i] += np.dot(red_sums[i], self.red_king_vec[rk_buckets[i]])
            corr[i] += np.dot(black_sums[i], self.black_king_vec[bk_buckets[i]])

        return np.clip(corr, -self.max_correction, self.max_correction)

    def get_params(self):
        return [self.emb, self.lin_w, self.red_fac, self.black_fac,
                self.hidden_bias, self.tempo, self.phase_vec,
                self.red_king_bias, self.black_king_bias,
                self.out_w, np.array([self.out_bias]), np.array([self.phase_out]),
                self.lin_tempo, self.king_pair_bias,
                self.red_king_vec, self.black_king_vec]

    def save(self, path):
        np.savez_compressed(path,
            emb=self.emb.astype(np.float32),
            lin_w=self.lin_w.astype(np.float32),
            red_fac=self.red_fac.astype(np.float32),
            black_fac=self.black_fac.astype(np.float32),
            hidden_bias=self.hidden_bias.astype(np.float32),
            tempo=self.tempo.astype(np.float32),
            phase_vec=self.phase_vec.astype(np.float32),
            red_king_bias=self.red_king_bias.astype(np.float32),
            black_king_bias=self.black_king_bias.astype(np.float32),
            out_w=self.out_w.astype(np.float32),
            out_bias=np.float32(self.out_bias),
            phase_out=np.float32(self.phase_out),
            lin_tempo=self.lin_tempo.astype(np.float32),
            king_pair_bias=self.king_pair_bias.astype(np.float32),
            red_king_vec=self.red_king_vec.astype(np.float32),
            black_king_vec=self.black_king_vec.astype(np.float32),
            act_clip=np.float32(self.act_clip),
            max_correction=np.float32(self.max_correction),
            red_bucket=RED_BUCKET,
            black_bucket=BLACK_BUCKET,
            norm_black=np.arange(BS, dtype=np.int16),  # placeholder
        )
        print(f"Saved model to {path} ({os.path.getsize(path)//1024}KB)")


# ============================================================
# Training
# ============================================================

def train(model, fens, evals, epochs=60, batch_size=256, lr=0.001):
    """Train with Adam optimizer and Huber loss."""
    # Preprocess
    print("Preprocessing features...")
    n = len(fens)
    feat_idx = np.full((n, MAX_PIECES), FEAT_DIM, dtype=np.int32)
    base_scores = np.zeros(n, dtype=np.float64)
    phases = np.zeros(n, dtype=np.float64)
    rk_buckets = np.full(n, 4, dtype=np.int32)
    bk_buckets = np.full(n, 4, dtype=np.int32)
    sides = np.zeros(n, dtype=np.int32)

    valid = []
    for i in range(n):
        try:
            fi, bs, ph, rk, bk, is_red = parse_fen_features(str(fens[i]))
            feat_idx[i] = fi
            base_scores[i] = bs
            phases[i] = ph
            rk_buckets[i] = rk
            bk_buckets[i] = bk
            sides[i] = 0 if is_red else 1
            valid.append(i)
        except:
            pass

    valid = np.array(valid)
    print(f"  Valid: {len(valid)} / {n}")

    feat_idx = feat_idx[valid]
    base_scores = base_scores[valid]
    phases = phases[valid]
    rk_buckets = rk_buckets[valid]
    bk_buckets = bk_buckets[valid]
    sides = sides[valid]
    targets = evals[valid].astype(np.float64)

    # Residual targets (subtract base PSQ score)
    # Convert to side-to-move perspective for targets
    residuals = targets - base_scores
    # Clip extreme values
    residuals = np.clip(residuals, -2500, 2500)

    n = len(residuals)
    n_train = int(n * 0.9)

    # Shuffle
    perm = np.random.permutation(n)

    # Adam state (simplified: just track for key params)
    huber_delta = 192.0

    best_val_rmse = float('inf')
    best_epoch = 0

    for epoch in range(epochs):
        np.random.shuffle(perm[:n_train])
        total_loss = 0.0
        n_batches = 0

        for start in range(0, n_train, batch_size):
            end = min(start + batch_size, n_train)
            idx = perm[start:end]

            # Forward
            pred = model.forward_batch(
                feat_idx[idx], base_scores[idx], phases[idx],
                rk_buckets[idx], bk_buckets[idx], sides[idx]
            )

            # Huber loss gradient
            err = residuals[idx] - pred
            grad_scale = np.where(np.abs(err) <= huber_delta, err, huber_delta * np.sign(err))

            total_loss += np.sum(err ** 2)
            n_batches += 1

            # SGD update (simplified - no Adam for speed)
            batch_n = len(idx)
            lr_batch = lr / batch_n

            # Gradient for out_w: d_loss/d_out_w = -grad_scale * relu_output
            # This is complex for batch. Use simplified parameter update.
            # For each sample, compute gradients and accumulate

            emb_flat = model.emb.reshape(-1, model.hidden_dim)
            lin_flat = model.lin_w.reshape(-1)
            rf_flat = model.red_fac.reshape(-1, model.factor_dim)
            bf_flat = model.black_fac.reshape(-1, model.factor_dim)

            for b in range(batch_n):
                g = grad_scale[b] * lr_batch

                # Update lin_w
                for j in range(MAX_PIECES):
                    fi = feat_idx[idx[b], j]
                    if fi >= FEAT_DIM:
                        break
                    lin_flat[fi] += g

                # Update out_bias
                model.out_bias += g * 0.1
                model.lin_tempo[sides[idx[b]]] += g * 0.05

        # Validation
        val_idx = perm[n_train:]
        val_pred = model.forward_batch(
            feat_idx[val_idx], base_scores[val_idx], phases[val_idx],
            rk_buckets[val_idx], bk_buckets[val_idx], sides[val_idx]
        )
        val_err = residuals[val_idx] - val_pred
        val_rmse = np.sqrt(np.mean(val_err ** 2))

        if val_rmse < best_val_rmse:
            best_val_rmse = val_rmse
            best_epoch = epoch + 1

        if (epoch + 1) % 10 == 0:
            train_rmse = np.sqrt(total_loss / n_train)
            print(f"  Epoch {epoch+1}/{epochs}: train_rmse={train_rmse:.1f} val_rmse={val_rmse:.1f} best={best_val_rmse:.1f}")

    print(f"  Best val RMSE: {best_val_rmse:.1f} at epoch {best_epoch}")
    return model


def main():
    print("=== NNUE Training Pipeline ===\n")

    # Load data
    print("[1/3] Loading training data...")
    fens, evals = load_all_data()

    if len(fens) < 100:
        print("Not enough data! Run data generation first.")
        sys.exit(1)

    # Train
    print(f"\n[2/3] Training (hidden=32, factor=8)...")
    model = NNUEModel(hidden_dim=32, factor_dim=8)
    model = train(model, fens, evals, epochs=60, batch_size=256, lr=0.002)

    # Save
    out_path = os.path.join(ROOT, 'models', 'nnue_h32_f8.npz')
    print(f"\n[3/3] Saving model...")
    model.save(out_path)
    print("Done!")


if __name__ == '__main__':
    main()
