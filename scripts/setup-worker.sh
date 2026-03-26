#!/usr/bin/env bash
set -e

echo "============================================"
echo "  象棋擂台 — Worker 节点一键部署"
echo "============================================"
echo ""

# ── 参数检查 ──────────────────────────────────────────────────────────
MASTER_URL="${1:-}"
WORKER_SECRET="${2:-}"
WORKER_ID="${3:-worker-$(hostname)}"

if [ -z "$MASTER_URL" ] || [ -z "$WORKER_SECRET" ]; then
    echo "用法: bash scripts/setup-worker.sh <MASTER_URL> <WORKER_SECRET> [WORKER_ID]"
    echo ""
    echo "示例: bash scripts/setup-worker.sh http://10.0.0.1:3002 zhumadian666 worker-2"
    echo ""
    echo "参数:"
    echo "  MASTER_URL     Master 服务器地址 (必填)"
    echo "  WORKER_SECRET  共享密钥，与 Master .env 中的一致 (必填)"
    echo "  WORKER_ID      Worker 标识，默认 worker-<hostname>"
    exit 1
fi

# ── 检查 Node.js ──────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo "错误: 需要 Node.js >= 18"
    echo "安装: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "错误: Node.js 版本过低 ($(node -v))，需要 >= 18"
    exit 1
fi
echo "✓ Node.js $(node -v)"

# ── 检查 pm2 ─────────────────────────────────────────────────────────
if ! command -v pm2 &> /dev/null; then
    echo "→ 安装 pm2..."
    npm install -g pm2
fi
echo "✓ pm2 $(pm2 -v)"

# ── 安装依赖 ──────────────────────────────────────────────────────────
echo ""
echo "→ 安装依赖..."
npm install
echo "✓ 依赖安装完成"

# ── 创建 .env ─────────────────────────────────────────────────────────
cat > .env << EOF
# Worker 配置 (由 setup-worker.sh 生成)
MASTER_URL=${MASTER_URL}
WORKER_SECRET=${WORKER_SECRET}
WORKER_ID=${WORKER_ID}
MAX_CONCURRENT_MATCHES=2
EOF
echo "✓ .env 已创建"

# ── 创建引擎缓存目录 ──────────────────────────────────────────────────
mkdir -p data/engine-cache
echo "✓ 引擎缓存目录已创建"

# ── 测试连接 ──────────────────────────────────────────────────────────
echo ""
echo "→ 测试与 Master 的连接..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${MASTER_URL}/api/internal/tasks/poll" \
    -H "Content-Type: application/json" \
    -H "x-worker-secret: ${WORKER_SECRET}" \
    -d "{\"workerId\":\"${WORKER_ID}\"}" \
    --connect-timeout 5 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "000" ]; then
    echo "⚠ 无法连接 Master ($MASTER_URL)"
    echo "  请确认:"
    echo "  1. Master 已启动且 WORKER_SECRET 已配置"
    echo "  2. 防火墙允许 Worker → Master 的网络访问"
    echo "  3. Master URL 正确（含端口号）"
elif [ "$HTTP_CODE" = "401" ]; then
    echo "✗ 认证失败 — WORKER_SECRET 与 Master 不匹配"
    exit 1
elif [ "$HTTP_CODE" = "204" ] || [ "$HTTP_CODE" = "200" ]; then
    echo "✓ 连接 Master 成功"
elif [ "$HTTP_CODE" = "503" ]; then
    echo "✗ Master 未启用分布式模式 — 请在 Master .env 中设置 WORKER_SECRET"
    exit 1
else
    echo "⚠ Master 响应: HTTP $HTTP_CODE (可能正常，稍后验证)"
fi

# ── 启动 Worker ───────────────────────────────────────────────────────
echo ""
echo "→ 启动 Worker..."
pm2 delete cnchess-worker 2>/dev/null || true
pm2 start ecosystem.config.cjs --only cnchess-worker
pm2 save

echo ""
echo "============================================"
echo "  Worker 部署完成！"
echo ""
echo "  Worker ID:  ${WORKER_ID}"
echo "  Master:     ${MASTER_URL}"
echo "  并发对局:   2"
echo ""
echo "  管理命令:"
echo "    pm2 logs cnchess-worker   # 查看日志"
echo "    pm2 restart cnchess-worker # 重启"
echo "    pm2 stop cnchess-worker    # 停止"
echo ""
echo "  设置开机自启:"
echo "    pm2 startup"
echo "============================================"
