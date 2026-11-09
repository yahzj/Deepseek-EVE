# 交易所下注与委托修复（2026-11-08）

**状态**：已实现，待船长验收
**范围**：`Deepseek-EVE`（前端极简投资 / 委托列表）+ `deepseek-EVE-Background/exchange-server-go`（跨域，船长已批准同批修改）

## 一、船长报障原话

> 现在需要你检查一下下注和委托功能了，我下注委托卖掉卖不掉，然后显示的委托数量也不对，撤销，一键全部结算，有问题啊，这里的逻辑

## 二、船长裁决（2026-11-08）

| 事项 | 裁决 |
|---|---|
| 日成交额度口径 | **买卖各 10 亿**（独立额度） |
| 市价单回合末未成交 | 显示「未成交」（`expired`），不再显示「已撤销」 |
| 跨域范围 | 授权前端与 `exchange-server-go` 同批修改；部署另行确认 |

## 三、根因

1. **卖不掉**：`exchange_daily_turnover` 只有 `(account_id, utc_day, notional)` 一个计数，买入与卖出共用同一份 10 亿额度。Go 探针复现：账户买入用满 10 亿后，卖单结算终态 `expired`、成交量 0，持仓不变。
   - 设计稿口径冲突：`stock-exchange-handoff-20261104.md:87` 写「买卖合计」，`stock-exchange-products-20261104.md` §四写「买入和卖出分别计入自己的额度」。本次按后者与船长裁决执行。
2. **委托数量不对**：
   - WS 回合帧是公共视图，不含 `usedOrders`；前端整体替换 `this.round` 后配额显示被打回 `0/10`。
   - 下单成功后不刷新回合读数，`我的委托 x/10` 停在旧值。
   - 下注舱「本回合待成交下注」取 `snap.orders`（全市场活跃委托），把其它股票与卖单也计入。
   - 窄栏委托列表只显示下单总量，不显示成交量。
3. **撤销 / 一键结算**：
   - 市价单未成交余量被服务端标记 `cancelled`，前端显示「已撤销」。
   - `checkDayLimitLocked` 用 `side=buy && !short` 判断，把「买回平空」也拦下；探针复现涨停日返回 `409 day_limit_up`。
   - 回合锁定窗口内撤单按钮直接不渲染。
   - 一键全平失败只报笔数，不报原因。

## 四、改动

### 服务端（`exchange-server-go`）

| 文件 | 改动 |
|---|---|
| `internal/exchange/store.go` | `exchange_daily_turnover` 增加 `side` 列、主键改 `(account_id, utc_day, side)`；新增自动迁移 `migrateDailyTurnoverSide`（旧行同时写入买卖两侧，升级当天不白送额度）；`DailyTurnover(side)` / `DailyTurnovers` / `AddDailyTurnover(side)` |
| `internal/exchange/round.go` | 回合额度按买卖方向分配与扣减；集合竞价 `turnoverLeftFor` / `addTurnoverUsed`；市价单未成交终态改为 `expired` |
| `internal/exchange/intra.go` | 盘中人格撮合额度按方向拆分与落库 |
| `internal/exchange/matching.go` | `MatchOptions.DailyNotionalRemaining` 改为按方向 |
| `internal/exchange/types.go` | `AccountView` 新增 `dailyBuyUsed` / `dailySellUsed`，保留 `dailyTradeUsed`（合计）兼容旧前端 |
| `internal/exchange/service.go` | 账户视图按方向读取额度 |
| `internal/exchange/limits.go` | 涨停闸门豁免「买回平空」（`reduceOnly` + 已持有空头），仍拦截无空头的伪平仓 |
| 测试 | 额度测试适配并新增「买满后卖出仍成交」；新增涨停平空豁免、旧表迁移用例 |

### 前端（`Deepseek-EVE`）

| 文件 | 改动 |
|---|---|
| `features/exchange/client.ts` | `ExchangeAccount` 新增可选 `dailyBuyUsed` / `dailySellUsed` |
| `features/exchange/http/HttpExchangeClient.ts` | 账户映射新字段；WS 回合帧同回合保留 `usedOrders`；下单后刷新回合配额；批量响应直接更新配额 |
| `features/exchange/components/SimpleTrade.tsx` | 额度与进度条按买卖 Tab 切换；待成交下注按当前标的过滤 |
| `features/exchange/components/TradePanel.tsx` | 专业模式下单额度按方向显示 |
| `features/exchange/components/MyOrders.tsx` | 锁定窗口撤单按钮置灰保留入口；窄栏显示「成交/委托」 |
| `features/exchange/components/SimplePosition.tsx` | 一键全平失败附带首条服务端原因 |
| `features/exchange/texts.ts` + `packages/data/src/l10n/table.ts` | 新增 `ui.exchangeTexts.510/511`（买入额度 / 卖出额度），`enDeferred` |
| `tools/ui-sfx-success-only.test.ts` | 修正既有回归：内层重试 `catch` 被当成外层 `catch` |
| `docs/l10n-pending.md` | 登记两条待译文案 |

## 五、验证

- 服务端：`go build ./...`、`go test ./... -count=1` 全绿（含新增额度、涨停平空、迁移用例）。
- 前端：`npm run typecheck`、`npm run verify` 通过；交易所专项 `tools/exchange-feedback.test.ts`、`tools/exchange-guest-mode.test.ts`、`tools/ui-sfx-success-only.test.ts` 12/12 通过。

## 六、未做 / 后续

- 服务端二进制未构建、未部署、未重启；部署需船长另行确认。
- 玩家公告未起草（按 AGENTS.md §7 需 3~5 条要点并经船长批准）。
- `SimplePosition` 卖出挂单后整行消失（`availableQty=0` 被过滤）未改，待船长决定是否保留行显示冻结量。
