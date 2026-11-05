# 股市 · 保底产品与本地资金模型（2026-11-04）

> 状态：已实现并部署　｜　依据：船长 2026-11-04 口径
> 关联：`stock-exchange-integration-20261103.md` §8.9/§8.10、`stock-exchange-round-model-20261103.md`

## 一、资金模型（船长定案）

> 「游戏存档的币就走玩家本地就好了，本地计算就好了，入金就记账到服务器账上就行了啊，然后本地抠掉玩家的币，他们要作弊就让他们作弊吧，我们把线上的算法做好，让他们作弊也没有用就行了。」

- **存档币本地为准**：本地存档 `state.wallet.isk` 是玩家资金的唯一依据；服务端不校验来源。
- **服务器只记交易所账**：Go `LocalSaveMode`（`EXCHANGE_LOCAL_SAVE_MODE=1`）下：
  - 入金：只把金额记进交易所现金账户，**不再调用 Node 钱包桥**；
  - 出金：只扣交易所现金，生成完成回执；
  - 幂等 nonce、回执哈希、`exchange_transfers` 审计保留；旧钱包桥链路保留作回滚开关（环境变量关闭即回到旧链路）。
- **客户端职责**：入金前从本地存档扣 ISK（`GameEngine.exchangeWalletDelta(-amount)`），失败退回；出金成功后加回本地存档。
- **作弊政策**：允许（本地可随意改 ISK），线上公平性靠撮合/涨跌幅/监管/保险基金等算法保证，不靠地图外校验。

## 二、债券（交易所现金，服务端单利结算）

> 2026-11-04 修订，船长原话：「债券也要用入金的钱包购买，本地钱包不能直接用」。
> 旧版从本地存档 ISK 扣款、只存 `localStorage`、不经过服务器；已整批替换为交易所现金 + 服务端记账。

- 入口：极简模式左栏「低风险理财 · 舰船债券」。
- 规则：固定利率 **3bp/分钟（0.03%）**，按分钟单利累积、不滚入本金（`internal/exchange/bond.go`：`bondMinuteBp = 3`）。
- 资金：从**交易所现金**申购，本金锁定在持仓里，现金当场扣减；赎回 = 本金 + 累计收益。
- 接口：
  - `GET  /api/exchange/bond` → 持仓（顺带惰性结算到当前分钟）；
  - `POST /api/exchange/bond/open {amount, nonce}` → 申购 / 追加；
  - `POST /api/exchange/bond/redeem {nonce}` → 赎回本金 + 累计收益。
- 结算：惰性一次乘法 `accrued += principal × 3bp × minutes`，不逐分钟循环；离线照常累积。
- 存储：表 `exchange_bond_positions`（`account_id / principal / accrued / settled_minute / opened_at`）；审计行 `exchange_transfers.kind = bond_open / bond_redeem`。
- 幂等：同一 nonce 重放返回当前持仓；换金额重放 409 `nonce_conflict`；空仓赎回 409 `no_bond_position`。
- 前端：`BondCard` 跟随行情 10 秒刷新，30 秒兜底拉取；空仓时输入金额申购，有仓时显示本金 / 累计收益 / 当前价值 / 已计息分钟。
- 模拟盘：`MockExchangeClient` 用同一单利规则本地复现。

## 三、保底基金（放置型，服务端按分钟结算）

> 2026-11-04 修订，船长原话：「要比债券高是正常的啊起码3倍收益，但是有概率亏，随时可赎」。
> 旧版是「点一次结算一次、不扣本金」的即时开奖：只有正期望、没有放置，已整批替换。

- 入口：极简模式左栏「保底基金」→ 理财页签。
- 投入：交易所现金（不是本地存档）申购基金份额，**本金锁定在持仓里**，现金当场扣减。
- 接口：
  - `GET  /api/exchange/fund` → 持仓（顺带惰性结算到当前分钟）；
  - `POST /api/exchange/fund/open {amount, nonce}` → 申购 / 追加；
  - `POST /api/exchange/fund/redeem {nonce}` → 赎回本金 + 累计收益。
- 结算：按**真实时间逐分钟**独立结算，每分钟一次：
  - 70% 概率 `+16bp`、30% 概率 `−7bp`（按本金计）；
  - 每分钟期望 `+9bp`，约为债券（3bp/分钟）的 **3 倍**；
  - 亏损真实发生、不保本；赎回额 = 本金 + 累计收益（`accrued` 可为负）。
- 确定性：`HMAC(fundSecret, "fund|<accountID>|<minute>")` 前 8 字节 `%100 < 70` → +16bp，否则 −7bp；同一账户同一分钟可重放，离线照常累积。
- 长离线：单次最多逐分钟结算 7 天（`fundMaxSettleMinutes`），超出部分按期望 9bp 折算，避免超长离线卡死。
- 幂等：同一 nonce 重放返回当前持仓，不重复扣款/加钱；审计行 `exchange_transfers.kind = fund_open / fund_redeem`（赎回行 `Fee` 存累计收益）。
- 前端：`FundCard` 空仓时显示申购输入；有仓时显示本金 / 累计收益 / 当前价值 / 已计息分钟，并提供「追加」「全部赎回」；持仓跟随行情轮询 10 秒刷新。
- 模拟盘：`MockExchangeClient` 用 FNV-1a(分钟) 复现同一规则，持仓写入 `whale-idle:exch-mock` 存档。

## 四、边界

- 赎回额下限 0：累计收益亏穿本金时按 0 赎回，不会把交易所现金打成负数。
- 收益只与**本金 × 时间**有关，点击不能加速；因此不需要次数、额度或冷却限制。
- 债券动本地存档、基金动玩家自己的交易所现金；两者都**不铸造**交易所资产，不计入线上 PvP 公平性约束。
