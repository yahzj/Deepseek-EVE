# 股市系统 · 联调部署契约（Go 交易所 ↔ Node 主服务 ↔ 桌面前端）

> 状态：执行中（2026-11-03 船长目标：Go 后端做好、部署上线、对接前端）
> 上游：`stock-exchange-go-migration-20261103.md`、`stock-exchange-backend-spec-20261103.md`、`stock-exchange-server-20261103.md`

---

## 一、部署拓扑（生产服务器 123.207.188.192）

```
客户端 ──HTTPS──▶ nginx:443（shit.fuckrapper.online，自签/自定义证书）
                     │
                     ├─ /api/exchange/*  ──▶ Go 交易所 127.0.0.1:8788（WS 升级同样支持）
                     ├─ /internal/*      ──▶ 404（外部一律拒绝）
                     └─ /*               ──▶ Node 主服务 127.0.0.1:8787
```

- Node 主服务：账号/session、云存档、聊天、钱包、账本（**资金唯一写者**）、现货市场。
- Go 交易所：订单簿/撮合/行情/持仓/入金出金闸门（**不直接写钱包/账本**）。
- `/` 前缀除 `/api/exchange/` 外全部走 Node，**生产 8787 不重启、不改路由**。
- 8789 dev 实例保留作对照；Go 首次上线用 8788。

---

## 二、鉴权契约（Go 读 Node 库，只读）

- 前端所有交易所请求带 `Authorization: Bearer <token>`（与云存档同一个 token）。
- Node 会话存储：`sessions(token_hash TEXT, account_id INTEGER, last_seen_at, expires_at, ...)`，`token_hash = sha256hex(token)`（见 Node `src/auth.ts`）。
- Go 以只读方式打开 Node 库：`WHALE_AUTH_DB=/home/ubuntu/whale-server/data/whale-server.db`；校验：
  1. `sha256hex(token)` 命中 `sessions`；
  2. `expires_at > now`（过期拒绝 401）；
  3. 取 `account_id` 作为交易所账户 ID。
- **不续期、不写 Node 库**（续期由 Node 侧正常请求触发）；未命中再回落到 `accounts.token_hash`（旧单 token）。
- token 缺失/非法：`401 {code:'unauthorized'}`。

---

## 三、资金契约（Node 唯一写者，Go 通过内部接口过闸门）

| 方向 | 流程 |
|---|---|
| 入金（钱包→交易所） | 前端 POST Go `/api/exchange/deposit` → Go 调 Node `POST /internal/exchange/wallet-debit`（幂等 nonce）→ Node 事务扣钱包 + 写账本 → Go 本地事务加 exchange cash |
| 出金（交易所→钱包） | 前端 POST Go `/api/exchange/withdraw` → Go 本地扣 cash → 调 Node `POST /internal/exchange/wallet-credit` → Node 事务加钱包 + 写账本 |
| 成交结算 | Go 只在自身 DB 内划转（cash/frozen/持仓）；每笔成交记 `settle_batch_id`，阶段 2 再做批量对账 |

Node 内部接口（**仅 localhost + 共享密钥**）：
- 头：`x-internal-secret: $WHALE_INTERNAL_SECRET`
- `POST /internal/exchange/wallet-debit`  `{accountId, amount, nonce}` → `{ok:true, balance}`；余额不足 409 `insufficient_funds`；重复 nonce 幂等返回首次结果
- `POST /internal/exchange/wallet-credit` `{accountId, amount, nonce}` → `{ok:true, balance}`
- 新表 `internal_transfers(nonce TEXT PRIMARY KEY, kind TEXT, account_id INTEGER, amount INTEGER, balance_after INTEGER, created_at INTEGER)`
- nginx 必须对 `/internal/` 返回 404；Node 侧再校验 `x-internal-secret` 与来源 127.0.0.1 双保险。
- 失败策略：Node 调用失败/超时 → Go 本地回滚，返回 503 `wallet_unavailable`，**不得出现单边扣款**。

---

## 四、前端 API 契约（以 `HttpExchangeClient.ts` 为准，Go 必须全实现）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/exchange/stocks` | 4 标的行情（含指数） |
| GET | `/api/exchange/book/{code}` | 五档 |
| GET | `/api/exchange/trades/{code}?limit=50` | 最近成交 |
| GET | `/api/exchange/klines/{code}?interval=&limit=` | K 线（1m/5m/1h，与前端枚举一致） |
| GET | `/api/exchange/account` | cash/frozen/debt/equity/holdings |
| GET | `/api/exchange/orders` | 我的委托（= G0 的 `/orders/mine`，加别名） |
| POST | `/api/exchange/orders` | 下单 |
| DELETE | `/api/exchange/orders/{id}` | 撤单 |
| POST | `/api/exchange/deposit` `{amount,nonce}` | 入金 |
| POST | `/api/exchange/withdraw` `{amount,nonce}` | 出金 |
| POST | `/api/exchange/positions/{code}/{side}/close` | 平仓（B0 现货可先按卖出持仓实现） |
| GET/POST/DELETE | `/api/exchange/strategies` | 量化模板 CRUD（先持久化占位实现） |
| GET | `/api/exchange/meta` | 契约版本、费率、服务器时间 |
| WS | `/api/exchange/stream?codes=&topics=&throttle=` | 行情/盘口/成交/账户/委托推送 |

- 响应字段以 `client.ts` 类型与 `HttpExchangeClient` 解析为准；错误统一 `{code,message}`。
- 前端现有 `Transport` 由桌面主进程注入（F1）；本轮先在渲染层提供 fetch+WS 实现并保留 Mock 双轨，**不改 Mock 与 UI 布局**。

---

## 五、行情引擎（Go 侧）

- 4 标的：对数随机游走 + 肥尾 + EWMA 波动 + 均值回归锚点 + 泊松事件（与设计稿同口径，整数价格）。
- 1 秒 tick（撮合/盘口/成交推送），K 线按 1m/5m/1h 聚合，启动时补齐历史 K 线（确定性种子）。
- 撮合与行情在 Go 进程内；行情线程与撮合线程按标的串行（单写者）。
- 重启从 SQLite 恢复挂单/seq/最新价/K 线。

---

## 六、验收

1. `go test -race ./...`、`go vet` 全绿；Node `npm test` 全绿（新增内部接口用例）。
2. 生产：`curl https://shit.fuckrapper.online/api/exchange/stocks` 返回 4 标的；`/internal/*` 外部 404。
3. 端到端：登录账号 → 入金 → 限价挂单 → 另一账号成交 → 双方钱包/持仓/账本一致 → 撤单/出金；WS 每秒收到行情。
4. 故障演练：停 Go → 前端显示离线错误、Node 其他功能不受影响；起 Go → 恢复挂单。
5. 回滚：nginx 去掉 exchange location 即回到纯 Node，游戏功能无损。
