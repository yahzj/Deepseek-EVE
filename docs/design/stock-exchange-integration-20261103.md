# 股市系统 · 联调部署契约（Go 交易所 ↔ Node 主服务 ↔ 桌面前端）

> 状态：执行中（2026-11-03 船长目标：Go 后端做好、部署上线、对接前端）
> 上游：`stock-exchange-go-migration-20261103.md`、`stock-exchange-backend-spec-20261103.md`、`stock-exchange-server-20261103.md`

---

## 一、部署拓扑（生产服务器 123.207.188.192）

```
客户端 ──HTTPS──▶ nginx:8443（game.bajibaji.party:8443，Let's Encrypt 正式证书；80/443 被腾讯云按未备案域名拦截，2026-11-05 起走 8443）
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
2. 生产：`curl https://game.bajibaji.party:8443/api/exchange/stocks` 返回 4 标的；`/internal/*` 外部 404。
3. 端到端：登录账号 → 入金 → 限价挂单 → 另一账号成交 → 双方钱包/持仓/账本一致 → 撤单/出金；WS 每秒收到行情。
4. 故障演练：停 Go → 前端显示离线错误、Node 其他功能不受影响；起 Go → 恢复挂单。
5. 回滚：nginx 去掉 exchange location 即回到纯 Node，游戏功能无损。

---

## 八、部署落地记录（2026-11-03 首次上线）

### 8.1 已部署组件

| 组件 | 路径 / 单元 | 说明 |
|---|---|---|
| Node 主服务 | `/home/ubuntu/whale-server`，`whale-server.service`（8787） | 新增内部资金桥 `src/internal-exchange.ts`；unit 增加 `EnvironmentFile=/etc/whale/internal.env` |
| Go 交易所 | `/home/ubuntu/whale-exchange/whale-exchange`，`whale-exchange.service`（127.0.0.1:8788） | 二进制由本地交叉编译上传；数据 `/home/ubuntu/whale-exchange/data/whale-exchange.db` |
| nginx | `/etc/nginx/sites-enabled/whale-exchange`（→ sites-available） | 新增 `location ^~ /api/exchange/`→8788、`location ^~ /internal/`→404；保留 `location /`→8787 |
| 共享密钥 | `/etc/whale/internal.env`（root 600） | `WHALE_INTERNAL_SECRET`，Node 与 Go 两个 unit 都通过 EnvironmentFile 读取 |

### 8.2 环境变量（生产）

- Node：`WHALE_INTERNAL_SECRET`（来自 EnvironmentFile）
- Go：`EXCHANGE_ADDR=127.0.0.1:8788`、`EXCHANGE_DB=/home/ubuntu/whale-exchange/data/whale-exchange.db`、`WHALE_AUTH_DB=/home/ubuntu/whale-server/data/whale-server.db`、`WHALE_INTERNAL_URL=http://127.0.0.1:8787`、`EXCHANGE_ROUND_SEC=300`、`EXCHANGE_MARKET_SEED=20261103`、`EXCHANGE_MAKER_ENABLED=1`、`EXCHANGE_CORS_ORIGINS=*`

### 8.3 部署前备份（必须）

1. `VACUUM INTO /var/backups/whale/manual/whale-server-<ts>.db`（生产库一致快照）；
2. 打包 `/home/ubuntu/whale-server/src` 与 `package.json`；
3. 备份 nginx 站点配置到 `/var/backups/whale/manual/`；
4. 每小时备份脚本已独立运行（见 `whale-server/deploy/whale-backup.sh`）。

### 8.4 冒烟结果（生产）

- nginx 本机：`/` 200、`/api/exchange/meta` 200、`/internal/*` 404、未登录 `/api/exchange/round` 401；
- CORS：`OPTIONS` → 204 + 四项头；`Origin: file://` 可访问；
- 端到端（60 秒回合冒烟）：注册→内部充值→入金 200 万→限价买→排队→回合末成交 5 股 @149,488→持仓→出金；
- 六人格上线：`/api/exchange/agents` 六行、每人 2 亿初始资本；回合边界后铁砧/磐石/巨鲸的委托进入 `queued`，等待回合末成交。

### 8.5 回滚步骤

1. `sudo rm /etc/nginx/sites-enabled/whale-exchange` 中新增的两个 location（或还原备份配置）→ `nginx -t && systemctl reload nginx`；
2. `sudo systemctl disable --now whale-exchange`（Go 服务停）；
3. Node 若需回退：解包 `/var/backups/whale/manual/whale-server-src-<ts>.tgz` 覆盖 `src`，`systemctl restart whale-server`；
4. 数据库回退：停 Node → 用 `/var/backups/whale/manual/whale-server-<ts>.db` 覆盖 `data/whale-server.db`（先移走 `-wal/-shm`）→ 起 Node。

### 8.6 已知阻塞

- **公网入口**：Cloudflare 代理到源站 525（源站直连 200、证书链 OK、nginx 无对应请求）。**已解决（2026-11-03）**：CF 记录改「仅 DNS」后外部 `GET /api/exchange/meta` 200、WS 升级 101。
- **本机网络**：船长机器拦截带 SNI 的 TLS 到源 IP（无 SNI 直连 200、带 SNI 卡死），且腾讯云对未备案域名走 80 有 302 拦截。**临时通道**：nginx 80 端口按出口 IP allowlist 提供明文 HTTP 反代（127.0.0.1 + 船长出口 IP），客户端服务器地址改用 `http://123.207.188.192`。船长已确认：默认 IP 直连、失败回退域名（明文 HTTP 的安全代价已接受）。

### 8.7 回合涨跌幅限制（2026-11-04 上线）

- 版本：`whale-server-go` 提交「回合涨跌幅限制（±3% 普通 / ±8% 事件）」；启动日志确认 `roundLimitBp=300 roundEventLimitBp=800`。
- 参数：`EXCHANGE_ROUND_LIMIT_BP`（默认 300）、`EXCHANGE_ROUND_EVENT_LIMIT_BP`（默认 800）；按波动档缩放：SMHI ×1.0=3%、UGMC/ABSI ×1.25=3.75%、OJLS ×1.5=4.5%；事件回合放宽到 800bp 后同比例缩放。
- 修复内容：价格引擎输出与集合竞价清算价统一钳制；结算后价格模型同步钳制价，避免漂移路径绕过限制。
- 验证（生产）：部署后第一个结算回合（01:20）四标的变动 SMHI +0.15%、UGMC −3.75%、OJLS +4.49%、ABSI +3.75%，全部在限制内；修复前同标的单回合曾出现 +21.61%、−17.62%。
- 回滚：服务器保留 `/home/ubuntu/whale-exchange/whale-exchange.prev`，覆盖回该文件并重启即可。

### 8.8 K 线历史与本地缓存

- Go 服务环境增加 `EXCHANGE_HISTORY_BARS=2016`（5m 约一周）；当前 `GET /klines` 单次最多返回 1000 根（约 3.5 天），取满一周需放开接口上限（待办）。
- 客户端新增 7 天离线缓存（`MarketCache` + `RendererTransport` 回退/补拉）：断网时可看最近行情/盘口/K线，写请求仍失败；缓存不含 token。

### 8.9 内测启动资金与钱包充值缺口（2026-11-04）

- **缺口**：服务器钱包（`whale-server.db` 的 `wallets`）与游戏存档内信用点是两套账。钱包只有服务端系统记账时才有余额，游戏存档不会自动同步；因此新/老玩家首次入金会报「钱包信用点不足」。
- **内测处置**：对船长账号 18（`dadadada`）通过内部资金桥记一笔 **5000 万内测启动资金**（nonce `playtest-grant-20261104`），双分录可审计：
  - `internal_exchange_credit_in`：account_id=18，credits_delta=+50,000,000；
  - `internal_exchange_credit_clearing`：account_id=null，credits_delta=−50,000,000。
- **已取代（2026-11-04）**：船长定案改为「存档币本地为准、服务器只记交易所账」（见 `stock-exchange-products-20261104.md`）。Go 开 `EXCHANGE_LOCAL_SAVE_MODE=1` 后入金/出金不再依赖服务器钱包；上述 5000 万拨款仅作历史记录。

### 8.10 2026-11-04 批次部署记录

- **回合涨跌幅限制**（±3% 普通 / ±8% 事件，按波动档缩放）：已部署；部署后第一个结算回合（01:20）SMHI +0.15%、UGMC −3.75%、OJLS +4.49%、ABSI +3.75%，全部在限制内。
- **64 事件四象分类 + 六人格 EVE 风改名**（星门局 K7A0 / 截击者 F4B1 / 锚定者 A2C7 / 黑隐者 C3A8 / 克隆潮 H5D6 / 利维坦 L2F9）：已部署；`/agents` 实测新名 + callsign；`/events` 新增 xiang/xiangName/intensity。
- **本地记账模式**（`EXCHANGE_LOCAL_SAVE_MODE=1`）：空钱包新账号直接入金 300 万验证通过；出金只扣交易所现金。
- **保底基金**（`POST /api/exchange/fund/play`）：部署后 4 次结算验证（输赢各现、重放幂等、现金守恒、审核行 kind=fund_play）。—— 该即时开奖版本已于 2026-11-04 改为放置型（`fund/open`、`fund/redeem`），现行规则见 `stock-exchange-products-20261104.md` 第三节。
- **K 线单次上限 1000→2016**（5m 约一周）：实测一次返回 2016 根。
- **前端**：默认 IP 直连 + 失败回退域名、7 天离线缓存、回合倒计时徽标、入金/出金弹窗（本地存档扣加）、本地债券、保底基金。
- **回滚**：每批部署前备份 `/home/ubuntu/whale-exchange/whale-exchange.prev`；环境变量开关：`EXCHANGE_LOCAL_SAVE_MODE=0` 回旧钱包桥、`EXCHANGE_ROUND_LIMIT_BP=0` 关涨跌幅限制。

### 8.11 做空/借券 v1 灰度 + 波动率校准（2026-11-04）

- **做空/借券**：`short.go` 券源池（默认 10 万股/标的，meta 持久化）、借券费 `5bp×(1+util²×4)`/回合从保证金扣、开空冻结/平空/空头分片强平/券源归还；黑隐者改为 2x 开空；`SQ-*` 空头踩踏快讯；`GET /api/exchange/borrow`。
- **灰度开关**：systemd `EXCHANGE_SHORT_ENABLED=1`、`EXCHANGE_BORROW_POOL=100000`、`EXCHANGE_BORROW_RATE_BP=5`；回滚只需改回 0 并重启。
- **波动率校准**：价格引擎 σ 从每回合 1.7%~3.8% 降到 0.35%~0.52%（高流动 0.00030/中 0.00025/小盘 0.00020，按 √秒 缩放），波动放大上限 4→1.6；此前价格长期顶在 ±3% 边界，校准后涨跌幅限制回归安全阀。
- **验证**：`go vet` 0、`go test -race` 63.8s 绿、linux amd64 构建；生产 `/borrow` 三池各 100000、启动日志 shortEnabled；后续观测单回合中位 |Δ| 与黑隐者开空足迹。
- **上线后修复**：人格持仓未落库（只存 holdings）→ 新增 `exchange_agent_positions` 表与读写、`initAgentsLocked` 恢复、跨重启测试；生产实测 5979101 黑隐者开空 SMHI 92 股，DB `owl/SMHI/short/92 margin=10,002,440`、`borrow_pool SMHI=99908`，02:35 结算扣借券费 9,997（≈5bp）。
- **校准后波动实测（8 回合）**：SMHI 中位 1.52%/p90 3.0%；UGMC 0.90%/3.75%；OJLS 0.90%/1.49%；ABSI 1.87%/3.75%（事件回合最大 10% 属预期）。较校准前中位 1.46~3.78%、p90 13~19% 明显收敛，仍有订单流/事件顶到限制的情况，属可接受范围。
- **端到端玩家链路（2026-11-04 02:40）**：新账号 28 → 空钱包直接入金 500 万 → 挂 OJLS 限价买 5 股 @17240 → 回合 5979103 结算成交（trade id 98，gross 86200，佣金/印花 0）→ 持仓 OJLS 5 股、现金/权益对平；黑隐者空头第二回合借券费再扣 9,797（保证金 9,992,443→9,982,646），无异常日志。
- **玩家做空闭环（2026-11-04 02:45/02:50）**：账号 29 入金 500 万 → `POST /orders {side:sell, leverage:2, short:true}` 10 股 SMHI @212672 → 回合 5979104 成交（持仓 `SMHI-short qty10 margin=1,062,297 liqPrice=273,436`，券池 99908→99898）→ `POST /positions/SMHI/short/close` → 回合 5979105 买回 @212566（trade 100，佣金 1062）→ 持仓清空、券池回到 99908，现金/权益守恒，无异常。
- **生产重启演练（2026-11-04 02:42）**：重启 whale-exchange 后 `/borrow` 券池（SMHI 99908）与 DB 空头持仓（owl/SMHI/short/92 margin 9,982,646）完整恢复，人格现金一致，无错误。
- **自动试玩机器人（2026-11-04 02:55–03:20，5 回合）**：脚本账号 30 入金 2000 万，每回合下现货买单、5x 杠杆单、2x 做空单、玩 1000 基基金一次。结果：委托 8 filled / 4 expired（做空单因脚本把 SMHI 报价误用于 ABSI 而价差过大过期，非服务端问题）/ 3 queued；成交 8 笔、基金 5 次；持仓 SMHI 8 股（现货）+ UGMC 5x 多 4 股（margin 52,241）；每一轮权益稳定在 20,000,000 附近、现金/权益对平，无 panic/abort/error。说明回合下单、竞价成交、杠杆持仓、基金、权益会计在连续多回合下稳定可玩。



