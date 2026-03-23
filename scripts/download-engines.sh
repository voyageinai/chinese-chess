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

# Download Pikafish
PIKAFISH_VERSION="2025-01-26"
echo ""
echo "→ 下载 Pikafish ($PIKAFISH_VERSION)..."

PIKAFISH_URL="https://github.com/official-pikafish/Pikafish/releases/download/${PIKAFISH_VERSION}"

case "$PLATFORM" in
    x86-64)
        PIKAFISH_FILE="pikafish-bmi2-x86-64"
        [[ "$OS" == "linux" ]] && PIKAFISH_FILE="pikafish-bmi2-x86-64"
        [[ "$OS" == "darwin" ]] && PIKAFISH_FILE="pikafish-bmi2-x86-64-macos"
        ;;
    aarch64)
        PIKAFISH_FILE="pikafish-armv8-dotprod"
        ;;
    apple-silicon)
        PIKAFISH_FILE="pikafish-apple-silicon"
        ;;
esac

DOWNLOAD_URL="${PIKAFISH_URL}/${PIKAFISH_FILE}"
OUTPUT_PATH="${ENGINES_DIR}/pikafish"

if [ -f "$OUTPUT_PATH" ]; then
    echo "  Pikafish 已存在，跳过下载"
else
    echo "  下载: $DOWNLOAD_URL"
    if command -v curl &> /dev/null; then
        curl -L -o "$OUTPUT_PATH" "$DOWNLOAD_URL" 2>/dev/null || {
            echo "  ⚠ 下载失败。你可以手动下载:"
            echo "    https://github.com/official-pikafish/Pikafish/releases"
            echo "    放到 $ENGINES_DIR/pikafish"
            exit 0
        }
    elif command -v wget &> /dev/null; then
        wget -O "$OUTPUT_PATH" "$DOWNLOAD_URL" 2>/dev/null || {
            echo "  ⚠ 下载失败。手动下载地址:"
            echo "    https://github.com/official-pikafish/Pikafish/releases"
            exit 0
        }
    else
        echo "  需要 curl 或 wget"
        exit 1
    fi
    chmod +x "$OUTPUT_PATH"
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
