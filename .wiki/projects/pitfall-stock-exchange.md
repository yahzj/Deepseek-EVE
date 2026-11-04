---
id: pitfall-stock-exchange
title: 证券交易所：踩坑与经验
category: projects
tags: [pitfall, gameplay]
summary: 证券交易所踩坑：回合撮合、限幅与波动、杠杆做空与资金闸门、AI 人格、接入与交接（docs 蒸馏，非现行规则）
tier: supporting
source: docs-distill:pitfall-stock-exchange
confidence: extracted
created: 2026-11-04T10:42:39.378Z
updated: 2026-11-04T10:42:39.378Z
---

# 证券交易所：踩坑与经验

> 本页是 docs 提炼的经验记录，非现行规则；与 AGENTS、docs 现行正文或代码冲突时，以它们为准。

## 结论先行

- 回合制替换了原来的 1 秒 tick / 连续撮合口径：下单只返回 `queued`，成交只在回合末集合竞价发生——所有「立即成交」式前端反馈和按秒刷新的假设都要一起改，否则界面会说谎。
- 交易所最贵的 bug 不是算错，而是**契约只改了一半**：限幅只钳一处、资金只改一端、CSP 没提前定通道、部署只换一个单元，都会留下绕过路径或单边账。
- 杠杆可玩性靠「限幅 + 波动校准 + 标记价」三件套兜住；缺一个就会单回合 ±20~40% 扫仓，或一次插针打穿 90x（强平距离仅 0.447%）。
- 任何能让 ISK 从无变出来的路径都会被最优化玩法吃干：价值锚点策略曾 99.6% 盈利、期望 +165%；换锚点漂移无效，只能改赔率结构或加成本。
- 「资金本地为准」不等于「市场可以离线」：存档币本地记账，但股市按真实墙钟 7×24 走，离线期间强平照发生，界面必须说清时间差。
- 图表类「空 / 不更新」多数不是接口坏，是数据到达顺序假设：`useMemo` 把首帧空数据锁死、切标的没补拉、缓存先渲染未刷新。
- 部署是两段式的：nginx location + 两个 systemd 单元 + 内部资金桥；任何一处没对齐，结果是公网打不开、内部接口暴露、或单边扣款。
- 交接/设计稿里的数值是当时快照；文档之间已出现域名、券源口径不一致，接手先以 `systemctl cat`、代码与现行 docs 为准。

## 一、回合时钟与撮合契约

### 坑 1：下单后界面秒回「已成交」，实际只是排队
- **现象**：买舱提交成功即弹「已成交」toast，玩家以为成交，回合末才发现未成交或价格不同。
- **根因**：接口契约从同步撮合改为「提交进本回合队列、立即返回 `status:"queued"`、不回撮合结果」，UI 沿用了旧成交反馈；成交状态只在回合末 `round`/`orders` 帧才确定。
- **解法 / 规避**：提交后只显示「本回合待成交委托（回合末集合竞价成交）」；成交/撤销一律以 WS 帧或重连后 `/round` + 快照为准，禁止从 HTTP 返回推断成交。
- **复发检查点**：`rg -n '已成交|filled'` 查交易舱是否还有即时成交文案；手工下一单观察 toast；断网重连确认状态以服务端快照收敛。
- **来源**：`docs/design/stock-exchange-handoff-20261104.md:97`、`docs/design/stock-exchange-round-model-20261103.md:36`

### 坑 2：回合边界的「三重门」没在 UI 上体现
- **现象**：锁定窗口内提交报 409 却只显示「下单失败」；超配额后才被拒；撤单后配额没回来，玩家以为系统吞单。
- **根因**：回合末前 10 秒锁单、每账户每回合 10 单、配额按「已提交委托数」计且**撤单不返还**（防刷）——三条都是刻意规则，前端只当普通错误处理。
- **解法 / 规避**：`GET /round` 驱动倒计时、锁定态与 `usedOrders/maxOrders`；锁定时禁用提交并提示「下回合可提交」；配额口径写进 UI 文案；撮合异常时整回合撤单 + 解冻 + `round_abort`，不要逐单修补。
- **复发检查点**：在回合末最后 10 秒分别提交与撤单；提交 10 单后再撤一单看配额是否仍为 10；模拟撮合异常看资金是否全部解冻。
- **来源**：`docs/design/stock-exchange-round-model-20261103.md:28-29`、`docs/design/stock-exchange-round-model-20261103.md:44`、`docs/design/stock-exchange-handoff-20261104.md:48-49`

### 坑 3：撮合/引擎不「可回放」——时间戳、浮点与条件随机
- **现象**：同一份种子两次跑结果不一致；重启后事件阶段或价格漂移；读档后 AI 行为与之前不同。
- **根因**：订单时间优先级若用 `Date.now`、价格用浮点、RNG 按分支条件消费，都会让撮合不可复现；事件「影响从下一回合施加」没钉死也会错位。
- **解法 / 规避**：`seq` 单调号做唯一时间优先级（禁止 `Date.now`）、价格用整数分 `FixedPrice`、随机种子与计数器持久化（`meta` 表）、RNG 每标的每步无条件消费一次；步序钉死「撮合→强平→AI 下单→价格演进」，事件写入后下一回合才影响价格。
- **复发检查点**：同种子跑两遍对账（playtest 已有 MATCH 用例）；重启后回放同一回合；检查撮合模块是否有 `Date.now` 或按分支消费的 `rng`。
- **来源**：`docs/design/stock-exchange-server-20261103.md:532`、`docs/design/stock-exchange-server-20261103.md:197`、`docs/design/stock-exchange-server-20261103.md:571`、`docs/design/stock-exchange-go-migration-20261103.md:42`、`docs/design/stock-exchange-events-64-20261104.md:37`

### 坑 4：股市时钟跟着存档离线结算走 → 给杠杆开后门
- **现象**：玩家离线 30 小时，本地存档只推进 8 小时（离线结算上限），若股市也按存档时间走，离线期间就能躲过强平与行情。
- **根因**：资金侧改成「本地存档为准」后，容易误以为市场也可以本地推进；但真股市不能停摆，否则长线玩家可借「离线不结算」规避爆仓风险。
- **解法 / 规避**：股市按真实墙钟 7×24 连续运行，本地离线结算上限（8h / 双技能 32h）不作用于股市；玩家离线期间行情照走、挂单照成交、强平照发生，上线以服务端状态为准；界面注明「你离线期间市场走了 N 小时」。
- **复发检查点**：断线 30h 后重连，核对强平记录与时间差提示；检查离线结算代码是否误用了股市时钟；确认资金本地化没有关掉服务端行情循环。
- **来源**：`docs/design/stock-exchange-server-20261103.md:157-162`、`docs/design/stock-exchange-handoff-20261104.md:74`

## 二、价格、波动与限幅

### 坑 5：涨跌幅只钳一处 → 漂移路径绕过限制
- **现象**：生产同标的单回合出现 +21.61% / −17.62%，远超 ±3%（事件回合 ±8%）口径。
- **根因**：价格引擎输出、集合竞价清算价、结算后价格模型是三条路径，只钳其中一条时，模型自身漂移会在下一回合把价格带出界；旧稿「不设硬涨跌停」的历史口径已被回合限幅取代。
- **解法 / 规避**：三处统一钳制（引擎输出 + 清算价 + 结算后价格模型同步）；限幅按波动档缩放（SMHI ×1.0=3%、UGMC/ABSI ×1.25=3.75%、OJLS ×1.5=4.5%，事件回合 800bp 同比例）；封板时超限价委托不成交；保留回滚文件与开关。
- **复发检查点**：部署后盯第一个结算回合四标的 Δ 是否全在限内；构造连续单边行情跑多回合看是否累积越界；`/meta` 确认 `roundLimitBp/roundEventLimitBp`。
- **来源**：`docs/design/stock-exchange-integration-20261103.md:144-146`、`docs/design/stock-exchange-round-model-20261103.md:89-92`、`docs/design/stock-exchange-server-20261103.md:200`（历史口径）

### 坑 6：波动参数照抄会失控，调过头又会长期顶死限幅
- **现象**：初期价格长期贴在 ±3% 边界、几乎每回合顶死；或按参考资料直接折算后波动明显失控。
- **根因**：参考资料 `σ=0.02/2.5s` 直接折算到 60s 必失控；现货 `noiseStep=0.04/shockPerTrigger=0.1` 是物资本位参数，照抄会同质化；限幅当安全阀时阈值又不能太窄。
- **解法 / 规避**：按单位时间 √秒 缩放重新标定（σ 每回合 1.7%~3.8% → 0.35%~0.52%，高/中/低流动 0.00030/0.00025/0.00020），波动放大上限 4→1.6；校准后 8 回合实测中位 |Δ| 0.90%~1.87%、p90 1.49%~3.75%（事件回合最大 10% 属预期）。
- **复发检查点**：连续 8 回合统计中位/p90 |Δ| 与顶限次数；改动 σ/scale 后用同一段种子对比；确认没有照抄现货的 `noiseStep/shockPerTrigger`。
- **来源**：`docs/design/stock-exchange-server-20261103.md:571`、`docs/design/stock-exchange-integration-20261103.md:176`、`docs/design/stock-exchange-integration-20261103.md:179`

### 坑 7：回合内 10 秒步进与「K 线 5 分钟一根」的口径冲突
- **现象**：回合内行情每 10 秒在动，但 M1 图不动、M5 图要等回合末；玩家读图与报价不一致；尝试做 10 秒级 K 线时数据对不上。
- **根因**：回合模型先定「K 线 5m 一根、1m 由 5m 前向填充」；后加的回合内步进只更新内存价格、钳制与做市盘口并广播 `stocks`/`book`，**不撮合、不写 K 线**——这是刻意分层，不是漏写。
- **解法 / 规避**：把「刷新频率」与「成交/落库」分开陈述：报价 10 秒、账户/盘口 10 秒、K 线约 30 秒拉但数据仍按回合；若要 10 秒级 K 线，需引擎在回合内 upsert 1m bar（当前未做，属已知取舍），不要用前端插值伪装。
- **复发检查点**：回合内观察报价跳动与 M1 是否同步；检查 K 线接口是否仍按回合边界返回；确认 `EXCHANGE_INTRA_TICK_SEC=0` 时行为回到纯回合制。
- **来源**：`docs/design/stock-exchange-handoff-20261104.md:51`、`docs/design/stock-exchange-handoff-20261104.md:105`、`docs/design/stock-exchange-round-model-20261103.md:15`

## 三、杠杆、做空与资金闸门

### 坑 8：90x 的数学与费率不匹配 → 开仓即死或插针打穿
- **现象**：高杠杆仓位几分钟就被强平；玩家觉得「输给手续费而不是市场」；一次盘口插针直接爆仓。
- **根因**：90x 下 IM≈1.11%、MM≈0.67%，多头强平距离仅 0.447%，日波动 8% 时随机行走平均 4~5 分钟就触碰；若费率仍按平费口径，一轮往返=保证金 27%（判红）；强平若按单笔成交价，插针即可打穿。历史上曾按「最高 50x」裁决，后统一到 90x。
- **解法 / 规避**：名义费率随档下调（L≤20x 买 0.05%/卖 0.10%、20x<L≤50x 0.03%/0.06%、L>50x 0.02%/0.04%，一轮往返占保证金 20x≈3.0%/50x≈4.5%/90x≈5.4%）；强平用 5~10 秒中位价（标记价）而非单笔成交价；允许负余额 ⇒ 必须配欠款/破产清算/保险基金，绝不凭空补穿仓。
- **复发检查点**：算一遍各档「一轮往返费/保证金」是否随杠杆下降；核对强平判定用的是中位价；负权益用例是否产生欠款而不是被系统补平。
- **来源**：`docs/design/stock-exchange-server-20261103.md:207-209`、`docs/design/stock-exchange-server-20261103.md:228-231`、`docs/design/stock-exchange-server-20261103.md:513`（历史裁决）、`docs/design/stock-exchange-playtest-20261103.md:79-82`、`docs/design/stock-exchange-economy-pvp-20261103.md:13`

### 坑 9：双钱包两套账 → 新玩家入金报「钱包信用点不足」
- **现象**：新/老玩家首次入金失败，提示服务器钱包余额不足；内测靠人工给账号拨 5000 万（历史处置，已被取代）。
- **根因**：服务器 `wallets` 表与游戏存档 `state.wallet.isk` 是两套账，服务端钱包只有系统记账才有余额；游戏存档不会自动同步。
- **解法 / 规避**：现行口径「存档币本地为准、服务器只记交易所账」——`EXCHANGE_LOCAL_SAVE_MODE=1` 下入金只记交易所现金、不再调 Node 钱包桥，出金反向加回本地；保留旧链路作回滚开关；操作幂等 nonce、回执与 `exchange_transfers` 审计保留。
- **复发检查点**：新账号入金/出金核对本地 ISK 与交易所现金对平；关掉 `EXCHANGE_LOCAL_SAVE_MODE` 验证回滚链；确认没有新代码又去查服务器钱包余额。
- **来源**：`docs/design/stock-exchange-integration-20261103.md:154-160`、`docs/design/stock-exchange-products-20261104.md:10-16`、`docs/design/stock-exchange-handoff-20261104.md:74-75`

### 坑 10：人格只存 holdings 不存 positions → 重启丢空头仓位
- **现象**：生产重启后 AI 人格的空头仓位/保证金消失，对账对不上。
- **根因**：持久化只写了 holdings，positions（多空明细）没落库；重启按 holdings 重建，空头直接丢。
- **解法 / 规避**：新增 `exchange_agent_positions` 表 + `SaveAgentPosition/LoadAgentPositions`，`saveAccountTx` 人格分支补落库、`initAgentsLocked` 恢复多空持仓，并加跨重启测试；同理券源池余额（`borrow_pool`）也必须持久化。
- **复发检查点**：开空后重启，核对 positions/保证金/`borrow_pool` 三处；跑跨重启用例；检查是否仍有仓位只写在 holdings。
- **来源**：`docs/design/stock-exchange-short-selling-20261103.md:10-11`、`docs/design/stock-exchange-integration-20261103.md:178`

### 坑 11：券源可以「凭空造」/事务不同步 → 空头敞口无背书
- **现象**：空头成交但券池没扣，或保证金扣了券源没扣；并发下同一份券被借两次。
- **根因**：借券与保证金若不在一个事务里，任一步失败都会留下半边；券源若从虚拟账本临时生成，等于允许无限做空。
- **解法 / 规避**：券源与保证金单事务；开空从池中扣减并记 `exchange_borrows`，池不足返回 `borrow_unavailable`；平空/强平归还池；单账户借券上限按池比例（设计 20%）。注意**实现缺口**：该上限与 util>80% 提保证金仍未实现，借券费是销毁而非归系统；设计「流通股本×2%」与实现「10 万股/标的」口径漂移。
- **复发检查点**：并发两笔开空同一标的看池扣减；强平后券池是否恢复；对比设计文档与 `short.go` 的池口径。
- **来源**：`docs/design/stock-exchange-short-selling-20261103.md:12`、`docs/design/stock-exchange-short-selling-20261103.md:32-35`、`docs/design/stock-exchange-short-selling-20261103.md:70`

## 四、经济闭环与 AI 人格

### 坑 12：均值回归锚点太强 = 稳定发钱机
- **现象**：`价值锚点` 策略仿真 100% 存活、99.6% 盈利、期望 +165%，被判印钞；试「锚点漂移 + 自适应回归阻尼」，k 从 8 扫到 800、锚点日漂移 σ 从 1% 扫到 8%，**全部仍判印钞**（k=800 仍 +116%）。
- **根因**：不是锚点可见，是量化模板「+62.5% 止盈 / −17.5% 止损」的赔率结构在吃残余均值回归；削锚点只会让收益变慢，不会消失。
- **解法 / 规避**：改模板（止盈 +15%~20%、持有 ≤2 日）或加持仓成本；写死结论「不能拿锚点漂移当修复」；立场是「任何让 ISK 从无变出来的路径都不允许」。
- **复发检查点**：同一策略在不同波动档重跑期望收益与盈利面；确认修复落在模板/成本而非锚点参数；检查是否又加回「高胜率小赔率」模板。
- **来源**：`docs/design/stock-exchange-playtest-20261103.md:84-88`、`docs/design/stock-exchange-economy-pvp-20261103.md:15`、`docs/design/stock-exchange-economy-pvp-20261103.md:58`

### 坑 13：人格盈亏没有资产负债表 → 凭空补钱/凭空印钱
- **现象**：人格亏损时系统直接补钱；或人格盈利被当成普通资金继续流通。
- **根因**：把 AI 当「无限资金对手盘」，没有独立资本账户与上限；盈利若不沉淀，玩家赚的钱又回到市场；亏损若凭空补，等于印钞。
- **解法 / 规避**：每个人格独立资本账户、初始资本受控；盈利进池不再投入流通（=销毁），超上限转销毁池；亏损只能从销毁池按比例补给，**不得凭空生成**，池见底则人格缩量/退出；分红池同样不允许凭空印钞。
- **复发检查点**：核对人格亏损补给是否只从销毁池出、盈利是否沉淀；分红池来源是否为交易税/佣金/有限额度；AI 是否与玩家同一套下单接口（不享特权）。
- **来源**：`docs/design/stock-exchange-economy-pvp-20261103.md:110-111`、`docs/design/stock-exchange-server-20261103.md:281`、`docs/design/stock-exchange-ai-ecosystem-20261103.md:153`

### 坑 14：网格模板在 8% 波动下必亏，指标口径还测不出决策密度
- **现象**：3x 网格在 8% 波动 A/B/C 三组回测 −93.8% / −94.2% / −78.6%，远低于 −50% 劝退线；同时「决策密度」实测 0.000~0.076 次/分，远低于目标 0.2~1.5/分。
- **根因**：模板与波动档不匹配（高波动把网格打成单边）；而「行情变动次数」不等于「可操作决策次数」，指标口径错，所以看不出玩法空转。
- **解法 / 规避**：8% 波动下删掉 3x 网格模板，只保留「日波动 ≤4% + 1x」；决策密度改为「可操作事件/高频 1 分钟决策」口径；事件均值建议 15 分钟，但提高频率并不改善杠杆玩家存活。
- **复发检查点**：新模板必须按波动档分别回测并记录破产率；指标口径变更要重跑基线；确认「提高事件频率」没被当成万能修复。
- **来源**：`docs/design/stock-exchange-playtest-20261103.md:90-93`、`docs/design/stock-exchange-playtest-20261103.md:97-98`

## 五、客户端接入与 UI/UX

### 坑 15：CSP 先拦你，不是 API 先连不上
- **现象**：前端 fetch/WS 全部失败，但服务端 curl 正常；网页版还叠加混合内容拦截。
- **根因**：桌面渲染层 CSP 是 `connect-src 'self' ws:`——任意 `http(s)://服务器:8787` 的 REST 会被拦，只放行 `ws:`；网页版 `connect-src 'self'` 全拦；preload 没有任何网络桥，渲染层拿不到 fetch/WS 通道。
- **解法 / 规避**：接入前先定通道方案（主进程代理 / 放宽 CSP / 同源反代），两端共用同一份 TS 客户端协议层；不要先写前端再补通道。
- **复发检查点**：新客户端环境先跑一次 fetch + WS 连通性探针；检查 CSP 是否仍为 `'self' ws:`；确认 preload 没有偷偷扩网络桥。
- **来源**：`docs/design/stock-exchange-server-20261103.md:36-41`、`docs/design/stock-exchange-server-20261103.md:147-155`

### 坑 16：图表「空 / 不更新」是数据到达顺序问题
- **现象**：左栏 Sparkline 小曲线消失；非 SMHI 标的图表一直「初始化中」；切标的后盘口/K 线不刷新。
- **根因**：首帧空数据被 `useMemo` 锁死不重算；切换标的只改选中态，没有补拉该标的 K 线与盘口；缓存先渲染但未触发网络刷新。
- **解法 / 规避**：依赖项要覆盖「首次非空」这一跳（该处已去掉锁死式 memo）；切换标的时显式补拉 K 线/盘口；K 线 localStorage 缓存 7 天内先渲染再刷新，后台预载 4 只股票；周期统一 M1/M5/H5/D5/D35（H5/D5/D35 客户端聚合）。
- **复发检查点**：首屏空数据→有数据看小曲线是否出现；快速切换 4 个标的看是否都完成加载；清 localStorage 后首屏是否仍能渲染。
- **来源**：`docs/design/stock-exchange-handoff-20261104.md:103`、`docs/design/stock-exchange-handoff-20261104.md:117`、`docs/design/stock-exchange-handoff-20261104.md:99-102`

### 坑 17：SVG 拉伸与「平盘」会把读数画错
- **现象**：坐标轴刻度文字变形；平盘（极值相等）时曲线贴底；强平安全距离在极端行情/服务器缺省时出现负值或溢出。
- **根因**：`preserveAspectRatio="none"` 会把内部文字一起拉伸；曲线线性映射时极值相等导致贴底/除零；安全距离算法假设了「有最新价、波动正常」，缺省值没兜底。
- **解法 / 规避**：文字改外层 HTML 绝对定位（`.ex-simple-axis-badge`）不参与拉伸；极值相等时垂直居中（`height/2`）；安全距离算法显式 clamp + 缺省值兜底，极危时给脉冲警示与一键全平（二级确认 + Esc 撤销）。
- **复发检查点**：平盘标的截图核对曲线居中；极端行情/断流时看安全距离是否仍为有限正数；缩放窗口看坐标轴文字是否变形。
- **来源**：`docs/design/exchange-ui-ux-audit-20261104.md:20-21`、`docs/design/exchange-ui-ux-audit-20261104.md:30-32`

### 坑 18：玩家文案泄漏内部字段 / 历史快讯被追溯改写
- **现象**：快讯里出现「四象名、冲击 bp、小盘 ×1.5」等内部设定；或改人格展示名时，旧快讯被一起改写，历史记录失真。
- **根因**：内部字段 `Xiang/XiangName/ImpactBp/SmallCap` 确实存在于 `/events` 与 DB，直接复用接口字段渲染就会泄漏；改名若按 key 全量替换，会把历史快讯也改掉。
- **解法 / 规避**：玩家向文案只输出「传闻/确认/升级/失控 + 故事标题 + 公司（代码）+ 标签」与持续回合数，内部字段留在接口与 DB；内部 key 不变、只改展示名与 `/agents` 的 `callsign`，历史快讯保留旧名不追溯改写；事件文案走客户端 l10n。
- **复发检查点**：grep 前端快讯渲染是否直接读 `XiangName/ImpactBp`；改人格名前后对比旧快讯文本；检查 `/events` 仍返回内部字段（允许，但不得进文案）。
- **来源**：`docs/design/stock-exchange-handoff-20261104.md:59-63`、`docs/design/stock-exchange-events-64-20261104.md:76-77`、`docs/design/stock-exchange-server-20261103.md:268`

## 六、部署、联调与交接

### 坑 19：公网入口的两次坑——CF 525 与 SNI/TLS 拦截
- **现象**：外部访问 525，源站直连 200、证书链正常、nginx 无对应请求；本机带 SNI 的 TLS 到源 IP 卡死，未备案域名 80 端口被 302。
- **根因**：Cloudflare 代理链路与回源不匹配；本机网络策略拦带 SNI 的 TLS；未备案域名不能走 80 正常访问。
- **解法 / 规避**：CF 记录改「仅 DNS」后外部 200、WS 升级 101；临时通道用 nginx 80 端口按出口 IP allowlist 提供明文 HTTP 反代，客户端默认 IP 直连、失败回退域名（安全代价已接受，风险需记录）。注意两份文档域名不一致（`shit.fuckrapper.online` vs `game.bajibaji.party`），以现场 nginx/systemd 为准。
- **复发检查点**：外部 `GET /meta` 200、WS 101；换网络/换人后核对 nginx allowlist；`systemctl cat` 与 nginx `-T` 对照文档域名。
- **来源**：`docs/design/stock-exchange-integration-20261103.md:138-139`、`docs/design/stock-exchange-integration-20261103.md:11`、`docs/design/stock-exchange-handoff-20261104.md:33`、`docs/design/stock-exchange-handoff-20261104.md:192`

### 坑 20：内部资金桥暴露 / 单边扣款 / 没有回滚点
- **现象**：`/internal/*` 可从公网打到；Node 超时导致 Go 已扣款但 Node 未入账（或反向）；升级出问题没有可回退产物。
- **根因**：内部接口只靠「内网」假设，没有 nginx 屏蔽与来源校验；跨服务调用没有幂等 nonce 和失败回滚；部署前没备份 DB/源码/nginx 配置。
- **解法 / 规避**：nginx 对 `/internal/` 返回 404，Node 再校验 `x-internal-secret` + 来源 127.0.0.1 双保险；调用带幂等 nonce，失败返回 503 `wallet_unavailable` 且 Go 本地回滚，禁止单边扣款；部署前备份（VACUUM INTO / 源码 tgz / nginx 配置），Go 二进制留 `.prev`，环境开关可一键回滚（LocalSaveMode/做空/限幅/回合内步进各自可关）。
- **复发检查点**：公网 curl `/internal/exchange/wallet-credit` 应 404；断掉 Node 看 Go 是否回滚且不扣款；升级演练走一遍 `.prev` 回滚。
- **来源**：`docs/design/stock-exchange-integration-20261103.md:51-52`、`docs/design/stock-exchange-integration-20261103.md:115-119`、`docs/design/stock-exchange-integration-20261103.md:147`、`docs/design/stock-exchange-handoff-20261104.md:160-176`

### 坑 21：检查项本身有盲区，交接还带着遗留物
- **现象**：根 `npm run typecheck` 绿但 `apps/server` 有类型错误；股票静态定义放 `content-csv/` 读空导致市场空目录；交接环境残留测试账号与债务。
- **根因**：根 typecheck 不包含 `apps/server`；`content-csv/` 被 `.gitignore` 且仓库中不存在；测试账号 `smoke*/bot*/e2e*`、账号 17 债务 383,394、Node/Go 两仓库无远端，都是交接时的真实状态。
- **解法 / 规避**：服务端单独跑 `npm run typecheck -w @whale/server`；股票静态定义放 `apps/server/src/exchange/stocks.ts`（随代码提交）；清理测试账号时避开船长账号（`dadadada` id 18）；交接清单写明无远端与生产冒烟命令（`/health`、`stocks`、journalctl 查 panic/error）。
- **复发检查点**：改完服务端代码确认跑了 `-w @whale/server`；`git check-ignore -v content-csv/`；交接前对账号表与远端做一次盘点。
- **来源**：`docs/design/stock-exchange-server-20261103.md:66-69`、`docs/design/stock-exchange-handoff-20261104.md:148-152`、`docs/design/stock-exchange-handoff-20261104.md:190-191`

## 校验回归清单

- [ ] 下一单：toast 是「待成交」而不是「已成交」，成交状态来自 WS/`/round`。
- [ ] 回合末最后 10 秒提交与撤单：分别得到 409 与「下回合可提交」提示。
- [ ] 同种子跑两遍撮合/事件结果一致；重启后回放同一回合一致。
- [ ] 连续多回合盯四标的单回合 Δ 是否都在限幅内；封板时超价委托不成交。
- [ ] 90x 一轮往返费/保证金是否随档下降；强平判定用 5~10 秒中位价。
- [ ] 新账号入金/出金：本地 ISK 与交易所现金对平；关掉 LocalSaveMode 可回滚。
- [ ] 空头开仓后重启：positions、保证金、`borrow_pool` 三处一致。
- [ ] 首屏空数据→有数据、快速切换 4 标的，Sparkline/图表都能出图。
- [ ] 公网 `/meta` 200 + WS 101；公网 `/internal/*` 返回 404。
- [ ] 服务端改动跑了 `npm run typecheck -w @whale/server`。

## 相关页

- [[whale-stock-market-architecture]]：股市工程白皮书（撮合/引擎/经济）
- [[pitfall-industry-economy]]：经济闭环与印钞检测的同类结论
- [[pitfall-ui-ux-perf]]：图表渲染与视觉读数
- [[pitfall-save-data]]：存档字段与本地钱包
- [[pitfall-tooling-release]]：部署、回滚与检查盲区
- [[pitfall-collab-docs]]：交接文档口径漂移

## Sources

- `docs/design/stock-exchange-handoff-20261104.md`
- `docs/design/stock-exchange-integration-20261103.md`
- `docs/design/stock-exchange-server-20261103.md`
- `docs/design/stock-exchange-round-model-20261103.md`
- `docs/design/stock-exchange-short-selling-20261103.md`
- `docs/design/stock-exchange-playtest-20261103.md`
- `docs/design/stock-exchange-economy-pvp-20261103.md`
- `docs/design/stock-exchange-products-20261104.md`
- `docs/design/stock-exchange-events-64-20261104.md`
- `docs/design/stock-exchange-ai-ecosystem-20261103.md`
- `docs/design/stock-exchange-go-migration-20261103.md`
- `docs/design/exchange-ui-ux-audit-20261104.md`
