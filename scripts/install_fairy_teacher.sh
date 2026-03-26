#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/data/default-engines"
mkdir -p "$OUT_DIR"

SRC_DIR="$(mktemp -d /tmp/Fairy-Stockfish-src.XXXXXX)"
NNUE_DIR="$(mktemp -d /tmp/Fairy-Stockfish-nnue.XXXXXX)"

echo "→ 拉取 Fairy-Stockfish 源码..."
git clone --depth 1 https://github.com/fairy-stockfish/Fairy-Stockfish.git "$SRC_DIR"

echo "→ 拉取 Fairy-Stockfish-NNUE 网络..."
git clone --depth 1 https://github.com/fairy-stockfish/Fairy-Stockfish-NNUE.git "$NNUE_DIR"

echo "→ 编译 Apple Silicon 版本..."
make -C "$SRC_DIR/src" build ARCH=apple-silicon COMP=clang largeboards=yes nnue=yes -j4

cp "$SRC_DIR/src/stockfish" "$OUT_DIR/fairy-stockfish"
cp "$NNUE_DIR/xiangqi-c07e94a5c7cb.nnue" "$OUT_DIR/fairy-xiangqi.nnue"
chmod +x "$OUT_DIR/fairy-stockfish"

echo "✓ Fairy-Stockfish 老师已安装:"
echo "  binary: $OUT_DIR/fairy-stockfish"
echo "  nnue:   $OUT_DIR/fairy-xiangqi.nnue"
