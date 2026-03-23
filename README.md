# 象棋擂台 — Chinese Chess Engine Arena

自托管的中国象棋引擎锦标赛平台。上传 UCI 引擎，自动对战，实时观看，Elo 排行。

## 功能

- **引擎锦标赛** — 循环赛自动对战，支持自定义时间控制（总时间+每步加秒）
- **实时对战** — WebSocket 推送，浏览器实时观看引擎对弈
- **Elo 排行榜** — 全局引擎 Elo 评分，跨锦标赛累计
- **对局回放** — 完整棋谱记录，评估值曲线，逐步回放
- **交叉表** — 锦标赛引擎间胜负一目了然
- **多用户** — 邀请码注册，每人管理自己的引擎

## 快速开始

### 环境要求

- Node.js >= 18
- npm / pnpm / yarn

### 一键部署

```bash
git clone <your-repo-url> cnchess
cd cnchess
./scripts/setup.sh
```

脚本会自动：安装依赖 → 创建 `.env` → 下载默认引擎（Pikafish）→ 构建项目 → 提示启动

### 手动安装

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，设置 INVITE_CODE 和 JWT_SECRET

# 3. 开发模式
npm run dev

# 4. 生产模式
npm run build
npm start
```

服务启动后访问 `http://localhost:3000`。

### 首次使用

1. 打开 `http://your-server:3000/register`
2. 用你设置的邀请码注册（第一个用户自动成为管理员）
3. 在「引擎」页面上传引擎二进制文件
4. 在「锦标赛」页面创建锦标赛、添加引擎、开始对战

## 下载默认引擎

```bash
./scripts/download-engines.sh
```

会下载 Pikafish（当前最强开源象棋引擎，Elo ~3950）到 `data/default-engines/` 目录。

## 引擎接入指南

平台支持任何兼容 **UCI (Universal Chess Interface)** 协议的象棋引擎。

### 最简引擎示例

引擎就是一个可执行文件，通过 stdin/stdout 和平台通信：

```
平台 → 引擎:  uci
引擎 → 平台:  id name MyEngine
               id author Me
               uciok

平台 → 引擎:  isready
引擎 → 平台:  readyok

平台 → 引擎:  position startpos moves h2e2 h9g7
平台 → 引擎:  go wtime 300000 btime 300000 winc 3000 binc 3000
引擎 → 平台:  info depth 10 score cp 35 pv e2e6
               bestmove e2e6

平台 → 引擎:  quit
```

### 用 Python 写一个最简引擎

```python
#!/usr/bin/env python3
"""最简象棋引擎示例 — 随机走子"""
import sys
import random

def parse_fen(fen):
    """解析 FEN 字符串（简化版）"""
    # 你的棋盘解析逻辑
    pass

def generate_moves(board, color):
    """生成所有合法走子"""
    # 你的走法生成逻辑
    # 返回 UCI 格式走法列表，如 ["h2e2", "b0c2", ...]
    return ["h2e2"]  # 占位

def main():
    board = None
    moves = []

    for line in sys.stdin:
        line = line.strip()

        if line == "uci":
            print("id name RandomEngine")
            print("id author Me")
            print("uciok")
            sys.stdout.flush()

        elif line == "isready":
            print("readyok")
            sys.stdout.flush()

        elif line.startswith("position"):
            # 解析局面
            parts = line.split()
            if "startpos" in parts:
                board = parse_fen("rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w - - 0 1")
                idx = parts.index("startpos") + 1
                if idx < len(parts) and parts[idx] == "moves":
                    moves = parts[idx + 1:]

        elif line.startswith("go"):
            # 生成走法并选择（这里随机选）
            legal = generate_moves(board, "red")
            move = random.choice(legal)
            print(f"info depth 1 score cp 0")
            print(f"bestmove {move}")
            sys.stdout.flush()

        elif line == "quit":
            break

if __name__ == "__main__":
    main()
```

保存为 `my_engine.py`，确保可执行：

```bash
chmod +x my_engine.py
```

然后在引擎页面上传即可。

### UCI 坐标格式

象棋棋盘坐标：列 a-i（从左到右），行 0-9（0=红方底线，9=黑方底线）

```
  a b c d e f g h i
9 r h e a k a e h r   ← 黑方
8 . . . . . . . . .
7 . c . . . . . c .
6 p . p . p . p . p
5 . . . . . . . . .
4 . . . . . . . . .
3 P . P . P . P . P
2 . C . . . . . C .
1 . . . . . . . . .
0 R H E A K A E H R   ← 红方
```

走法格式：`起始列行目标列行`，例如 `h2e2`（炮二平五）

### 用其他语言实现

引擎可以用任何语言编写，只要满足：
1. 编译为可执行文件（或用 shebang 指定解释器如 `#!/usr/bin/env python3`）
2. 通过 stdin 接收命令，stdout 输出响应
3. 实现上述 UCI 协议最小子集

推荐参考：
- [Pikafish](https://github.com/official-pikafish/Pikafish) — C++，当前最强
- [Wukong Xiangqi](https://github.com/maksimKorzh/wukong-xiangqi) — JavaScript，教学用

## 技术栈

- **Next.js 16** — TypeScript 全栈框架
- **SQLite** (better-sqlite3) — 零配置数据库
- **WebSocket** (ws) — 实时推送
- **Tailwind CSS + shadcn/ui** — UI 组件
- **Recharts** — 数据可视化

## 部署到 VPS

```bash
# 在 VPS 上
git clone <your-repo-url> cnchess
cd cnchess
./scripts/setup.sh

# 使用 pm2 保持运行
npm install -g pm2
pm2 start "npm start" --name cnchess
pm2 save
pm2 startup
```

### 反向代理 (Nginx)

```nginx
server {
    listen 80;
    server_name chess.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

注意 `proxy_set_header Upgrade/Connection` 是 WebSocket 必需的。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `INVITE_CODE` | `changeme` | 注册邀请码 |
| `JWT_SECRET` | `dev-secret-change-me` | JWT 签名密钥（生产环境必须更改） |
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `MAX_CONCURRENT_MATCHES` | `2` | 最大同时进行的对战数 |
| `ENGINE_UPLOAD_MAX_SIZE_MB` | `50` | 引擎文件大小限制 (MB) |

## License

MIT
