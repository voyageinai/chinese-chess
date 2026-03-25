---
name: xiangqi-agent
description: When user wants to interact with the xiangqi platform API, query game data, manage engines or tournaments, monitor live games, or build an AI agent integration for the Chinese chess platform
user_invocable: true
---

# Xiangqi Platform Agent

通过 HTTP API 和 WebSocket 与象棋对弈平台交互。支持查询数据、管理引擎、创建锦标赛、监控实时对局。

## 前置条件

- 平台运行中（默认 `http://localhost:3000`，可通过用户指定覆盖）
- 若需要写操作，用户须提供账号密码

## 认证流程

平台使用 **HTTP-only Cookie** 认证（不是 Bearer Token），必须先登录获取 cookie：

```bash
# 登录并保存 cookie（cookie 有效期 7 天）
curl -c /tmp/xiangqi-cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "USER", "password": "PASS"}'

# 后续所有需要认证的请求必须携带 cookie
curl -b /tmp/xiangqi-cookies.txt http://localhost:3000/api/engines?scope=owned
```

**重要**：先问用户要凭据，不要猜测。如果用户没有账号，需要邀请码注册。

## 操作速查

### 公开查询（无需认证）

```bash
# 排行榜
curl $BASE/api/leaderboard

# 游戏列表（支持分页和过滤）
curl "$BASE/api/games?page=1&limit=20&engineId=xxx&result=red"

# 游戏详情（含完整走法和引擎信息）
curl $BASE/api/games/{id}

# 锦标赛列表 & 详情
curl $BASE/api/tournaments
curl $BASE/api/tournaments/{id}

# 引擎 Elo 历史
curl $BASE/api/engines/{id}/history

# 导出游戏（JSON 或 PGN，最多 1000 场）
curl "$BASE/api/games/export?format=pgn&engineId=xxx" > games.pgn
```

### 写操作（需认证）

```bash
# 查看自己的引擎
curl -b $COOKIE "$BASE/api/engines?scope=owned"

# 仅查看自己可选的 active 引擎
curl -b $COOKIE "$BASE/api/engines?scope=owned&status=active"

# 上传引擎（multipart，服务端会实际运行引擎验证 UCI 协议，耗时 ~10s）
curl -b $COOKIE -X POST $BASE/api/engines \
  -F "name=MyEngine" -F "file=@/path/to/engine"

# 创建锦标赛（时间单位：秒）
curl -b $COOKIE -X POST $BASE/api/tournaments \
  -H "Content-Type: application/json" \
  -d '{"name":"测试赛","timeBase":60,"timeInc":1,"rounds":2,"engineIds":["id1","id2"],"autoStart":true}'

# 排位赛（系统自动配对对手）
curl -b $COOKIE -X POST $BASE/api/quick-match \
  -H "Content-Type: application/json" \
  -d '{"engineId":"ENGINE_ID","timeBase":60,"timeInc":1}'

# 定级赛（手动指定对手）
curl -b $COOKIE -X POST $BASE/api/quick-match \
  -H "Content-Type: application/json" \
  -d '{"engineId":"ENGINE_ID","label":"定级赛","opponentIds":["id1","id2"],"timeBase":60,"timeInc":1}'

# 删除引擎（不能删除已参赛的引擎）
curl -b $COOKIE -X DELETE $BASE/api/engines/{id}
```

### 实时监控（WebSocket）

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

// 订阅特定对局
ws.send(JSON.stringify({ type: 'subscribe', gameId: 'xxx' }));

// 消息类型：move | game_start | game_end | tournament_end | engine_thinking
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'move':
      // msg.move (UCI格式), msg.fen, msg.eval (红方视角), msg.redTime, msg.blackTime (毫秒)
      break;
    case 'game_end':
      // msg.result ("red"|"black"|"draw"), msg.reason
      break;
  }
};
```

## 常用工作流

### 工作流 1：发起对弈并监控

1. 登录获取 cookie
2. `GET /api/engines?scope=owned&status=active` 查看可用引擎
3. `POST /api/quick-match` 发起对弈，记录返回的 `gameId`
4. WebSocket 订阅 `gameId`，实时接收走步
5. 收到 `game_end` 消息后，`GET /api/games/{gameId}` 获取完整对局

### 工作流 2：批量分析引擎表现

1. `GET /api/engines/{id}/history` 获取 Elo 趋势
2. `GET /api/games?engineId={id}&limit=100` 获取该引擎所有对局
3. 统计胜率、常见败因（`result_reason` 字段）
4. 可用 `GET /api/games/export?engineId={id}&format=pgn` 导出 PGN 做深入分析

### 工作流 3：组织锦标赛

1. `GET /api/engines` 查看所有可用引擎
2. `POST /api/tournaments` 创建锦标赛（含 engineIds + autoStart）
3. WebSocket 监听 `game_start` / `game_end` / `tournament_end`
4. `GET /api/tournaments/{id}` 查看交叉表和最终排名

## 关键陷阱

### 1. 时间单位不一致
| 场景 | 单位 |
|------|------|
| API 输入（timeBase/timeInc） | **秒** |
| WebSocket 返回（redTime/blackTime） | **毫秒** |
| 数据库存储（time_ms） | **毫秒** |

**调用 API 时始终用秒，不要自作聪明乘 1000。**

### 2. Eval 始终红方视角
正值 = 红方优势，负值 = 黑方优势。数据库已经做过翻转，**不要再次翻转**。

### 3. Cookie 不是 Token
- 不支持 `Authorization: Bearer xxx`
- 必须用 `-b cookies.txt` 方式携带
- Cookie 7 天过期，长期 agent 需要定期重新登录

### 4. 引擎上传会实际运行
上传不是简单的文件存储，服务端会：
1. 启动引擎进程
2. 完成 UCI 握手（10 秒超时）
3. 走一步棋验证坐标系
验证失败 = 上传失败，引擎被删除。

### 5. 排位赛和定级赛不是一回事
- 排位赛: 系统按 Elo 自动选择对手，不会选同一用户的引擎
- 定级赛: 可通过 `POST /api/quick-match` + `label="定级赛"` + `opponentIds` 手动指定对手
- 如需完整赛制控制，再用普通锦标赛

## 构建长期 Agent 集成的建议

1. **Cookie 续期** — 写一个定时任务，每 6 天重新登录刷新 cookie
2. **WebSocket 心跳** — 服务端每 25 秒 ping，确保客户端响应 pong
3. **错误重试** — 所有错误返回 `{ error: string }`，可据此重试
4. **分页遍历** — 游戏列表最大 limit=100，超过需翻页

## 完整 API 参考

详见 [api-reference.md](api-reference.md)，包含所有端点的完整参数和返回格式。

## 规则

- 执行写操作前，先确认用户已登录（或代为登录）
- 不要硬编码 base URL，始终用变量，默认 `http://localhost:3000`
- 时间参数传秒，不要转毫秒
- 上传引擎前告知用户验证流程可能耗时 10+ 秒
- 查询大量数据时使用分页，不要一次拉全部
- 展示 eval 时注明"红方视角"，避免误解
