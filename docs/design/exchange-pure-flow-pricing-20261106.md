# 股市纯流量价：价格水平只由真实买卖盘决定（2026-11-06 · 一号 · main）

> **状态：已落码 · 待船长验收**（Go 服务端 `exchange-server-go`；本地提交、未推送、未部署）。
> **前情**：上一批 [`exchange-trade-driven-kline-20261106.md`](exchange-trade-driven-kline-20261106.md) 已让**显示价/量只来自真实成交**，但做市参考价仍由 OU 模型随机引导，价格水平并未真正由买卖盘决定。
> **本批授权**：船长 m00705——纯流量价 + **一次性事件基准价**，明确要求防「棘轮式」漂移。

---

## §0 船长裁定链（照抄）

| # | 船长原话（照抄） | 落到本稿哪一条 |
|---|---|---|
| 1 | 「**我把股市的数据重制了……在没有成交量的情况下，为什么K线显示股价也会上下浮动价格会变化呢**」 | 起因（上一批已修） |
| 2 | 「**K 线波动与真实成交不能脱钩，成交驱动才对。**」 | 上一批方案 |
| 3 | 「**显示的数据一定是真实的操作，不能骗玩家**……玩家的行为是藏起来的，只藏在真实数据里。」 | §2 只认真实成交、不合成流量 |
| 4 | 「**让玩家/AI 的买卖盘完全主导价格水平（纯流量价）……** 代价是要另建一次性事件基准价，否则事件偏移会在每次成交抬价后重复叠加、形成棘轮式漂移。这点需要格外注意。」 | §2 方案 F（一次性事件基准价） |

---

## §1 改前残余机制（为什么还不算纯流量价）

1. `market.go:stepPricesLocked` 每回合对所有标的跑 OU + t(5) + 事件冲击，写 `model.price`/`prices`；结算时 `applySettlementLocked` 把 `plan.newPrice` 全量落成最新价 → **每个回合的价格水平仍由模型步进决定**，不是买卖盘。
2. `market.go:stepIntraRoundLocked` 每 10 秒推进参考价并重挂做市报价、广播盘口 → 即使零成交，盘口与「参考价」也在自己走。
3. 事件冲击旧实现把 `eventImpulseLocked` 逐回合加到 `model.x`（相对量、且每回合衰减叠加）。若直接把「参考价 = 最新价 × 事件偏移」写成公式，每次成交抬高新价后偏移会再次乘上去 → 棘轮漂移。这是船长特别点出的坑。
4. 泊松传闻 `makeNews` 没有成交也会发「价格快速拉升/跳水」快讯。

## §2 方案（F：纯流量价 + 一次性事件基准价）

- **参考价（做市报价中枢）**：
  - 无事件：`ref = lastPriceOf(code)`（最新一笔真实成交价）。
  - 事件期间：`ref = round(eventBase × exp(eventLog))`，其中 `eventBase` = 事件生效回合开盘时的最新价，`eventLog = log1p(Direction × ImpactBp / 10000)`。偏移相对**固定基准价**计算，窗口内**恒定**，不随成交抬价重复叠加；`ref` 再按 `clampToPriceLimit(ref, 最新价, roundLimitBpLocked(code, roundNo))` 钳制。
  - 事件 ID 不变就不重设 `eventBase`；事件结束清空事件状态，`ref` 回到最新成交价——**不回跳基准价**，成交把事件效果留在真实价格里。
- 每回合开盘 `beginRoundLocked`：先 `refreshQuoteRefsLocked(roundNo)`，再 `refreshMakerLocked` 挂 5 档双边报价；玩家/AI 的委托仍只在回合末集合竞价成交，成交价才写最新价与 K 线。
- **删除**回合尺度随机步进 `stepPricesLocked`、10 秒步进 `stepIntraRoundLocked`、随机传闻 `makeNews`；`Tick` 只检测回合边界；`marketStep` 改为每结算回合 +1（只用于事件/新闻 ID）。
- 事件状态只在内存；重启后首个回合按当时最新价重锚（方向与幅度不变，绝对水平可能变化），语义仍是「一次性」。

## §3 文件级改动

**Go 仓 `exchange-server-go/internal/exchange/`**

- `market.go`：`priceState` 增加 `eventID string` / `eventBase int64` / `eventLog float64`；新增 `refreshQuoteRefsLocked(roundNo)`；`makerMidLocked` 改为返回 `model.price`（缺失回退最新价）；删除 `stepPricesLocked`、`makeNews`、`stepIntraRoundLocked`；`Tick` 简化为只推回合；清理 `strconv` 引用。
- `round.go`：`beginRoundLocked` 的事件冲击块替换为 `refreshQuoteRefsLocked(roundNo)`（在 `refreshMakerLocked` 之前）；`settleRoundLocked` 删除 `stepPricesLocked` 调用与 `marketNews` 落库；`applySettlementLocked` 顶部 `marketStep++`。
- `events.go`：删除 `eventImpulseLocked`，新增 `strongestEventForCodeLocked(code, roundNo)`（同码窗口内 `ImpactBp` 最大的活跃事件）；头注释改为「一次性基准价 × 冲击幅度，防棘轮」。
- `service.go`：删除 `intraTickAt` 字段；`IntraTickSeconds` 标注已弃用（保留字段兼容旧配置）；`TickInterval`/`roundPrevClose` 注释同步。
- 测试：`limits_test` 的旧随机步进用例改为 `TestQuoteRefRespectsRoundLimit`；`round_test` 改为 `TestMarketStepAdvancesOncePerSettlement`；`market_test` 的回合内用例改为断言参考价/最新价/K 线都不动；`trade_driven_test` 新增 `TestQuoteRefFollowsRealTrades` 与 `TestEventBaselineDoesNotRatchet`；`events_test` 重构为「事件回合开盘读参考价 → 无成交最新价不动 → 按参考价真实成交落价」；`demand_scenarios_test` 夹具改为「围绕最新价越价 0.3%（低价股至少 1 个价位）」的可成交委托。

## §4 不做与取舍

- **不做**回合内连续撮合（沿用上一批结论，资金冻结/强平链路重构风险大）。
- **不做**事件逐回合衰减/爬升：窗口内恒定幅度更简单，也避免与一次性基准价叠加出第二套漂移；`StartRound/EndRound` 语义与窗口不变。
- 覆盖 2026-11-04 的「10 秒级价格变动」要求：回合内不再有价格或报价变动（`IntraTickSeconds` 弃用）。无事件且无玩家下单时市场完全静止（K 线平盘、V=0），这是真实低流动性的表现；要让日常更活跃应提高事件概率或玩家活动，**不恢复随机游走**。
- 随机行情快讯取消：快讯只来自真实成交、剧本事件、监管与踩踏，不再出现「没成交却报价格异动」。
- `marketStep` 语义变更（原每标的每回合 +1，现每结算回合 +1）；只影响 ID 生成，不影响对外行情。
- 历史 K 线不回刷（改变的是之后的生成规则）。

## §5 验证

- `go build ./...`、`go vet ./internal/exchange/` 通过；`go test ./internal/exchange/ -count=1` → `ok 13.175s` 全绿。
- 新增/改写用例：`TestQuoteRefRespectsRoundLimit`（事件参考价落在事件限幅内、最新价不动）、`TestQuoteRefFollowsRealTrades`（无事件参考价=最新价；成交后跟随成交价）、`TestEventBaselineDoesNotRatchet`（同一事件连续两轮成交，参考价保持恒定；事件过期后回到最新价）、`TestMarketStepAdvancesOncePerSettlement`、`TestIntraRoundLeavesPriceAndKlineUntouched`、`TestScriptedEventAppliesNextRoundShockAndPersists`（含真实成交落价与 K 线量价）、`TestPriceMovesOnlyWithTrades`。
- 60 回合离线观察（`DefaultConfig` + `AgentsEnabled` + `DemandEnabled`，未用个人真档）：15 个回合出现价格变动、合计 29 笔成交，全部发生在事件回合；期末价 SMHI 50525、GBCI 25161、UGMC 8012、ABSI 3008、NVSC 1202、CLON 506、OJLS 203、SPRK 501。
- 本轮无客户端代码改动；未跑完整 `npm run test -w @whale/core`（按约定留到船长明确开始集中验收时）。
- 待验收口径：回合内价格与报价完全静止；玩家/AI 主动吃价差才成交并推动最新价；事件回合开盘盘口一次性偏移、窗口内不再叠加；事件结束后参考价回到最新成交价。

## §6 待裁决与后续

1. **活跃度**：纯流量价下日常大部分回合无成交（事件概率 25% 才有 AI 交易）。是否提高事件概率、或给 AI 人格加「主动吃价差」策略以增加真实成交，请船长定。
2. 另一会话的**做市储备补丁**（无限做市账户 → 8 亿创世储备）是否合并仍待定；本批已核验该补丁可干净叠加到本批之上、build/vet/全量测试通过（补丁自身无测试）。
3. 部署生产：待船长验收后按 `exchange-server-go/HANDOFF.md` 的流程换二进制、重启 `whale-exchange`。
