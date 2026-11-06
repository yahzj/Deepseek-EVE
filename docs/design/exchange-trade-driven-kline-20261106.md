# 股市成交驱动：K 线与最新价只认真实成交（2026-11-06 · 一号 · main）

> **状态：已落码 · 待船长验收**（Go 服务端 + 桌面客户端两仓；服务端未重启、未推送）。
> **起因**：船长重制股市数据后观察专业投资界面——「**在没有成交量的情况下，为什么K线显示股价也会上下浮动价格会变化呢**」（m00002）。
> **结论**：K 线 OHLC 原先画的是行情引擎的「报价路径」，不是成交记录；V 与 OHLC 是两条独立输入，零成交照样每回合写价格。
> **关系**：本稿是船长选定的 **A 路线（仅删假价格，最小改动）**；C 路线（回合内连续撮合）明确不做。

---

## §0 船长裁定链（照抄）

| # | 船长原话（照抄） | 落到本稿哪一条 |
|---|---|---|
| 1 | 「**我把股市的数据重制了……在没有成交量的情况下，为什么K线显示股价也会上下浮动价格会变化呢**」 | §1 病因 |
| 2 | 「**K 线波动与真实成交不能脱钩，成交驱动才对。**」 | §2 方案总纲 |
| 3 | 三选一确认：路线 = **A 仅删假价格（最小）**；玩家成交方式 = **保持回合末集合竞价**；事件传导 = **只经做市报价偏移 + 人格下单体现** | §2 / §3 |
| 4 | 「**显示的数据一定是真实的操作，不能骗玩家，玩家买卖，事件，AI人格这些都得真实的有记录数据才行啊**……AI人格的行为是公开的所以有博弈的属性，但是玩家的行为是藏起来的，只藏在真实数据里。」 | §2（否决合成客户流）、§4 |

---

## §1 病因（改前代码链，逐环）

1. `market.go:stepPricesLocked`（回合尺度 OU + t(5) 肥尾）对**所有**标的产价并写入 `prices[code]`；`round.go` 结算把 `plan.newPrice` 全量落成最新价。
2. `market.go:stepIntraRoundLocked`（每 10 秒）同样步进，并**直接写 `s.lastPrice[code]`**，再 `updateIntraKlineLocked` 改当前所有周期 K 线的 H/L/C。
3. `market.go:planKlineWritesLocked` 每回合为所有标的写 K 线：OHLC = 引擎价，V = 本回合成交量；没成交也写，于是出现「有影线、无成交量」的蜡烛。
4. 客户端 `HttpExchangeClient.updateIntraCandles` 每收到 stocks 帧就把快照价塞进缓存里最新一根蜡烛的 h/l/c，量用 24h 累计量增量（零成交时增量为 0）。

→ 价格/OHLC 来自报价模型，只有 V 真正来自成交，两条输入脱钩。

## §2 方案（A 路线）

- 价格模型（OU + 事件冲击 + 传闻跳变）**保留**，但降级为「做市参考价」：只决定做市报价的中价，不再写最新价、不再写 K 线。
- 最新价、K 线 OHLCV **只由回合末集合竞价的真实成交产生**；无成交标的本回合保持上一笔成交价、V=0（平盘）。
- 事件冲击时点前移到**新回合开盘、重挂做市报价之前**（原先晚一回合）：事件回合的盘口先反应，再由真实成交把参考价落到最新价。
- 10 秒行情步进保留：报价（做市 5 档）仍然 10 秒级变动并广播盘口，但**不动最新价、不动 K 线**。
- 传闻快讯（泊松跳变）保留，但文案改为「盘口异动 / 报价明显上移」，不再宣称「价格已拉升」，避免无成交时文案与行情不符。
- 客户端只在 24h 累计量确有增量（本拍确有成交）时更新活跃蜡烛。

## §3 具体改动

**Go 仓 `exchange-server-go`（internal/exchange/）**

- `market.go`：`stepPricesLocked` 签名改为 `(roundNo, now int64) []NewsItem`；`stepIntraRoundLocked` 重写为只推进参考价 + 重挂做市报价 + 广播盘口；`makerMidLocked` 优先返回价格模型公允价（缺失才退盘口/最新价）；删除 `updateIntraKlineLocked`；`makeNews` 文案与 `Tick` 注释同步。
- `round.go`：`beginRoundLocked` 在 `refreshMakerLocked` 前把本回合事件冲击打进参考价（按 `roundLimitBpLocked` 钳制）；`settleRoundLocked` 改为 `plan.news = s.stepPricesLocked(...)`，`plan.newPrice` 只由集合竞价成交填写。
- 测试：`limits_test` 改新签名并断言参考价在限内且最新价不动；`events_test` 改为「参考价按方向冲击 + 无成交不改最新价 + 真实成交落价 + 重启恢复」；`market_test` 的 `TestIntraRoundKlineUpdate` 重写为 `TestIntraRoundLeavesPriceAndKlineUntouched`；新增 `trade_driven_test.go::TestPriceMovesOnlyWithTrades`（40 回合校验「价格变动必有成交量」）；删除临时探针 `probe_density_test.go`。

**游戏仓（apps/desktop）**

- `features/exchange/http/HttpExchangeClient.ts`：`updateIntraCandles` 在 `volumeDelta <= 0` 时 `continue`，不再用快照价拉伸蜡烛。

## §4 不做与取舍

- **不做**回合内连续撮合（C 路线）：资金冻结、结算、强平全链路要重构，风险与收益不匹配；本次保持回合末集合竞价。
- **不做**合成客户流：船长明确「不能骗玩家」。
- 取舍 1：价格水平仍由做市参考价模型引导（报价围绕模型价），但**所有显示的价格变化都有真实成交与成交量**；无人成交时最新价会长时间不动（低流动性的真实表现）。
- 取舍 2：重启后参考价归位到最后真实成交价，在途事件在下次开盘重挂报价时重新打进参考价。
- 后续可选：让真实买卖盘主导价格水平（纯流量价）——需要一次性事件基准价防「棘轮式」漂移，另开一批再议。

## §5 验证

- `go test ./internal/exchange/ -count=1` 全绿（13.7s，含新增回归用例）。
- 游戏仓 `npm run tier` → T1；`npm run verify` 四条检查（typecheck / content:check / l10n:check / ui:rot-check）全过。
- 未跑：完整 `npm run test -w @whale/core`（按约定留到船长明确开始集中验收时）。
- 待验收口径：服务端 + 桌面端实测——回合内无成交时 K 线完全静止；有成交回合出现成交量柱与价格跳变；事件回合先看到盘口/报价异动，成交后才见最新价变化。
