#!/usr/bin/env bash
set -e

echo "============================================"
echo "  象棋擂台 — Chinese Chess Engine Arena"
echo "  一键安装部署"
echo "============================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 需要 Node.js >= 18"
    echo "安装: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "错误: Node.js 版本过低 ($(node -v))，需要 >= 18"
    exit 1
fi
echo "✓ Node.js $(node -v)"

# Detect package manager
if command -v pnpm &> /dev/null; then
    PM="pnpm"
elif command -v yarn &> /dev/null; then
    PM="yarn"
else
    PM="npm"
fi
echo "✓ 使用 $PM 安装依赖"

# Install dependencies
echo ""
echo "→ 安装依赖..."
$PM install

# Create .env if not exists
if [ ! -f .env ]; then
    echo ""
    echo "→ 创建 .env 配置文件..."
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    cat > .env << EOF
INVITE_CODE=changeme
JWT_SECRET=$JWT_SECRET
PORT=3000
HOST=0.0.0.0
MAX_CONCURRENT_MATCHES=2
ENGINE_UPLOAD_MAX_SIZE_MB=50
EOF
    echo "✓ .env 已创建 (JWT_SECRET 已随机生成)"
    echo "  请修改 INVITE_CODE 为你自己的邀请码"
else
    echo "✓ .env 已存在，跳过"
fi

# Create data directories
mkdir -p data/engines data/default-engines
echo "✓ 数据目录已创建"

# Download default engines
echo ""
read -p "→ 是否下载默认引擎 Pikafish？(y/N) " download_engine
if [[ "$download_engine" =~ ^[Yy]$ ]]; then
    bash scripts/download-engines.sh
fi

# Build
echo ""
echo "→ 构建生产版本..."
$PM run build 2>/dev/null || echo "⚠ 构建跳过（开发模式可直接 npm run dev）"

echo ""
echo "============================================"
echo "  安装完成！"
echo ""
echo "  开发模式:  $PM run dev"
echo "  生产模式:  $PM start"
echo ""
echo "  首次使用:"
echo "  1. 打开 http://localhost:3000/register"
echo "  2. 邀请码: $(grep INVITE_CODE .env | cut -d= -f2)"
echo "  3. 第一个注册用户自动成为管理员"
echo "============================================"
