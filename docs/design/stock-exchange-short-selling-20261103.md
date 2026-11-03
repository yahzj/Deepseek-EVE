# 股市 · 做空与借券（回合制 B2）

> 状态：**v1 已实现并灰度上线（2026-11-04，`EXCHANGE_SHORT_ENABLED=1`）**　｜　日期：2026-11-04
> 关联：`stock-exchange-round-model-20261103.md`（回合制）、`stock-exchange-economy-pvp-20261103.md`（经济）、`stock-exchange-ai-ecosystem-20261103.md`（夜枭→黑隐者 C3A8）
>
> ## 实现记录（2026-11-04）
> - Go：`short.go`（券源池 10 万股/标的、借券费 `rate=5bp×(1+util²×4)` 按回合从保证金扣、开空冻结、空头结算/分片强平/券源归还）；`round.go` 结算分派与券池同事务落库；`leverage.go` 空头镜像公式；`service.go` Config（`ShortEnabled`/`BorrowPoolPerStock`/`BorrowRateBp`）与平空接口；`store.go` `orders.is_short` 幂等补列；`GET /api/exchange/borrow`；黑隐者 2x 开空；`SQ-*` 空头踩踏快讯。
> - 公式：`equity=margin+(entry−price)×qty`、`MM=0.6×notional/L`、`P_liq_short=entry+(entry−P_liq_long)`；净负转 debt，与多头一致。
> - 测试：13 个新用例 + 全量 `go test -race` 绿；生产启动日志确认 `shortEnabled`，`/borrow` 三池各 100000。
> - 已知限制（后续）：单账户借券 20% 上限与 util>80% 提保证金未实现；空头收益未纳入监管罚没；借券费销毁而非归系统；极端成交价冻结额封顶、靠回合末强平兜底。


---

## 结论先行

1. **夜枭要能真做空，需要借券机制**：向「券源池」借股票卖出，付借券费，回合末按清算价盯市，价格上涨到维持保证金线强制回补。
2. **券源有限且来自系统**：初始券源 = 每标的流通股本的 **2%**（由做市/保险基金持有），不凭空产生玩家资产；借出后券源减少，归还后恢复。
3. **回合制下的做空**：开空在回合队列里提交，回合末集合竞价成交；清算/强平在回合结算时用清算价判定，与多头同一套保证金规则。
4. **借券费随利用率上浮**：`borrowRate = base × (1 + util² × k)`，逼空时券源紧张 → 费率飙升 → 空头被逼回补，这就是「逼空」的经济引擎。
5. **逼空事件**：当空头集中度（空头名义/流通市值）> 阈值且价格连续上涨 → 触发「逼空」快讯，羊群/红隼追买，借券费上调，社区看到踩踏。

---

## 一、券源池

| 项 | 规则 |
|---|---|
| 券源来源 | 系统账户（做市/保险基金）持仓，初始 = 流通股本 × 2%（每标的可配 `EXCHANGE_SOURCING_BP`） |
| 借出 | 开空时从池中扣减，记 `exchange_borrows`；池不足 → `borrow_unavailable` |
| 归还 | 平空时归还，池恢复；强平同样归还 |
| 券源上限 | 单个账户借券 ≤ 池的 20%（防一人借光） |
| 券源可见 | `GET /api/exchange/borrow`：可借数量、当前费率、利用率 |

## 二、做空交易

1. 开空 = `side: sell` + `leverage`（逐仓，2~90x，标的可空时才允许）；
2. 保证金 = 名义额 / 杠杆；借券费从保证金里按回合扣（`占位费率`）；
3. 成交后持仓 `positions(side=short)`：qty、avg_entry、leverage、margin、borrow_fee_paid；
4. 平空 = `POST /positions/{code}/short/close`（买回），回合末竞价成交；
5. 回合末盯市：`equity = cash + margin − unrealized_pnl − 应付借券费`；
   - `MM = 0.6 × notional / leverage`；
   - 价格涨到 `P_liq_short = P_e × 5(L+1)/(5L−3)`（与多头对称）→ 强制回补；
6. 回补优先从券源买回（系统做市卖单），不足则顺延到下一回合并计罚金。

## 三、借券费与逼空

- `util = 已借出 / 券源池`；
- `rate_per_round = baseRate × (1 + util² × K)`，`baseRate` 默认 5bp/回合，K 默认 4；
- util > 80% → 费率暴涨、开空受限（新空单需要 1.5 倍保证金）；
- **逼空判定**：单标的空头名义 ≥ 流通市值 1% 且连续 2 回合上涨 → 触发 `SQ-*` 快讯（阶段：聚集/逼空/踩踏），羊群追买、红隼加速、借券费翻倍；
- 空头大量回补时生成「空头踩踏」快讯。

## 四、API 变更

| 接口 | 变更 |
|---|---|
| `GET /api/exchange/borrow` | 新增：每标的可借量/费率/利用率 |
| `POST /api/exchange/orders` | `side:sell` + `short:true`（或 leverage && shortable）允许开空 |
| `GET /api/exchange/positions` | 支持 `side: short` |
| `POST /api/exchange/positions/{code}/short/close` | 新增：买回平空 |
| `GET /api/exchange/news` | `SQ-*` 逼空快讯 |
| `GET /api/exchange/stocks` | 增加 `borrowAvailable/borrowRate` |

## 五、风险与约束

- 券源与保证金都要单事务；禁止凭空造券；
- 逼空可能让系统券源耗尽 → 费率机制自动调节，必要时暂停开空（写快讯）；
- 玩家被逼空爆仓属于规则结果，不是系统扣钱；
- 与监管规则叠加：操纵逼空（自买自卖拉价）会触发监管罚没。

## 六、测试清单

1. 借券池扣减/归还/上限；
2. 开空成交、借券费按回合扣、平空盈亏；
3. 价格上涨触发空头强平（含分片）；
4. 借券费随利用率上浮；util>80% 限制；
5. 逼空阶段快讯与羊群行为；
6. 重启恢复（借券、空头持仓、费率状态）；
7. 资本守恒（券源不增不减，只有费用流转）。
