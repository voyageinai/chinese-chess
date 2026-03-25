# API 完整参考

BASE_URL 默认: `http://localhost:3000`

---

## 认证

### POST /api/auth/login
**认证**: 无需
```json
// 请求
{ "username": "string", "password": "string" }
// 响应 200
{ "user": { "id": "string", "username": "string", "role": "admin|user" } }
// 副作用: Set-Cookie: token=xxx (HttpOnly, 7天)
```

### POST /api/auth/register
**认证**: 无需
```json
// 请求
{ "username": "string (2-32字符)", "password": "string (≥6字符)", "inviteCode": "string" }
// 响应 201
{ "user": { "id": "string", "username": "string", "role": "admin|user" } }
```

### GET /api/auth/me
**认证**: 需要
```json
// 响应 200
{ "user": { "id": "string", "username": "string", "role": "admin|user" } }
```

---

## 游戏

### GET /api/games
**认证**: 无需
| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| engineId | string | - | 按引擎过滤 |
| result | string | - | "red" / "black" / "draw" |
| page | number | 1 | 页码 |
| limit | number | 20 | 每页条数（最大 100） |

```json
// 响应 200
{
  "games": [{ "id": "", "red_engine_id": "", "black_engine_id": "", "result": "", "result_reason": "", ... }],
  "total": 0, "page": 1, "limit": 20, "totalPages": 0
}
```

### GET /api/games/[id]
**认证**: 无需
```json
// 响应 200
{
  "game": { "id": "", "moves": "[...]", "result": "", "result_reason": "", ... },
  "redEngine": { "id": "", "name": "", ... },
  "blackEngine": { "id": "", "name": "", ... }
}
```
**注意**: `moves` 是 JSON 字符串，需 `JSON.parse()`。每步含 `move`(UCI)、`fen`、`eval`(红方视角)、`time_ms`。

### GET /api/games/export
**认证**: 无需
| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| engineId | string | - | 按引擎过滤 |
| result | string | - | 按结果过滤 |
| format | string | "json" | "json" 或 "pgn" |

最多导出 1000 场。

---

## 引擎

### GET /api/engines
**认证**: 需要
| 参数 | 说明 |
|------|------|
| scope=owned | 仅返回自己的引擎 |
| status=active / disabled | 仅在 `scope=owned` 时有效，用于按状态过滤自己的引擎 |
| (无 scope) | 返回所有可见引擎 |

```json
// 响应 200
{ "engines": [{ "id": "", "name": "", "elo": 1500, "games_played": 0, "user_id": "", ... }] }
```

### POST /api/engines
**认证**: 需要 | **Content-Type**: multipart/form-data
| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 引擎名称 |
| file | File | 引擎可执行文件 |

验证流程（服务端自动执行）：
1. UCI 握手: `uci` → `uciok`，检测 `UCI_Variant`
2. 就绪检查: `isready` → `readyok`
3. 坐标探测: 从初始局面走一步，验证坐标系兼容性

```json
// 响应 201
{ "engine": { "id": "", "name": "", ... } }
// 失败 422: 坐标系不兼容
// 失败 413: 文件过大
```

### GET /api/engines/[id]
**认证**: 无需
```json
// 响应 200
{ "engine": { "id": "", "name": "", "elo": 1500, ... } }
```

### DELETE /api/engines/[id]
**认证**: 需要（所有者或管理员）
```json
// 响应 200
{ "success": true }
// 失败 409: 引擎已被锦标赛或游戏使用
```

### GET /api/engines/[id]/history
**认证**: 无需
```json
// 响应 200
{
  "engine": { "id": "", "name": "" },
  "history": [{ "elo": 1500, "recorded_at": 0 }]
}
```
最多 100 条记录。

---

## 锦标赛

### GET /api/tournaments
**认证**: 无需
```json
// 响应 200
{ "tournaments": [{ "id": "", "name": "", "status": "pending|running|finished|cancelled", ... }] }
```

### POST /api/tournaments
**认证**: 需要
```json
// 请求
{
  "name": "string",
  "timeBase": 60,       // 秒
  "timeInc": 1,         // 秒
  "rounds": 1,          // 可选，默认 1
  "format": "round_robin", // 可选: round_robin | knockout | gauntlet | swiss
  "engineIds": ["id1", "id2"], // 可选，初始引擎
  "autoStart": true     // 可选，≥2 引擎时自动启动
}
// 响应 201
{ "tournament": { "id": "", ... } }
```

### GET /api/tournaments/[id]
**认证**: 无需
```json
// 响应 200
{
  "tournament": { ... },
  "entries": [{ "tournament_id": "", "engine_id": "", "final_rank": 1, "score": 0 }],
  "games": [{ ... }]
}
```

### PUT /api/tournaments/[id]
**认证**: 需要（所有者或管理员）| 锦标赛须为 pending 状态
```json
// 请求: 添加引擎
{ "engineId": "string" }
// 响应 200
{ "success": true }
```

### POST /api/tournaments/[id]
**认证**: 需要（所有者或管理员）| 锦标赛须为 pending + ≥2 引擎
```json
// 响应 200（启动锦标赛，后台异步运行）
{ "success": true, "message": "..." }
```

### GET /api/tournaments/[id]/games
**认证**: 无需
```json
// 响应 200
{ "games": [{ ... }] }
```

---

## 快速对弈

### POST /api/quick-match
**认证**: 需要

**格式 1 — 自动配对（推荐）**:
```json
{
  "engineId": "string",     // 你的引擎
  "gameCount": 1,           // 可选，默认 1
  "timeBase": 60,           // 可选，默认 60 秒
  "timeInc": 1,             // 可选，默认 1 秒
  "label": "string"         // 可选，标签
}
```

**格式 2 — 定级赛（手动指定对手）**:
```json
{
  "engineId": "string",
  "label": "定级赛",
  "opponentIds": ["id1", "id2"], // 最多 10 个对手
  "timeBase": 60,
  "timeInc": 1
}
```

**格式 3 — 指定多引擎（遗留）**:
```json
{
  "engineIds": ["id1", "id2"],  // 2-4 个引擎
  "timeBase": 60,
  "timeInc": 1
}
```

```json
// 响应 201
{
  "tournament": { "id": "", ... },
  "gameId": "string",  // 仅单局时返回
  "message": "..."
}
```

---

## 排行榜

### GET /api/leaderboard
**认证**: 无需
```json
// 响应 200
{
  "leaderboard": [{
    "id": "", "name": "", "elo": 1500, "games_played": 0,
    "owner": "username", "elo_delta": 0
  }]
}
```

---

## 管理员接口

所有管理员接口需要 admin 角色。

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | /api/admin/users | 用户列表 |
| PATCH | /api/admin/users/[id] | 修改角色/状态 `{role?,status?,reason?}` |
| GET | /api/admin/engines | 所有引擎（含私有） |
| PATCH | /api/admin/engines/[id] | 修改状态 `{status,reason?}` |
| GET | /api/admin/invites | 邀请码列表 |
| POST | /api/admin/invites | 生成邀请码 `{expiresInDays?}` → `{code,expiresAt}` |
| DELETE | /api/admin/invites/[code] | 删除未使用的邀请码 |
| GET | /api/admin/audit-logs | 审计日志 `?action=&actorId=&limit=100&offset=0` |
| DELETE | /api/admin/tournaments/[id] | 删除 pending 锦标赛 |
| POST | /api/admin/tournaments/[id]/cancel | 取消 running 锦标赛 |
| GET | /api/admin/system | 系统统计 `{userCount,engineCount,gameCount,runningTournaments}` |

---

## WebSocket 协议

**连接**: `ws://{host}/ws`（无需认证）

### 客户端 → 服务端
```json
{ "type": "subscribe", "gameId": "string" }
{ "type": "unsubscribe", "gameId": "string" }
```

### 服务端 → 客户端

**move** — 每步棋推送
```json
{
  "type": "move",
  "gameId": "string",
  "move": "h9g7",          // UCI 格式
  "fen": "string",
  "eval": 0.5,             // 红方视角，centipawn
  "depth": 20,
  "nodes": 1000000,
  "pv": "h9g7 c6c5",      // 主变着
  "redTime": 58000,        // 毫秒
  "blackTime": 59000,      // 毫秒
  "timeMs": 2000,          // 本步耗时
  "ply": 1,
  "movedAt": 1711000000000
}
```

**game_start**
```json
{
  "type": "game_start",
  "gameId": "string",
  "redEngine": "EngineName",
  "blackEngine": "EngineName",
  "redTime": 60000,
  "blackTime": 60000,
  "startFen": "string"     // 可选
}
```

**game_end**
```json
{
  "type": "game_end",
  "gameId": "string",
  "result": "red|black|draw",
  "reason": "checkmate|timeout|stalemate|perpetual_check|threefold_repetition|..."
}
```

**tournament_end**
```json
{ "type": "tournament_end", "tournamentId": "string" }
```

**engine_thinking** — 高频，仅订阅者收到
```json
{
  "type": "engine_thinking",
  "gameId": "string",
  "side": "red|black",
  "depth": 15,
  "eval": 0.3,
  "nodes": 500000,
  "pv": "h2e2 h9g7"
}
```

### 连接管理
- 服务端每 25 秒发送 ping，客户端需响应 pong
- `game_start` / `game_end` / `tournament_end` 全局广播（所有连接都收到）
- `move` 全局广播
- `engine_thinking` 仅推送给订阅了该 gameId 的连接

---

## 统一错误格式

所有错误：
```json
{ "error": "错误描述" }
```

| 状态码 | 含义 |
|--------|------|
| 400 | 参数错误 |
| 401 | 未认证 |
| 403 | 无权限 / 被封禁 |
| 404 | 资源不存在 |
| 409 | 冲突（引擎已使用等） |
| 413 | 文件过大 |
| 422 | 验证失败（引擎坐标系不兼容） |
| 500 | 服务器错误 |
