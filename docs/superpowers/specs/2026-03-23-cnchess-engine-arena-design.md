# 中国象棋引擎锦标赛平台 — 设计文档

## 概述

本地/自托管的中国象棋引擎锦标赛平台。用户通过 Web 界面上传 UCI 协议引擎二进制文件，平台自动编排循环赛、实时展示对战过程、计算 Elo 排名。部署到 VPS 后支持多用户通过浏览器访问。

## 核心需求

- 用户上传引擎二进制文件，通过 UCI 协议通信
- 循环赛（Round Robin）赛制，每对引擎对战 N 轮，红黑互换
- 时间控制：总时间 + 每步加秒
- 实时棋盘可视化、Elo 排行榜、对局回放棋谱、锦标赛交叉表
- 轻量用户认证（邀请码注册）
- 赛制后续可扩展（淘汰赛、天梯赛等）

## 技术选型

| 层面 | 选型 | 理由 |
|------|------|------|
| 框架 | Next.js (App Router) + 自定义 server.ts | TypeScript 全栈，自定义服务器包装以支持 WebSocket upgrade |
| 棋盘渲染 | chessgroundx | Lichess 血统，支持象棋，拖拽/点击/动画 |
| 数据库 | SQLite (better-sqlite3) | 零配置，单文件，本地场景完美匹配 |
| 引擎管理 | node:child_process | spawn 引擎子进程，stdin/stdout 交互 UCI 协议 |
| 实时通信 | WebSocket (ws) | 走子、评估值、对战状态实时推送 |
| 认证 | JWT + cookie | 无需外部服务，邀请码注册 |
| 走法验证 | 纯 TypeScript 实现 | 避免 Python/C++ 外部依赖 |

## 架构

单进程 Monorepo 架构。Next.js 应用承载所有职责：页面渲染、API、WebSocket、引擎调度。

```
Browser (用户)
  │ HTTP/REST + WebSocket
  ▼
Next.js 应用 (单进程)
  ├── 页面路由 (React)
  ├── API 路由 (REST)
  ├── WebSocket 服务 (实时推送)
  ├── 核心服务层
  │   ├── MatchEngine    — 单局对战管理
  │   ├── Tournament     — 锦标赛编排与调度
  │   └── EloCalculator  — Elo 评分计算
  ├── UCI 引擎管理器
  │   └── child_process spawn，stdin/stdout 协议交互
  └── SQLite (better-sqlite3)
        └── users / engines / tournaments / tournament_entries / games
```

引擎二进制文件存储在 `data/engines/{userId}/{engineId}/` 目录。

## 数据模型

### users

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | nanoid |
| username | TEXT UNIQUE | 用户名 |
| password | TEXT | bcrypt hash |
| role | TEXT | 'admin' \| 'user' |
| created_at | INTEGER | unix timestamp |

### engines

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | nanoid |
| user_id | TEXT FK | 所属用户 |
| name | TEXT | 引擎显示名称 |
| binary_path | TEXT | 二进制文件相对路径 |
| elo | REAL | 当前 Elo，默认 1500 |
| games_played | INTEGER | 总对局数 |
| uploaded_at | INTEGER | 上传时间 |

### tournaments

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | nanoid |
| name | TEXT | 锦标赛名称 |
| status | TEXT | 'pending' \| 'running' \| 'finished' |
| time_control_base | INTEGER | 基础时间（毫秒） |
| time_control_inc | INTEGER | 每步加秒（毫秒） |
| rounds | INTEGER | 每对引擎对战局数 |
| created_at | INTEGER | 创建时间 |
| finished_at | INTEGER | 结束时间 |

### tournament_entries

| 字段 | 类型 | 说明 |
|------|------|------|
| tournament_id | TEXT FK | 锦标赛 ID |
| engine_id | TEXT FK | 引擎 ID |
| final_rank | INTEGER | 最终排名 |
| score | REAL | 总得分（胜1/和0.5/负0） |
| PK | (tournament_id, engine_id) | 复合主键 |

### games

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | nanoid |
| tournament_id | TEXT FK | 所属锦标赛 |
| red_engine_id | TEXT FK | 红方引擎 |
| black_engine_id | TEXT FK | 黑方引擎 |
| result | TEXT | 'red' \| 'black' \| 'draw' \| null(进行中) |
| moves | TEXT | JSON 数组 [{move, fen, time_ms, eval}] |
| red_time_left | INTEGER | 红方剩余时间（毫秒） |
| black_time_left | INTEGER | 黑方剩余时间（毫秒） |
| started_at | INTEGER | 开始时间 |
| finished_at | INTEGER | 结束时间 |

## 前端页面

| 路由 | 页面 | 功能 |
|------|------|------|
| `/` | 首页 | 全局 Elo 排行榜、正在进行的对战、最近完成的锦标赛 |
| `/tournaments` | 锦标赛列表 | 状态筛选、创建新锦标赛 |
| `/tournaments/:id` | 锦标赛详情 | 交叉表、参赛引擎、对局列表、进度 |
| `/games/:id` | 对局页面 | 实时棋盘 + 走子记录 + 评估值曲线 + 双方用时 + 回放控制 |
| `/engines` | 引擎管理 | 上传引擎、我的引擎列表、Elo 历史曲线 |
| `/login` `/register` | 认证 | 用户名密码登录、邀请码注册 |

### 对局页面布局

左右分栏：
- 左侧：黑方信息栏（引擎名 + 剩余时间）→ chessgroundx 棋盘 → 红方信息栏
- 右侧：走子记录列表 → 评估值曲线图 → 回放控制条（首步/上步/下步/末步）

## 核心流程

### 锦标赛运行

1. 创建锦标赛：设定名称、时控（总时间+加秒）、每对轮次
2. 添加参赛引擎：从已上传的引擎中选择
3. 启动锦标赛：生成循环赛对阵表。N 个引擎 → N*(N-1)/2 对，每对打 R 轮（红黑各半）
4. 逐局调度执行，每局完成后更新 Elo 和得分
5. 全部对局完成后，生成最终排名和交叉表

### 单局对战

1. spawn 红方/黑方引擎子进程
2. 初始化：`uci` → 等待 `uciok` → `isready` → 等待 `readyok`
3. 对战循环：
   - 发送 `position startpos moves ...`
   - 发送 `go wtime X btime Y winc Z binc W`
   - 解析引擎输出的 `info score cp/mate` 行，记录评估值到 moves 中的 eval 字段
   - 等待 `bestmove <move>`
   - 验证走法合法性（TypeScript 规则引擎）
   - 通过 WebSocket 推送走子给前端
   - 检查终局条件：将死、和棋（重复局面/无子可动/60回合无吃子）、超时、非法走法
   - 注：长将判负（连续将军 3 次），简化处理，不实现完整的长捉规则
4. 记录结果，kill 引擎进程

### Elo 计算

使用标准 Elo 公式，K=32：
- 期望胜率：`E = 1 / (1 + 10^((Rb - Ra) / 400))`
- 新 Elo：`Ra' = Ra + K * (S - E)`，其中 S 为实际得分（胜1/和0.5/负0）
- Elo 为全局评分，跨锦标赛累计。`tournament_entries.score` 为单场锦标赛内的得分

## 用户认证

- 注册：用户名 + 密码 + 邀请码。邀请码通过环境变量 `INVITE_CODE` 配置
- 登录：用户名 + 密码，验证后签发 JWT，存入 httpOnly cookie
- 权限：admin 可创建/管理锦标赛；user 可上传引擎、查看所有数据
- 首个注册用户自动成为 admin

## 上传安全

- 文件大小限制：默认 50MB
- 存储隔离：`data/engines/{userId}/{engineId}/` 目录
- 上传后自动设置可执行权限 (`chmod +x`)
- 并发控制：根据配置限制同时运行的对战数（默认 2）
- 引擎进程资源限制：超时强制 kill、限制内存使用（可选 ulimit）
- 安全说明：本平台面向受信任的小圈子用户，不实现完整沙箱。如需更高安全性，可后续引入 firejail/nsjail

## 项目结构

```
cnchess/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── page.tsx          # 首页
│   │   ├── tournaments/
│   │   ├── games/
│   │   ├── engines/
│   │   └── (auth)/
│   ├── components/
│   │   ├── Board.tsx         # chessgroundx 棋盘封装
│   │   ├── MoveList.tsx      # 走子记录
│   │   ├── EvalChart.tsx     # 评估值曲线
│   │   ├── CrossTable.tsx    # 交叉表
│   │   └── Leaderboard.tsx   # 排行榜
│   ├── server/
│   │   ├── uci.ts            # UCI 协议驱动
│   │   ├── match.ts          # 单局对战管理
│   │   ├── tournament.ts     # 锦标赛编排与调度
│   │   ├── elo.ts            # Elo 计算
│   │   ├── rules.ts          # 象棋规则验证（纯 TS）
│   │   └── ws.ts             # WebSocket 服务
│   ├── db/
│   │   ├── schema.ts         # 表定义
│   │   └── index.ts          # better-sqlite3 初始化
│   └── lib/
│       ├── fen.ts            # FEN 解析/生成
│       └── types.ts          # 类型定义
├── data/
│   └── engines/              # 引擎二进制文件
├── cnchess.db                # SQLite 数据库
├── package.json
├── tsconfig.json
└── next.config.ts
```
