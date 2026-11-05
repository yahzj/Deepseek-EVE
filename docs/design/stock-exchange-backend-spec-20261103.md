# 证券交易所 · 后端契约级设计（P0 实施基线）

> 状态：**待开工确认**（本文件是 `stock-exchange-server-20261103.md` 的后端细化稿，二者冲突以本文件为准）
> 日期：2026-11-03
> 船长指令：「我们先设计后端，然后可以做前端的界面但是预留跟后端的接口。」
> 前置裁决（已定）：仅联机 / 入金配额+出金冷却 / 最高 50x 且允许负余额 / 分红来自费税池 / 条件单+模板策略 / 接受离线强平+离线保护 / 股市按真实墙钟（D7）。

---

## 一、交付分期（后端 B0~B3，前端 F0~F2 依赖接口冻结）

| 批次 | 内容 | 出口标准 |
|---|---|---|
| **B0 骨架** | 标的数据、内存订单簿、撮合、账户与入金/出金、持仓、REST、WS 行情、K 线 | 单机联调可下单成交、行情实时刷新 |
| **B1 杠杆** | 2/5/10/20/50x 逐仓、标记价、强平分片、保险基金、欠款与破产清算、资金费、借券 | 确定性用例覆盖强平/穿仓/债务回收 |
| **B2 生态** | AI 三类代理 + 事件驱动 + 逼空阶段机 + 分红 + 全部 4 只标的 + 敞口/流动性池闸门 | 无玩家下单时盘口仍连续、逼空可复现 |
| **B3 量化** | 条件单触发池 + 6 类策略模板 + 服务端策略引擎 | 策略触发与手动单同链路、可审计 |
| **F0** | 只依赖 `ExchangeClient` 接口的界面骨架 + Mock 适配器 | 不连服务端也能走通全部交互 |
| **F1** | HTTP/WS 真机适配器（桌面走主进程 IPC） | 与 B0 联调通过 |
| **F2** | 杠杆/持仓/自动交易面板 | 与 B1/B3 联调通过 |

**接口冻结纪律**：B0 开工前先冻结 §13 的 `EXCHANGE_CONTRACT_VERSION = 1`；后端与前端都只认这份契约，改契约必须升版本并同步两端。

---

## 二、进程与调度架构

- 单进程 Node 22（`node:sqlite` + `ws`），HTTP 与 WS 共用 8787；**不引入队列/Redis/多进程**。
- **内存权威**：订单簿、账户余额、持仓、保证金、AI 资本池全在内存；SQLite 只做持久化与重启恢复。
- **撮合循环**：`setInterval` 每 **500ms** 一拍（`WHALE_EXCH_TICK_MS` 可配，下限 200ms）。
- **每拍固定步序（钉死，不可调换）**：

```
1. 接收队列：把本拍新到的订单/撤单按 seq 落进内存簿并立即撮合
2. 价格：更新最新价、标记价、EWMA 波动率
3. 风控：保证金检查 → 强平分片执行 → 穿仓记欠款
4. 资金费 / 借券费（到点结算）
5. 分红（到日结算）
6. AI 报价刷新（做市商/散户/机构/套利）
7. K 线聚合（1s→1m→5m）
8. 组帧广播（book/trade/price/position/margin/event）
9. 单事务批量落盘（trades、ledger、orders、positions、klines、meta）
```

- **重启恢复**：启动时 ① 从 `exchange_orders where status in ('open','partial')` 重建簿（价格/剩余量/seq）② 从账户与持仓表恢复内存 ③ `seq = max(seq)+1` ④ 重放未结算资金费/分红的时间桶 ⑤ 广播一次全量快照。**不重放历史成交**。
- **确定性 PRNG**：`exchange_meta` 存 `seed` 与 `counter`；每拍对每只标的**无条件消费一次**随机数（即使不走随机分支），否则重启后走势漂移。
- **同步落盘风险**：`node:sqlite` 是同步 API，禁止逐笔成交开事务；每拍一个事务，单拍写入量上限保护（成交行数超阈值分两批）。

---

## 三、数据模型（新增表，幂等建表 + ALTER 补列，沿用 `db.ts` 现状写法）

| 表 | 关键列 | 约束/索引 |
|---|---|---|
| `exchange_stocks` | `code PK, name_key, sector, price, anchor, float_shares, total_shares, vol_class, max_leverage, shortable, halted` | 静态初始化，运营可改 |
| `exchange_accounts` | `account_id PK→accounts, cash, frozen, debt, credit_grade, banned_until, last_settle_at` | `cash/frozen ≥ 0`；`debt ≥ 0` 独立列 |
| `exchange_orders` | `id PK, client_order_id, account_id, code, side, type, tif, post_only, reduce_only, price, qty, qty_remaining, trigger_price, leverage, status, seq, created_at, updated_at` | `UNIQUE(account_id, client_order_id)` 幂等；索引 `(code, side, status, price, seq)` |
| `exchange_trades` | `id PK, code, buy_order_id, sell_order_id, buyer_id, seller_id, qty, price, gross, commission, stamp, ts` | 索引 `(code, id DESC)` |
| `exchange_positions` | `account_id, code, side(long/short), qty, avg_entry, leverage, margin, realized_pnl, updated_at` | `PK(account_id, code, side)` |
| `exchange_trigger_orders` | `id PK, order_id, code, condition, threshold, status` | 停价/条件单独立池，不进主簿 |
| `exchange_funding` | `id PK, code, ts, rate, long_pay, short_pay, pool_cut` | 资金费流水 |
| `exchange_dividends` | `id PK, code, ts, pool, per_share, holders_json` | 分红流水 |
| `exchange_klines` | `code, interval, bucket_ts, o,h,l,c,v` PK 复合 | 保留 30 天，定时清理 |
| `exchange_deposits` / `_withdrawals` | `id PK, account_id, nonce, amount, fee, status, receipt_hash, created_at` | `UNIQUE(account_id, nonce)` 防重放 |
| `exchange_strategies` | `id PK, account_id, template, params_json, status, last_fired_at` | 每账号上限 10 条 |
| `exchange_audit` | `id PK, account_id, kind, ref, detail_json, ts` | 只追加 |
| `exchange_meta` | `key PK, value` | `seq / rng_seed / rng_counter / contract_version` |

---

## 四、资金与账本集成（核心）

### 4.1 账户结构决策：**券商余额独立，不复用 `wallets`**

- 复用 `wallets` 会让现货挂单冻结与保证金冻结混在一起，强平会误伤现货订单。⇒ 新增 `exchange_accounts`（`cash / frozen / debt`）。
- **入金/出金是唯一闸门**，两个余额在同一事务内互转，两笔 ledger 分录。

| 操作 | 账本动作（同一事务） |
|---|---|
| 入金 X（费 0.5%） | `wallets.credits −X`；`exchange_accounts.cash +X−fee`；`fee → 系统销毁科目` |
| 出金 X（费 1%） | `exchange_accounts.cash −X`；`wallets.credits +X−fee`；`fee → 销毁` |
| 成交 | 买方 `cash −gross−commission`；卖方 `cash +gross−stamp`；税与佣金进销毁科目 |
| 冻结（挂单/保证金） | `cash → frozen`（内部划转，写 ledger 便于审计） |
| 强平/穿仓 | 亏损扣 `cash`；不足记 `debt`；差额由保险基金科目承受 |
| 分红 | 从分红池科目 → 各股东 `cash`；**不新增货币** |

### 4.2 幂等与审计

- 入金/出金：客户端生成 `nonce`，`UNIQUE(account_id, nonce)`；重复请求返回首次结果。
- 下单：`clientOrderId` 唯一；重复下单返回同一订单。
- 每笔资金变动 → `ledger_entries`（`ref_type = exchange_*`），并写 `exchange_audit`。
- 允许 `account_id = NULL` 的**系统科目**（销毁池/保险基金/分红池），沿用现有账本可空账号设计。

### 4.3 入金配额（防改档无限注资）

- 每日配额 = `base_quota + 等级系数`（初值 2~5 亿/日，见主设计稿数值表）。
- 单次入金上限、每小时笔数上限；超限返回 `422 deposit_quota_exceeded` 并写审计。
- 服务端**无法验证本地 ISK 真伪**（混合权威的固有缺口），靠配额 + 审计 + 全服总量监控兜底；异常账号进人工复核队列。

### 4.4 欠款与破产清算（50x 的配套）

- `equity = cash + frozen + Σ仓位浮盈 − debt`。
- 强平后 `equity < 0` ⇒ `debt += −equity`，现金与仓位归零。
- 回收顺序：分红 → 出金 → 入金 → 新仓盈利。`debt > 0` 时禁止出金与开新仓。
- 玩家可申请破产清算：`debt = 0`，`credit_grade −1`（最低 1），`banned_until = now + 7 天`，写审计。
- 保险基金 < 阈值 ⇒ 全市场最低保证金上调、禁止开新仓（负反馈），**绝不印钞兜底**。

---

## 五、订单与撮合

### 5.1 订单状态机

```
限价/市价：pending_new → open（可部分成交→partial）→ filled | cancelled | rejected
条件/停价：pending_trigger → triggering → open → filled | cancelled | rejected
```

### 5.2 订单字段

`clientOrderId, code, side, type(limit|market|stop|take_profit|conditional), tif(GTC|IOC), postOnly, reduceOnly, price, qty, triggerPrice, leverage, marginMode(isolated)`

### 5.3 撮合规则

- 价格优先、时间优先（全局单调 `seq`，**禁止用 `Date.now()` 排序**）。
- 成交价恒取 **maker 报价**；买方多冻结差额在订单结束时退回。
- **禁止自成交**：遇到同账号对手单跳过该笔，继续吃下一档；若整档都是自己则退出等待。
- 市价单 = 限价 ±∞ + IOC + 剩余撤销；带 `protectionPrice` 最大滑点保护，超出即撤余量。
- 强平单标记 `reduceOnly + liquidation`，优先级高于普通单，但**分片**吃单（每拍 ≤1 档的 30%）。

### 5.4 停价/条件单

- 独立触发池，不进主簿；每拍用**标记价**判定触发（防插针误触发）。
- 触发后转市价（或转限价，按用户选择）；`reduceOnly` 的止损只平仓不开反向仓。

---

## 六、保证金、强平、资金费、借券

### 6.1 公式（逐仓）

| 项 | 公式 |
|---|---|
| 初始保证金 | `IM = 1 / L` |
| 维持保证金 | `MM = 0.6 × IM` |
| 多头强平价 | `P_liq = P_e × (1 − 1/L) / (1 − MM)` |
| 空头强平价 | `P_liq = P_e × (1 + 1/L) / (1 + MM)` |
| 判据 | `equity ≤ MM × 名义价值` |
| 名义价值 | `qty × 标记价` |

### 6.2 标记价（防插针）

`mark = clamp(lastPrice, mid × (1 ± band))`，`band` 初值 5%；`mid = (买一 + 卖一)/2`；无盘口时用 EMA(lastPrice)。强平、条件单、资金费**一律用标记价**。

### 6.3 强平执行

1. 每拍扫描所有仓位，按「距强平距离」升序排队。
2. 逐仓分片：每拍最多平 30% 或 1 档深度，取较小者。
3. 平仓成交价按簿上 maker 价；滑点写入 `exchange_audit`。
4. 若分片 3 拍仍未清仓且 `equity ≤ 0`，剩余按标记价强制结算（接受滑点），差额进保险基金。

### 6.4 资金费

- 频率：**每 1 小时**（`WHALE_EXCH_FUNDING_MS`），游戏化取短周期提高持有成本感知。
- 费率：`clamp((mark − index)/index, −0.05%, +0.05%)`，加基准 0.005%。
- 结算：多空互转，另抽 20% 进销毁池。

### 6.5 借券（做空）

- 系统借券池按标的流通盘比例供给（初值 10% 流通盘）。
- 借券费按小时计 0.001%~0.005%，进借出方（P1 为系统）。
- 空头持仓 = 借券负债；平仓必须回补。

---

## 七、价格引擎与事件

- 对数空间：`x = ln(P/anchor)`，每拍：
  `Δx = (μ − σ²/2)Δt + σ√Δt·Z_t − θxΔt + ΣJ + λ_f·(净成交额/参考额)`
- `Z_t` 用 Student-t(ν=5) 造肥尾；`σ` 用 EWMA 自适应（λ=0.94），事件后 ×2~3 并在 5~10 拍回落。
- 锚点 `anchor` 每个游戏日按公司经营指标重估（全服产出/击杀/运输统计）。
- 熔断：5 分钟 ±20% → 3 分钟冷静期，只允许限价单，冷静期内强平仍执行。
- 事件：`exchange_events` 表 + 事件模板（攻挂现有实体），冲击写进 `ΣJ`。
- 随机消费：每拍每标的一次，无条件。

---

## 八、AI 代理（B2）

| 代理 | 资本来源 | 行为 | 保护 |
|---|---|---|---|
| 做市商 MM | 系统科目 | 五档报价，库存偏斜，spread 0.2~0.5% | 库存上限、耗尽停挂 |
| 动量散户 | 系统科目 | 5 拍收益 > +2% 追买；亏 8~15% 止损 | 单笔 ≤ 池 2% |
| 价值机构 | 系统科目 | P < 0.8A 买、P > 1.3A 卖 | 20 拍冷却、池上限 |
| 套利基金 | 系统科目 | 跨股/事件错价 | 单笔上限 |

- AI 订单与玩家订单**进同一本簿、不标记来源**；AI 资本池耗尽即缩量，不会凭空补钱。
- 逼空五阶段（潜伏/点火/轧空/顶部/崩溃）按主设计稿 4.5；阶段由服务端计数器判定，不用裸随机。

---

## 九、行情与实时推送（WS）

- 独立升级路径：`GET /api/exchange/ws?token=`（与聊天 WS 分离，互不影响）。
- 订阅：`{type:'sub', codes:['SMHI','UGMC'], topics:['book','trade','price','kline','position','margin','event'], throttle:'1s'|'5s'|'30s'}`
- 下行帧统一带 `{type, code, seq, ts, data}`；**每连接每序列有单调 seq**，客户端据此丢弃乱序帧。
- 首连：`snapshot`（五档 + 最新价 + 持仓 + 保证金）→ 之后增量。
- 背压：单连接每秒 ≤ 40 帧；超限合并 latest-wins（盘口只发最新，逐笔可丢）。
- 断线：重连重新 `snapshot`，不做历史补发（逐笔只保留最近 200 条可拉 REST）。
- 心跳：30s（复用 chat 模式）。

---

## 十、REST 契约

| 方法 | 路径 | 说明 | 幂等 |
|---|---|---|---|
| GET | `/api/exchange/stocks` | 标的列表/板块/现价/涨跌/杠杆档 | 是 |
| GET | `/api/exchange/book/:code` | 五档盘口 | 是 |
| GET | `/api/exchange/trades/:code` | 最近 200 笔 | 是 |
| GET | `/api/exchange/kline/:code?interval=1m` | K 线 | 是 |
| GET | `/api/exchange/account` | 现金/冻结/欠款/持仓/权益/保证金率 | 是 |
| POST | `/api/exchange/deposit` | `{amount, nonce}` | **幂等键** |
| POST | `/api/exchange/withdraw` | `{amount, nonce}` | **幂等键** |
| POST | `/api/exchange/orders` | 下单（含条件单字段） | `clientOrderId` |
| DELETE | `/api/exchange/orders/:id` | 撤单 | 是 |
| GET | `/api/exchange/orders/mine` | 当前委托（含条件单池） | 是 |
| POST | `/api/exchange/positions/:code/:side/close` | 平仓（可 reduceOnly） | 幂等键 |
| POST | `/api/exchange/margin` | 调整保证金/杠杆 | 是 |
| POST/PATCH/DELETE | `/api/exchange/strategies` | 量化策略 | 是 |
| GET | `/api/exchange/events` | 财经事件 | 是 |
| GET | `/api/exchange/insurance` | 保险基金水位（公开） | 是 |

**错误码**（沿用 `{code, message}`）：

| code | 含义 |
|---|---|
| `exchange_not_bound` | 未开通券商 |
| `insufficient_cash` / `insufficient_position` | 资金/持仓不足 |
| `below_min_qty` / `price_tick_invalid` | 数量/价格档位非法 |
| `leverage_not_allowed` | 该标的杠杆档不允许 |
| `not_shortable` / `borrow_unavailable` | 不可做空/无券可借 |
| `exposure_limit_exceeded` | 超单账户敞口上限 |
| `self_trade_blocked` | 自成交被拦 |
| `market_halted` | 熔断中 |
| `debt_outstanding` | 有欠款，禁止出金/开仓 |
| `deposit_quota_exceeded` / `withdraw_cooldown` | 配额/冷却 |
| `duplicate_nonce` | 幂等重放（返回首次结果） |
| `order_rate_limited` | 下单频率超限 |

---

## 十一、安全与风控

- 鉴权复用 Bearer token；WS 握手校验 token。
- 下单限频：每账号 10 单/秒、300 单/分钟；撤单 20/秒。超限 `429`。
- 入金/出金单独限频与日配额；`exchange_audit` 记全部资金动作。
- 只追加账本 + 禁负余额（`cash/frozen` 永不小于 0，债务用独立列）。
- 异常检测：单账号短时间高杠杆高频爆仓、同设备码多账号对敲 → 记审计，P4 再上管理后台。

---

## 十二、配置项（新增 env）

| env | 默认 | 说明 |
|---|---|---|
| `WHALE_EXCH_TICK_MS` | 500 | 撮合拍间隔 |
| `WHALE_EXCH_FUNDING_MS` | 3600000 | 资金费周期 |
| `WHALE_EXCH_COMMISSION` | 0.001 | 买入佣金 |
| `WHALE_EXCH_STAMP` | 0.002 | 卖出印花税 |
| `WHALE_EXCH_DEPOSIT_FEE` | 0.005 | 入金费 |
| `WHALE_EXCH_WITHDRAW_FEE` | 0.01 | 出金费 |
| `WHALE_EXCH_DEPOSIT_DAILY` | 300000000 | 日入金配额 |
| `WHALE_EXCH_WITHDRAW_COOLDOWN_MS` | 86400000 | 出金冷却 |
| `WHALE_EXCH_MAX_LEVERAGE` | 50 | 全局杠杆上限 |
| `WHALE_EXCH_EXPOSURE_PCT` | 0.05 | 单账户敞口上限（流通市值占比） |
| `WHALE_EXCH_INSURANCE_MIN` | 10000000 | 保险基金阈值 |
| `WHALE_EXCH_HALT_WINDOW_MS` | 300000 | 熔断观察窗 |
| `WHALE_EXCH_HALT_PCT` | 0.2 | 熔断阈值 |
| `WHALE_EXCH_KLINES_KEEP_DAYS` | 30 | K 线保留 |

---

## 十三、前端预留接口（船长要求的核心交付）

**契约版本**：`EXCHANGE_CONTRACT_VERSION = 1`（后端启动时通过 `/api/exchange/meta` 下发，版本不符前端拒绝连接并提示升级）。

```ts
// packages/... 前端与 server 各自持有一份同构定义（server 独立部署，不跨 workspace import）
export type Side = 'buy' | 'sell'
export type OrderType = 'limit' | 'market' | 'stop' | 'take_profit' | 'conditional'
export type Tif = 'GTC' | 'IOC'

export interface StockQuote {
  code: string; nameKey: string; sector: string;
  price: number; open: number; high: number; low: number; prevClose: number;
  changePct: number; volume24h: number;
  maxLeverage: number; shortable: boolean; halted: boolean;
  anchor: number; floatShares: number;
}

export interface BookLevel { price: number; qty: number }
export interface OrderBookSnapshot { code: string; bids: BookLevel[]; asks: BookLevel[]; ts: number }

export interface ExchangePosition {
  code: string; side: 'long' | 'short'; qty: number; avgEntry: number;
  leverage: number; margin: number; unrealizedPnl: number; liquidationPrice: number;
}

export interface ExchangeAccount {
  cash: number; frozen: number; debt: number;
  equity: number; marginRatio: number; creditGrade: number;
  positions: ExchangePosition[];
  pendingWithdrawals: Array<{ id: string; amount: number; availableAt: number }>;
}

export interface PlaceOrderRequest {
  clientOrderId: string; code: string; side: Side; type: OrderType; tif: Tif;
  price?: number; qty: number; leverage?: number;
  reduceOnly?: boolean; postOnly?: boolean; triggerPrice?: number;
}

export interface ExchangeOrder {
  id: string; clientOrderId: string; code: string; side: Side; type: OrderType;
  price: number | null; qty: number; qtyRemaining: number;
  leverage: number; status: 'open' | 'partial' | 'filled' | 'cancelled' | 'rejected' | 'trigger_pending';
  createdAt: number;
}

export interface StrategySpec {
  id?: string;
  template: 'dca' | 'grid' | 'trailing_tp' | 'stop_loss' | 'momentum' | 'event_arb';
  code: string;
  params: Record<string, number | string | boolean>; // 各模板自定义，UI 按模板渲染
  enabled: boolean;
}

/** 唯一依赖面：UI 只 import 这个接口，不 import 具体实现 */
export interface ExchangeClient {
  readonly contractVersion: number;
  // 查询
  getStocks(): Promise<StockQuote[]>;
  getBook(code: string): Promise<OrderBookSnapshot>;
  getKlines(code: string, interval: '1m' | '5m' | '1h', limit?: number): Promise<Kline[]>;
  getAccount(): Promise<ExchangeAccount>;
  getOrders(): Promise<ExchangeOrder[]>;
  // 交易
  deposit(amount: number, nonce: string): Promise<DepositResult>;
  withdraw(amount: number, nonce: string): Promise<WithdrawResult>;
  placeOrder(req: PlaceOrderRequest): Promise<ExchangeOrder>;
  cancelOrder(id: string): Promise<void>;
  closePosition(code: string, side: 'long' | 'short', qty?: number): Promise<void>;
  // 量化
  listStrategies(): Promise<StrategySpec[]>;
  saveStrategy(spec: StrategySpec): Promise<StrategySpec>;
  deleteStrategy(id: string): Promise<void>;
  // 实时
  subscribe(codes: string[], topics: ExchangeTopic[], throttle?: '1s' | '5s' | '30s'): Unsubscribe;
  on(type: ExchangeEventType, cb: (payload: unknown) => void): Unsubscribe;
}

export type ExchangeTopic = 'book' | 'trade' | 'price' | 'kline' | 'position' | 'margin' | 'event'
export type ExchangeEventType = 'book' | 'trade' | 'price' | 'kline' | 'position' | 'margin_call' | 'event' | 'error' | 'reconnect'

export interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
export interface DepositResult { nonce: string; applied: number; fee: number; cash: number; receiptHash: string }
export interface WithdrawResult { nonce: string; amount: number; fee: number; availableAt: number; receiptHash: string }
export type Unsubscribe = () => void
```

**两个适配器（前端可并行开发，不需要等后端）**：

| 适配器 | 用途 | 行为 |
|---|---|---|
| `HttpExchangeClient` | 正式联机 | REST + WS；桌面端经主进程 IPC 转发（CSP 约束，见主设计稿 D6） |
| `MockExchangeClient` | **F0 开发期** | 内存假行情 + 本地撮合模拟 + 可注入延迟/断线/报错；只在 `VITE_EXCHANGE_MODE=mock` 时启用，**不进正式包** |

- 选择方式：`VITE_EXCHANGE_MODE = mock | http`；生产默认 `http` 且未绑定服务器时显示引导态。
- Mock 只用于开发与界面验收，**不参与单机玩法**（船长已裁决仅联机）。

---

## 十四、测试矩阵（B0 开工即建）

| 类别 | 用例 |
|---|---|
| 撮合 | 价格优先/时间优先、maker 定价、部分成交、撤单退回、自成交拦截、IOC、Post-Only、市价滑点保护 |
| 冻结 | 买单冻结、卖单冻结、撤单解冻、成交后差额退回 |
| 账本 | 每笔变动双分录、余额不为负、哈希链校验、幂等 nonce 重放 |
| 杠杆 | IM/MM 计算、多空强平价、分片强平、标记价 clamp、穿仓记欠款、破产清算、保险基金闸门 |
| 资金费 | 到点结算、费率夹逼、销毁比例、重启不重复结算 |
| 分红 | 池不新增货币、按持股比例、离线累加 |
| 行情 | 首连快照、增量 seq 单调、降频、背压合并、重连恢复 |
| 恢复 | 重启后订单簿/持仓/seq/PRNG 与重启前一致 |
| 风控 | 限频、敞口上限、杠杆档拒绝、熔断期拒单、欠款禁开仓 |
| 对账 | 入金/出金前后 `wallets` 与 `exchange_accounts` 总量守恒 |

---

## 十五、部署与迁移

- 新表用 `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` 补列，**不写破坏性迁移**；服务器重启后自动生效。
- 部署：`scp` 源码 → `systemctl restart whale-server` → `/health` + `/api/exchange/meta` 校验契约版本。
- 备份沿用每日 `VACUUM INTO`；交易所额外保留每 10 分钟内存簿快照文件（可选，重启更快）。
- 监控指标：每拍耗时、订单簿深度、强平次数、保险基金余额、WS 连接数、入金异常数（先写日志，P4 再做面板）。

---

## 十六、后端 B0 验收清单（做完了拿这个对）

1. `exchange_stocks` 有 4 只标的（SMHI / UGMC / OJLS / ABSI），`GET /stocks` 返回现价与涨跌幅。
2. 两个测试账号能注册、入金、分别挂买卖单并成交，账本可校验、余额不为负。
3. 重启服务后，未成交挂单仍在、账户余额与重启前一致。
4. WS 首连收到 `snapshot`，之后每拍收到 `book/price` 增量，`seq` 单调。
5. 撤单退回冻结；市价单滑点保护生效。
6. `npm run test -w @whale/server` 全绿，`npm run typecheck -w @whale/server` 零错误。
7. Mock 适配器能驱动前端 F0 走通「下单 → 成交 → 持仓」全流程。

---

## 十七、仍待确认（只列真正阻塞的）

1. **入金配额口径**：2~5 亿/日是否够用？还是按账号等级/在线时长分级？
2. **资金费周期**：1 小时（本稿）还是 8 小时？1 小时更刺激但持有成本更高。
3. **K 线保留**：30 天是否足够，还是只保留 7 天省磁盘（2 核 1.9G / 40G 盘）。
4. **破产清算后的禁入时长**：7 天是否合适。

---

## 十八、与现行服务器架构的对接（2026-11-03 实测 `/docs` 后修订）

### 18.1 实际架构（与本文早期假设的差异）

| 项 | 实测结论 | 对股市后端的影响 |
|---|---|---|
| 代码位置 | 服务端已**移出游戏主树**，成为独立仓库 `whale-server`（HANDOFF 记为 `D:\Documents\GitHub\deepseek-EVE-Background`）；游戏主树内 `apps/server/` 是**旧版快照** | 股市必须写在独立仓库的 `src/exchange/`，**不能再改 `apps/server/`** |
| 账号体系 | 用户名/密码（scrypt）+ `sessions` 多设备会话（30 天滑动）+ 恢复码；设备码通道 deprecated 保留 | 股市接口复用同一 `authenticate()`；**无需新建账号体系** |
| 登录策略 | **登录非强制**：未登录可正常单机游玩；线上聊天/交易点击后提示登录 | 股市按「线上交易」同类处理：未登录可看引导页，不可交易；**不做遮罩强制跳转** |
| 数据锚点 | saves / wallets / item_stacks / items / orders / trades / ledger / production 全部以 `account_id` 为键 | 新增 `exchange_*` 表全部用 `account_id` 外键；多设备天然共享同一证券账户 |
| 认证 | `Authorization: Bearer <token>`；WS 用 `?token=`；统一 401 | 交易所 REST/WS 同一套 |
| 账本 | 双分录 + 哈希链 + 禁负余额，`account_id` 可空（系统科目） | 入金/出金/成交/税/资金费全部走 `appendEntry`，新增 `ref_type=exchange_*` |
| 数据库迁移 | `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` 补列 | 交易所表同模式，无破坏性迁移 |
| 文档服务 | 服务端自带 `/docs` 与 `/docs/raw/<名>`（`docs.ts`+`markdown.ts`） | 股市设计稿可直接发布为 `/docs/stock-exchange`，与其它设计档并列 |
| 内容依赖 | `content-csv/` 只服务现货市场目录；服务器上是真实拷贝 | **股市标的不走 content-csv**，写在 `src/exchange/stocks.ts` |
| 传输安全 | 目前 8787 明文 HTTP 直连公网 | **密码登录与实盘交易上 HTTPS 之前只应内测**（HANDOFF 已列为硬前提） |

### 18.2 股市接入方式（修订）

1. **域归属**：独立仓库 `whale-server/src/exchange/`，与 `market.ts` 同层；`app.ts` 挂载路由；`db.ts` 追加建表。
2. **鉴权**：所有 `/api/exchange/*` 走现有 `authenticate()`；未登录返回 401，客户端按「线上交易」同一提示引导登录。
3. **资金**：沿用本文 §4 的「独立券商余额 + 入金/出金闸门」，但 `wallets.credits` 与 `exchange_accounts.cash` 的互转也写账本；日配额与审计不变。
4. **实时推送**：新增 `/api/exchange/ws?token=`，复用现有 `ws` 服务与 token 校验；聊天频道不动。
5. **文档**：把本文与主设计稿精简版发布到服务器 `docs/stock-exchange-*.md`，通过 `/docs` 可读。
6. **部署**：仍用 scp 覆盖 + `systemctl restart whale-server`；交易所静态数据随源码走，不依赖 content-csv。

### 18.3 开工前置卡点（阻塞）

- ~~**独立仓库源码不在本机**~~（2026-11-05 已解决）：后端仓库现位于 `D:\Documents\GitHub\deepseek-EVE-Background`，远端 `https://github.com/yahzj/deepseek-EVE-Background.git`；股市系统在子目录 `exchange-server-go`（内含独立 `.git`，父仓尚未跟踪）。游戏主树 `apps/server/` 仍是旧版快照。
- 历史可选解法（已不需要）：① 船长提供独立仓库位置/远程地址；② 从服务器 `scp` 拉回源码建立本地基线；③ 在服务器上直接开发。

