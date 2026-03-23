#!/usr/bin/env bash
set -e

ENGINES_DIR="data/default-engines"
mkdir -p "$ENGINES_DIR"

echo "→ 检测系统架构..."

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
    linux)
        case "$ARCH" in
            x86_64)  PLATFORM="x86-64" ;;
            aarch64) PLATFORM="aarch64" ;;
            *)       echo "不支持的架构: $ARCH"; exit 1 ;;
        esac
        ;;
    darwin)
        case "$ARCH" in
            x86_64)  PLATFORM="x86-64" ;;
            arm64)   PLATFORM="apple-silicon" ;;
            *)       echo "不支持的架构: $ARCH"; exit 1 ;;
        esac
        ;;
    *)
        echo "不支持的操作系统: $OS"
        exit 1
        ;;
esac

echo "  系统: $OS / $ARCH → $PLATFORM"

# Download Pikafish (now distributed as a single 7z archive)
PIKAFISH_VERSION="Pikafish-2026-01-02"
echo ""
echo "→ 下载 Pikafish ($PIKAFISH_VERSION)..."

PIKAFISH_URL="https://github.com/official-pikafish/Pikafish/releases/download/${PIKAFISH_VERSION}/Pikafish.2026-01-02.7z"
OUTPUT_PATH="${ENGINES_DIR}/pikafish"
NNUE_PATH="${ENGINES_DIR}/pikafish.nnue"

case "$PLATFORM" in
    x86-64)       ARCHIVE_BINARY="Linux/pikafish-bmi2" ;;
    aarch64)      ARCHIVE_BINARY="Linux/pikafish-bmi2" ;;
    apple-silicon) ARCHIVE_BINARY="MacOS/pikafish-apple-silicon" ;;
esac

if [ -f "$OUTPUT_PATH" ] && file "$OUTPUT_PATH" | grep -q "ELF\|Mach-O"; then
    echo "  Pikafish 已存在，跳过下载"
else
    echo "  下载: $PIKAFISH_URL"
    ARCHIVE_PATH="/tmp/pikafish-$$.7z"

    if command -v curl &> /dev/null; then
        curl -L -o "$ARCHIVE_PATH" "$PIKAFISH_URL" || {
            echo "  ⚠ 下载失败。你可以手动下载:"
            echo "    https://github.com/official-pikafish/Pikafish/releases"
            echo "    放到 $ENGINES_DIR/pikafish"
            exit 0
        }
    elif command -v wget &> /dev/null; then
        wget -O "$ARCHIVE_PATH" "$PIKAFISH_URL" || {
            echo "  ⚠ 下载失败。手动下载地址:"
            echo "    https://github.com/official-pikafish/Pikafish/releases"
            exit 0
        }
    else
        echo "  需要 curl 或 wget"
        exit 1
    fi

    echo "  解压引擎..."
    # Try 7z first, fall back to python py7zr
    EXTRACT_DIR="/tmp/pikafish-extract-$$"
    if command -v 7z &> /dev/null; then
        7z x -o"$EXTRACT_DIR" "$ARCHIVE_PATH" "$ARCHIVE_BINARY" "pikafish.nnue" -y > /dev/null
    elif python3 -c "import py7zr" 2>/dev/null; then
        python3 -c "
import py7zr
with py7zr.SevenZipFile('$ARCHIVE_PATH', 'r') as z:
    z.extract(path='$EXTRACT_DIR', targets=['$ARCHIVE_BINARY', 'pikafish.nnue'])
"
    else
        echo "  需要 7z 或 python3 py7zr (pip install py7zr)"
        rm -f "$ARCHIVE_PATH"
        exit 1
    fi

    mv "$EXTRACT_DIR/$ARCHIVE_BINARY" "$OUTPUT_PATH"
    mv "$EXTRACT_DIR/pikafish.nnue" "$NNUE_PATH"
    chmod +x "$OUTPUT_PATH"
    rm -rf "$ARCHIVE_PATH" "$EXTRACT_DIR"
    echo "  ✓ Pikafish 已下载到 $OUTPUT_PATH"
fi

# Verify
echo ""
echo "→ 验证引擎..."
if [ -x "$OUTPUT_PATH" ]; then
    echo "  ✓ pikafish — $(ls -lh "$OUTPUT_PATH" | awk '{print $5}')"
    echo ""
    echo "引擎已就绪。在 Web 界面上传 $OUTPUT_PATH 即可使用。"
    echo "或者你也可以在注册后通过 API 上传:"
    echo "  curl -X POST http://localhost:3000/api/engines \\"
    echo "    -H 'Cookie: token=YOUR_TOKEN' \\"
    echo "    -F 'name=Pikafish' \\"
    echo "    -F 'file=@$OUTPUT_PATH'"
else
    echo "  ⚠ 引擎文件不可执行"
fi
