# 证券交易所界面文案与方向配色整改（2026-11-05）

状态：实施中，未验收、未发布。经办：主代理；分支 main；2026-11-05。

## 授权与范围
船长原话：「股市系统的界面有很多问题，没有逻辑。文案千奇百怪的。」「咱们可以先审查一下股市系统的UI问题，仅限新版UI，"科幻未来"设置里这个选项。然后再做上面提到的事。」「你直接开工，我出门吃饭回来检查」。
一轮确认：范围＝文案口径／布局与信息层级／操作流程／按钮色彩语义；术语基准＝「保留下注但两域隔离」；交付＝「文案加界面结构」。
只改「科幻未来」（modern）布局下的 `features/exchange/` 域。股市本就 modern-only（`App.tsx:1405` 在 classic 过滤导航），旧版一个字不动。功能域：证券交易所 UI；同类参照：同域 `StockList.tsx` / `SimpleStockList.tsx` 的 `stockName()` 取词方式。未跨域。

## 不做
- 不动 classic 布局、`styles.css` 全局圆角兜底、`packages/data` 的 l10n 表、数值与经济、服务端、真档、公告。
- 不迁本地化架构；英文侧 `EN_T` 保留不动（未获英文准备授权），中英漂移列为待裁决。
- 不新增玩法、不改杠杆上限、不改 `Records` 组件去留、不改圆角数值（全局兜底已强制直角）。
- 无红框截图，「留白／拥挤」类观感项不做；流程逻辑无确凿矛盾证据，不改行为。
- **冲突停下**：不把极简右栏默认页从「理财与基金」改为「我的委托」。依据 `docs/design/exchange-feedback-20261105.md:6,19` 船长另一批在途裁定「简单默认理财与基金」；推翻已确认设计须重新裁决。该文件带未解决冲突标记（`:49,55,56`），本批不读改、不回滚。

## 依据
现行 `AGENTS.md` §5/§6、`docs/development-conventions.md` §九(63-67)／§十三(116-122)、`docs/design/cosmic-hud-layout-20261102.md:17-19`、`docs/design/deep-space-exchange-pro-refinement-20261103.md:27-28`。
wiki：`.wiki/concepts/human-centered-design.md`（verified，可理解性与评估鸿沟）、`.wiki/projects/pitfall-ui-ux-perf.md`（extracted，主题令牌字面量）、`.wiki/projects/pitfall-l10n-copy.md`（extracted，内部键名与开发残留）。两页自标非现行规则，冲突时以现行文件与代码为准。
`ui-ux-pro-max` 未注入；Serena `mcp__serena-eve__*` 未注入，降级 read/grep，范围限本批。

## 文案调整登记（⟪文案调整 2026-11-05⟫，船长报障「文案千奇百怪」／裁定「两域隔离」）
位置均为 `features/exchange/texts.ts` 的 `ZH_T`；英文 `EN_T` 未动。

| 键 | 原文 | 新文 | 原因 |
|---|---|---|---|
| `indexName` | 星海综合指数 | 星深综合指数 | 与 `marketBroad`／`indexShortName` 的「星深」统一 |
| `resetMockHint` | 回到 1,000 万启动资金；只清空交易所模拟数据，不影响游戏存档 | 重置为 1,000 万启动资金；不影响游戏存档。 | 去掉实现机制，保留玩家关心的存档安全信息 |
| `guideHint` | …；原型阶段默认为模拟盘。 | …填写服务器地址。 | 清除原型／版本语境 |
| `recordsEmptyDividends` | 暂无分红（每 60 秒按现货持仓象征性结算一次）。 | 暂无分红。 | 清除原型「象征性」话术与重复读数 |
| `simpleBuyHint` | 看涨下注，价格上涨即享盈利 | 看涨下注 | 去绝对推销断言 |
| `simpleShortHint` | 看跌下注：借券卖出，卖多少股就占用多少资金，手续费 0.1%；价格下跌即获利 | 看跌下注 | 去实现机制、费率读数与推销断言 |
| `inputAmountLabel` | 买入金额 | 下注金额 | 极简域串用专业域「买入」 |
| `closeAllPositions` | 一键全部平仓 | 一键全部结算 | 极简域串用专业域「平仓」 |
| `systemPresetTag` | 系统预置 | 预置持仓 | 去内部语境 |
| `systemPresetTip` | 演练预设仓位：系统初始配置用于测试功能 | 开局预置的持仓 | 去「演练／测试功能」开发话术 |
| `cashierDepositHint` | 从本地存档扣除信用点转入交易所，服务器只记交易所账。 | 从本地钱包扣除信用点，转入交易所。 | 去存档／服务器记账实现细节 |
| `cashierWithdrawHint` | 从交易所转回本地存档，即时到账。 | 从交易所转回本地钱包，即时到账。 | 同上，改用界面既有「本地钱包」 |
| `cashierPendingMismatch` | …（同 nonce 幂等）… | …（同一笔流水不会重复处理）… | 玩家可见文本不得含内部字段名 |
| `simplePendingTitle` | 本回合待成交委托 | 本回合待成交下注 | 极简域串用专业域「委托」 |
| `confirmCloseAll` | 确定全部结算? | 确定全部结算？ | 中文全角标点 |
| `confirmCloseAllTooltip` | 再次点击立即结算全部下注！ | 再次点击立即结算全部下注 | 去感叹号，与同组语气统一 |
| `confirmCloseAllHelp` | 以市价全部结算该标的下注与仓位 | 结算全部下注 | 去「仓位」串用与市价机制 |
| `orderReadyHint` | …直接下单… | …提交下注… | 极简域串用专业域「下单」 |
| `indexName`（验收二次调整） | 星深综合指数 | 星深综指 | 船长验收「顶栏指数名观感不好」：改用与大盘卡一致的 4 字短名，顶栏中区不再被 6 字全名占着 |
| `TF.closePosDone`（中文分支） | 已提交${side}平仓：… | 已提交${side}的结算：… | 上轮漏改：该函数只被极简 `SimplePosition.tsx:160` 调用；专业域 `positionClosed*` 按两域隔离保留「平仓」 |

组件内同步：`SimplePosition.tsx` 的「取消全部平仓」「市价全平」改为「取消全部结算」「结算 … 下注」，持仓行标签由专业域「开空／杠杆多头」改用既有极简键 `simpleLeverageShort`／`simpleLeverageLong`（配合 `· Nx` 与现货行区分）。三个值全为「结算下注」的 `simpleClose*` 键及 `simpleLeverage*` 等既有死键按纪律不删不改。

## 界面改动
- `SimpleExchange.tsx`、`chart/Chart.tsx`：公司名统一走 `stockName(code, nameKey)`，与同屏左栏列表一致，消除联机态抬头显示代码、列表显示中文名的分裂。
- `exchange.css`：主按钮改由 `--ex-action-tone`／`--ex-action-ink` 驱动，`is-buy` 取看涨色、`is-short` 取看跌色，替换写死橙黄 hex 的 `!important`；hover/active/disabled 一并走令牌。
- 同步漂移注释：`SimpleTrade.tsx`、`ProExchange.tsx`、`ExchangePage.tsx`、`exchange.css:4433`。

## 验证（2026-11-05，均实跑通过）
- `read_lints` 0 诊断；`npm run typecheck`、`content:check`、`ui:rot-check`（4 子检查）、`ui:theme-check`（3 子检查）、`l10n:check` 全绿。
- `node --import tsx --test tools/exchange-feedback.test.ts`：5/5 通过。
- `npm run build`：electron-vite 三阶段成功；既有 `perf.ts` 动态/静态导入提示属基线，本批未引入。
- `git diff --stat`：8 个文件、58 增 / 45 删，全在 `features/exchange/`；另新建本工作文档。
- `scope:check`：⚠ 7 个股市文件「未归类」，系静态域表未登记交易所域（工具自述「域表要补」），非跨域证据；本批未改域表。
- 未跑：全量 core 回归（按规则留集中验收）、隐藏 Electron 几何/取色取证、浏览器观感验收。CSS 方向色仅经静态令牌与级联推演，未经实机取色，观感由船长验收。
- 新工作文档未跑 `npm run docs:index`：按 §8 该索引在归档时点重跑，本批仍实施中。
- 验收复跑（顶栏短名 + 结算回执补漏）：`typecheck`、`l10n:check`、`npm run build` 再次通过；本轮无 CSS 改动，`ui:rot-check` / `ui:theme-check` 未重跑。

## 待裁决
1. 极简右栏默认页（与 `exchange-feedback-20261105.md` 在途裁定冲突，本批未动）。
2. `EN_T` 保留旧词导致的中英漂移，是否启动英文准备；英文侧 `systemPresetTip` 仍含「for feature testing」开发话术。
3. `texts.ts` 原型文案未转 l10n id（`l10n:check` 报 470 条未译字面量，报告口径不阻断），是否立项迁表（跨域、需单独批准）。
4. `scope:check` 域表缺交易所域，是否补登记。
5. `Records`：11-03 设计稿写「移除」，实现为中栏二级 Tab，是否与注释统一。
6. 无红框截图，布局留白/拥挤与圆角被全局兜底压平后的形态未做主观调整。
7. 船长第三句「我的下注里没看到有平仓啊」有歧义：若是确认文案已无「平仓」，本批完成；若是找不到平仓功能，则需推翻「两域隔离」裁定才能让「平仓」字样回来，本批未擅自改回。按钮与入口都在，只是文案为「结算」。
8. 顶栏指数名：本轮默认改短名「星深综指」；若嫌的是「星深」一词，回退「星海」系并同步大盘卡；若嫌的是整块样式，需红框截图，本批不动几何。

## 追加批：K 线成交量口径修复（2026-11-05）
授权：船长一轮裁决选「修数据＋出选型对比」（先修完数据口径，同时给开源候选库对比，不落码、不加依赖）；现象栏仍填「对不上号」未细化，按代码可证缺陷全覆盖修，不追问第二轮。
依据：`docs/development-conventions.md:17`（报障要写复现路径/根因/现象/改法）、`:22`；`.wiki/references/designing-interfaces-tidwell.md`（verified，`:20` 模式不是照抄模板、要平衡上下文制约力）；wiki 无「K 线图表库选型」专门页（记缺口）。

### 根因与改动（只改数据层，未动绘制层、未加依赖）
| 位置 | 根因 | 改动 |
|---|---|---|
| `chartPeriods.ts:218` `sampleSeries` | 分时均匀挑点，被跳过根的成交量凭空消失 | 按桶合并求和，价格仍取桶末根 |
| `http/HttpExchangeClient.ts` `updateIntraCandles` | 新桶 `v: 0`、同桶只改价不改量 ⇒ 服务器源最新一根恒 0 | 用 `volume24h` 增量累加当前桶，新增 `lastVolume24h` 基准；`ponytail:` 注释标明跨桶调用会记到当前桶，逐笔精确需服务端推送成交量 |
| `mock/history.ts:68-82` | 每秒一笔量累加到所有周期末根，历史根按 `sqrt(barSeconds)` 合成，量级不一致 | **本批未改**：涉及「一根 K 线的量是否等于桶内逐笔之和」的产品定义，待裁决 |

### 确定性用例（不新建测试档，§9 小修不配；命令与读数可复跑）
`rtk node --import tsx -e "…sampleSeries…"`：1440 根 × 每根 10 量 → 抽样 240 根。
修复前 `volumeBefore 14400 / volumeAfter 2400 / volumeLost 12000`（丢 83.3%）；修复后 `14400 / 14400 / 0`，`PASS: 抽样成交量守恒`。
P2 未写独立用例（需构造 transport 与缓存），由 typecheck、静态契约与股市专项回归覆盖，如实记录。

### 验证
`read_lints` 0 诊断；`typecheck`、`content:check`、`ui:rot-check`（4 子）、股市专项 5/5、`npm run build` 三阶段全过（既有 `perf.ts` 导入提示属基线）。`git diff --stat` 累计 10 文件 / 72 增 / 49 删。本轮无 CSS 改动，`ui:theme-check` 未重跑。未跑全量 core 回归（留集中验收）、未做实机取色/几何、未用真档。

### 开源图表库候选对比（未落码、未加依赖；公开资料与仓内约束对照，未做实机接入验证）
| 候选 | 许可与署名 | 体积 | 与本仓约束的摩擦 |
|---|---|---|---|
| TradingView Lightweight Charts | Apache-2.0，**官方要求用户可见页面保留 TradingView 署名**（`attributionLogo`） | 官方称 35 KB | 摩擦最小：空心 K 线、成交量、滚轮缩放、秒级周期、高频 `series.update()` 现成；但主题是 JS 配置对象而非 `--wui-*` CSS 变量，6 套主题需每次重设 options；自带十字光标/提示需让位给 `ui/Tooltip.tsx` 单例；署名进玩家可见界面须按 §5.3 单独批准 |
| KLineCharts | Apache-2.0（第三方许可核查站） | 未核实 | 无依赖、无官方 React 封装，需自己在 effect 挂 div 管生命周期；同样要把 `--wui-*` 映射成样式配置对象 |
| Apache ECharts | Apache-2.0 | 未核实（明显大于前两者） | Canvas/SVG 双渲染、20+ 图表类型，通用但最重；`setOption` 全量更新对 1 秒 tick 不划算 |

共同代价（与选哪个库无关）：六周期数据、mock/http 双数据源、一级页不滚、11-03 已验收的阴阳线标准、四项 UI 静态契约、构建体积（当前 renderer 7.47 MB）都要重接或复核。
既有裁定：`docs/design/cosmic-hud-layout-20261102.md:29-35` 评估过开源 UI 全家桶，与原生 `--wui-*` 令牌／高频 tick／一级页不滚冲突，裁定「0 新增外部 npm 依赖」；**仓内无「禁止图表库」明文**，但新依赖与该裁定有张力，按 §5.2 需船长裁决。
推荐：本批不换。add when 需要画线工具／多指标／跨图联动／导出，或自研维护成本超过接入成本，且批准新依赖＋主题适配＋署名与许可核查，按 §2 走一轮设计总结。

### 新增待裁决
9. `mock/history.ts` 成交量口径三选一：①历史合成量改线性时间口径（一根 = 桶内逐笔之和，与 24h 累计自洽）②实时累加改按历史合成量缩放 ③保持现状仅补口径说明。本批未擅自选。
10. 是否立项引入开源图表库（本批只出对比、未落码、未加依赖）。

## 追加批：简单投资界面 wiki UI/UX 整改（2026-11-05）

状态：实施中，未验收、未发布；经办主代理，分支 main。与在途股市批次合并（船长裁定③「合并」）。

### 授权与一轮裁定

船长原话（对上轮三问）：「1、一起改 2、回合末集合竞价 3、合并」。据此：范围＝文案/反馈/口径 **＋** 方向色与右栏信息密度一起改；现行成交口径＝回合末集合竞价；本批与在途 exchange 批次合并交付。

### 依据与工具

wiki 分层检索（`.wiki/index.md` → 标题/frontmatter 命中 → 精准读；双链仅扩一跳 Enders→诺曼）：`.wiki/references/designing-ux-forms-enders.md`（verified，禁用主按钮是「静默的暴政」、失焦校验、双向实时结算前馈）、`.wiki/references/norman-design-of-everyday-things.md` 与 `.wiki/concepts/human-centered-design.md`（verified，系统表象/评估鸿沟、警告疲劳、撤销优于确认）、`.wiki/references/designing-interfaces-tidwell.md`（verified，Preview / Safe Exploration / 良好默认值）、`.wiki/references/universal-principles-of-design.md`（verified，Forgiveness / 渐进呈现 / 信噪比）、`.wiki/references/color-theory-dan-scott.md`（verified，明度为骨、灰度化仍可辨）、`.wiki/projects/pitfall-stock-exchange.md`（extracted，提交只报「本回合待成交」）、`.wiki/projects/pitfall-ui-ux-perf.md`（extracted，`tabular-nums`）。两页自标非现行规则，冲突时以现行 docs 与代码为准。
`ui-ux-pro-max` 未注入（§九之八），如实记录并按 wiki＋现行稿替代依据；`dsh-knj-obsidian`、`mcp__serena-eve__*` 未注入，降级 read/grep 只读取证。

### 方案、边界与取舍

- 只改 modern 布局下 `features/exchange/` 与共享 l10n 表；不动 classic、core、服务端、真档、公告、数值与经济。
- **回合末集合竞价**：依据 `docs/design/stock-exchange-round-model-20261103.md:11,14,36`，服务端统一回合末批量撮合。`SimpleTrade.tsx` 的 `tif:'IOC'` 只是客户端兼容占位、不代表即时成交；本批只统一注释与玩家可见文案，**不改交易契约**（沿用 `exchange-ui-ux-audit-20261104.md` 已完成批次「不改后端协议」边界）。
- **确认机制**：按 wiki「警告疲劳／Preview／Forgiveness」，不新增确认弹窗，也不接 `round.ts` 未接线的本地队列；撤销能力复用既有「我的委托」撤单（`MyOrders.tsx` 仅 `queued` 可撤、锁定窗口置灰、配额不返还），并在待成交区明确告知。
- **方向冗余**：`▲/▼` 符号 ＋ 分向动宾文字；不改现行方向色板（上一批刚改、待实机取色与船长观感验收）。
- **右栏密度**：保留默认「理财与基金」（`exchange-feedback-20261105.md` 在途裁定，不推翻已确认设计），只给 orders 页的持仓/委托加分组标题，不折叠隐藏内容（§九「内容必须完整可达」）。

### 改动清单

| 文件 | 行为变化 |
| --- | --- |
| `format.ts` | 新增 `estimateSimpleBet` 单点：股数/手续费/费后实际支出/提交后可用（含全仓费后取整差额），供买卖舱就地前馈 |
| `SimpleTrade.tsx` | 主按钮改 `aria-disabled` 保持可点，点击时聚焦输入框并说明原因；分向动宾文案＋方向符号；金额前馈明细；待成交列表与 title 统一走 id 的回合末口径；去掉串域校验文案与内联硬编码 |
| `SimpleChart.tsx` | 12 秒停表改「行情暂未加载」并给「立即重试」按钮（`ensureChartData`） |
| `SimplePosition.tsx` | 空持仓加「去下注舱」按钮，聚焦中栏输入框 |
| `SimpleExchange.tsx` / `exchange.css` | orders 页持仓/委托分组标题、空态按钮与分组样式；未改方向色值 |
| `texts.ts` / `table.ts` | 中文文案调整（见下）+ 新增 `ui.exchangeTexts.462–465` |
| `tools/exchange-simple-ux.test.ts` | 新增金额前馈 5 条确定性用例 |

**⟪文案调整 2026-11-05⟫**：`272/273`「立即下注·涨/跌」→「提交看涨下注/提交看跌下注」（去即时成交误导、动宾分向）；`283`「左侧下注舱」→「中栏下注舱」（方位纠正）；`TF.simpleOrderDone` 中文「委托」→「下注」（两域隔离）；英文侧按规则保留，既有中英漂移仍列待裁决。

### 验证

- 通过：`npm run typecheck`、`content:check`、`ui:rot-check`（4 子）、`ui:theme-check`（3 子）、`l10n:check`、`arch:guard`、`scope:check`、`npm run build`、股市专项 `exchange-feedback.test.ts` 5/5、新增 `exchange-simple-ux.test.ts` 5/5、`read_lints` 0 诊断。
- `l10n:check` 曾因他人在途英文迁移批次（清掉 300+ 条 `enDeferred` 并补齐英文、待译登记未同步）临时判红；对方会话自行完成收口，本批只撤回自己新增的 4 条待译登记（4 个新 id 已被对方补上英文），最终重跑通过。期间本批未回滚、未抢修他人内容。
- 未跑：全量 core 回归（留集中验收）、隐藏 Electron 几何/实机取色、浏览器观感验收、真档。

### 在途冲突与待裁决

1. 开工时 `.gitignore`、`NewsTicker.tsx`、`HttpExchangeClient.ts`、`texts.ts`、`table.ts` 有他人未提交改动；工作期间 `table.ts` 曾出现 `},,` 语法损坏中间态，随后对方会话自行修复并补齐英文。本批未回滚、未抢修他人内容。`docs/design/exchange-feedback-20261105.md:49,55,56` 的未解决冲突标记本批未碰，等待协调。
2. 合并批次仍含他人未提交文件（英文迁移、快讯轮播、`.gitignore`），本批未擅自提交、未推送；是否由本批一并本地提交需与对方会话/船长确认。
3. 方向色是否补明度/形状冗余通道（本批只加符号与文字）；提交后短撤销窗口是否要接 `round.ts` 本地队列。
