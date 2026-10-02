# core 侧裸中文上屏盘点（本地化尾巴 · 盘点稿 · 2026-10-02）

**状态：盘点稿 —— 只出清单，零代码改动**（船长 2026-10-02 令「先做下一步」＝ 三号提的 **B-3**：
「把 core 那 ~102 行未带 id 的中文 `return` 逐处核真伪、列出『哪些真会漏到英文界面』的清单给你挑」）

**经办**：三号（`H:\大鲸鱼\Deepseek-EVE-verify`，分支 `verify`）

## 1. 读数（探针实测，非估算）

| 项 | 条数 |
|---|---|
| core/src 里 `return` 带中文的行 | **239** |
| ├ 同处带 `errorId`/`textId`（**甲案合规**，中文原串 + id 双写） | **138** |
| └ **未带 id** | **101** |
| 　　├ 其中"中文其实在注释/比较里"的**假阳性**（返回 number/boolean） | **7** |
| 　　└ **真候选**（中文是返回的字符串字面量） | **94** |
| 　　　　├ 渲染层**有真调用点**（值可能上屏） | **45** |
| 　　　　│　　├ 假阳性再剔 4（`typeLayerMult` 数字 / `beaconLaunchHighSecOf`·`haulExposureAt` 布尔 / `buyAtMarket` 英文枚举键） | 41 |
| 　　　　│　　├ **A 类 · 已证会上屏**（我逐个看了渲染点） | **37** |
| 　　　　│　　└ **B 类 · 待核**（调用点已证、渲染点未逐一看） | **4** |
| 　　　　└ 仅 core 内部 / 工具 / 测试用（**不影响玩家**） | **49** |

### 1.1 ⚠ 上表**只覆盖 `return` 型** —— 补扫另两类后（本轮新增，见 §3.5）

| 类别 | 总数 | 带 id | **裸中文** |
|---|---|---|---|
| `addLog(state, kind, 文本)` 日志行 | **393** 处 | 279 处 | **92 处** |
| `state.<字段> = 中文串`（随档提示） | —— | —— | **1 处**（＋1 处派生自 return 型） |

⇒ 三类合起来，按**当时的探针**估 ≈ 139 处。

**🔴 2026-10-02 按期更正（做批① 时发现）**：那个探针只认**行首** `return`，漏了 `if (…) return …` **行内形态**。
转正后的工具（`npm run l10n:core-zh`，已修掉该漏判）全仓读数是 ——

| 类别 | 更正后 |
|---|---|
| return 型（含行内） | **173** 处 |
| addLog 型（core ＋ 渲染层 game/） | **97** 处 |
| state 赋值型 | **1** 处 |
| **合计** | **271** 处（其中渲染层引用了该函数的 **121** 处） |

⇒ **以 271 为准**，本条上面那几张小表只作"当时那一版探针"的过程留档（`shipyard.ts` 就是被行内形态从 10 条补到 **19** 条的实例）。
这比最初那句「core 里约 102 行未带 id 的中文 `return`」要大 —— 因为**日志行是另一条独立的漏口**：`addLog` 的第 4 参 `textId` 缺了，英文界面那一整行就是中文。

**判据**：英文界面之所以会夹中文，是因为渲染层拿到 core 的中文串后**没有 id 可查**（甲案要求：中文原串照写 ＋ 另给 `errorId`/`textId`，界面走 `cmdText()` 按当前语言渲染；没 id 就只能显示中文原串）。

## 2. A 类 · 已证会上屏（37 条 · 按功能域分组）

> 证据写法：`渲染点` 列是**我实际读过的调用点**（文件:行 ＋ 该行做了什么）。

### 2.1 舰船域（10 条）—— `engine` 包一层后走 `result.error` 上屏

| # | 位置 | 中文（摘要） | 渲染点证据 |
|---|---|---|---|
| 1 | `shipyard.ts:76` `changeShip` | `正在驾驶的就是 ${船名}。` | `engine.ts:3458` 调它，`else` 分支取 `result.error` 上屏 |
| 2 | `shipyard.ts:80` | `机库里没有 ${船名}——先到商店购买，或用舰船蓝图制造一艘。` | 同上 |
| 3 | `shipyard.ts:130` | `驾驶船${where}——请先「返航空间站」再换船。` | 同上 |
| 4 | `shipyard.ts:137` | `「${站点}」尚未建成：工地不提供停靠与服务，换驾驶需在母港或已建成的副站进行。` | 同上 |
| 5 | `shipyard.ts:444` `repairShip` | `${船名} 不在空间站（野外/掩护巡逻途中）——返航后才能维修。` | `engine.ts:3938` 同上 |
| 6 | `shipyard.ts:451` | `「${站点}」尚未建成：…维修需在母港或已建成的副站进行。` | 同上 |
| 7 | `shipyard.ts:455` | `${船名} 状态完好，无需维修。` | 同上 |
| 8 | `shipyard.ts:459` | `维修费不足：需要 ${N} 信用点。` | 同上 |
| 9 | `shipyard.ts:761` `shipStorable` | `只有满耐久（结构与装甲都完好）的船才能入仓：先维修。`（`reason`） | `ShipPage.tsx:781` 取 `storable`，注释写明「界面只显示它的 reason」 |
| 10 | `shipyard.ts:778` `storeShip` | `这艘船不能入仓。`（`error`，`check.reason ?? …`） | `engine.ts:2363` `storeShip` → `res` 上屏 |

### 2.2 AI 副船 / 核心（11 条）

| # | 位置 | 中文（摘要） | 渲染点证据 |
|---|---|---|---|
| 11 | `ai.ts:277` `assignAiMining` | `采集点「X」需要「深空工业协会」声望 N（累计 M）。` | `engine.ts:4026` `result` → toast |
| 12 | `ai.ts:335` `assignAiExpedition` | `AI 暂不能接单：「X」需要你先亲手完成一次（首胜后解锁自动远征）。` | `engine.ts:4037` |
| 13 | `ai.ts:341` | `AI 只接高胜率任务：该目标最终成功率 N%（需 ≥80%）。` | 同上 |
| 14 | `ai.ts:406` `assignAiSalvage` | `「X」尚未探明——先对其执行扫描探索。` | `engine.ts:4047` |
| 15 | `ai.ts:426` | `「X」没有可打捞的敌群残骸（该星系无悬赏目标）。` | 同上 |
| 16 | `ai.ts:468` `assignAiStandby` | `「X」尚未探明——先对其执行扫描探索。` | `engine.ts:3552` |
| 17 | `ai.ts:536` `aiTaskView.label` | `返航卸货中 / 出航中` | `MapPage.tsx:571` 取 `aiView`，在「工位行」里渲染 |
| 18 | `ai.ts:561` | `返航卸货 / 出航` | 同上 |
| 19 | `ai.ts:578` | `前往掩护巡逻中` | 同上 |
| 20 | `ai.ts:580` | `驻留中` | 同上 |
| 21 | `aiCores.ts:21` `aiCoreName` | `基础 AI 核心 / 伽马 / 贝塔 / 阿尔法 AI 核心` | `IndustryPage.tsx:194` 把它当**参数**注入本地化模板 `tr("ui.IndustryPage.068", { p1: aiCoreName(worker) })` ⇒ 英文界面里模板是英文、**这个参数仍是中文** |

⚠ 同类但**未证上屏**的 5 条（`ai.ts:195/205/207/215/217` `aiCoreCapBlock` 的「AI 核心上限为 0 / 启用已满…」）
⇒ 渲染层只在**注释**里引用它（`ShipPage.tsx:1222` / `ui/aiSlots.tsx:6`），实调用在 core 内部 ⇒ 归 **B 类待核**。

### 2.3 市场域（2 条）

| # | 位置 | 中文（摘要） | 渲染点证据 |
|---|---|---|---|
| 22 | `market.ts:1528` `buyOrderBlockedReason` | `信用点不足：挂 1 件需预扣 N 信用点，钱包 M 信用点（预扣部分撤单即退回）。` | `engine.ts:2292` **直接 `return` 给界面**（买单闸门的返回值就是它） |
| 23 | `market.ts:2284` `buyBasicAiCore` | `信用点不足：基础 AI 核心约 N 信用点（现有 M）。` | `engine.ts:4016` → toast |

### 2.4 工业域（3 条）

| # | 位置 | 中文（摘要） | 渲染点证据 |
|---|---|---|---|
| 24 | `industry.ts:319` `startRefineRun` | `精炼炉随协会基地网络运转：需停靠空间站…（AI 核心驱动不受此限）。` | `engine.ts:2015` → toast |
| 25 | `industry.ts:479` `startUnboxRun` | `精炼炉的「货柜拆解」随协会基地网络运转：…` | `engine.ts:2038` |
| 26 | `industry.ts:570` `startRecycleRun` | `残骸回收炉随协会基地网络运转：…` | `engine.ts:2048` |

### 2.5 装配域（1 条）

| # | 位置 | 中文（摘要） | 渲染点证据 |
|---|---|---|---|
| 27 | `equipment.ts:121` `cpuOverloadText` | `CPU 超载：合计需 N，预算 M（协处理器只扩容、卸下即收回——先卸下其它装备或无人机）。` | `engine.ts:2440` 取 `why` 后 `return { ok: false, error: why }` ⇒ 走同一条上屏链 |

### 2.6 远征 / 自动循环（9 条）

| # | 位置 | 中文（摘要） | 渲染点证据 |
|---|---|---|---|
| 28 | `expedition.ts:1419` `autoLoopReopenBlockReason` | `装甲或结构低于 50%：先修回 50% 以上，或装上船体维修装置并带够组件。` | `ExpeditionCards.tsx:202` 取 `reopenBlock`（出击按钮的禁用理由） |
| 29-31 | `expedition.ts:1521 / 1532 / 1548` `advanceAutoLoopBounty` | `目标已不存在` · `舰队里找不到当前舰船` · `无法再出发` | `engine.ts:1347` `const reason = …` → 通知 |
| 32-35 | `expedition.ts:1673 / 1677 / 1701 / 1709` `advanceAutoLoopInvasion` | `入侵活动已结束` · `该星系已被夺回` ×2 · `无法再出发` | `engine.ts:1354` 同上 |

### 2.7 虫洞 / 战斗读数（2 条）

| # | 位置 | 中文（摘要） | 渲染点证据 |
|---|---|---|---|
| 36 | `wormholeMatter.ts:698` `wormholeMatterDiscardHint` | `丢掉「X」会少 N 回合：可能走不到想去的格子（撤离不受影响，任何回合数都能撤）。` | `Wormhole.tsx:3392` 取 `hintText` 直接渲染 |
| 37 | `combatMath.ts:57` `layerMultText` | `盾 X · 甲 Y · 结构 Z` | `ui/shipInfo.tsx:192` 放进 `title={…}`（悬停说明） |

## 3. B 类 · 待核（4 ＋ 5 条）

| 组 | 位置 | 为什么待核 |
|---|---|---|
| **出售来源标签** 4 条 | `industry.ts:1200 / 1205 / 1255 / 1274`（`sellCargoItem` / `sellWareItem` / `sellCargoItemQty` / `sellWareItemQty`） | 它们把 `'货仓'` / `'仓库'` 当**参数**传给 `sellItemFrom(...)` ⇒ 这个中文标签会不会进玩家可见文本（卖出提示/日志）**要读 `sellItemFrom` 才知道**，我没往下追 |
| **AI 核心上限拒因** 5 条 | `ai.ts:195 / 205 / 207 / 215 / 217`（`aiCoreCapBlock`） | 渲染层只在注释里引用，实调用在 core 内部 ⇒ 要先确认它的返回值最终有没有被界面消费 |

## 3.5 定值型（本轮新增 · 两类）

### 3.5.1 `addLog` 不带 `textId`：**92 处**（抽 4 条复核全为真）

`addLog(state, kind, 文本, textId?, params?)` —— 第 4 参是 id。**393 处调用里 92 处没给** ⇒ 中文原样进日志（英文界面整行中文）。
抽样复核（4/4 为真、确无 id）：`combat.ts:1094`「劫掠捕获网已失效：…」· `combat.ts:1206`「墨潮捕获网松开：…」· `expedition.ts:1466`「重复清剿已暂停：…」· `equipment.ts` 另 1 处。

| 文件 | 处数 | 文件 | 处数 |
|---|---|---|---|
| `combat.ts` | 12 | `wormhole.ts` | 3 |
| `location.ts` | 12 | `wormholeAuto.ts` | 3 |
| `wormholeSalvage.ts` | 11 | `wormholeScan.ts` | 3 |
| `expedition.ts` | 10 | `equipment.ts` | 2 |
| `encounters.ts` | 7 | `explore.ts` | 2 |
| `wormholeBattle.ts` | 6 | `station.ts` | 2 |
| `market.ts` | 5 | `foeSpecs.ts` · `hauling.ts` · `matterTech.ts` · `mining.ts` · `onboarding.ts` | 各 1 |
| `sideTasks.ts` | 5 | | |
| `manufacturing.ts` | 4 | **合计** | **92** |

### 3.5.2 `state.<字段> = 中文串`（随档提示，界面会弹）：**1 处（＋1 处派生）**

| 位置 | 中文 | 渲染点 |
|---|---|---|
| `equipment.ts:863` | `state.droneLossNotice = 「机舱容量不足：已自动卸下 … 并退回仓库。」` | 该字段就是给界面弹的一次性提示 |
| `expedition.ts:1459-1469`（`stopAutoLoopReason`） | `const text = 「重复清剿已暂停：${reason}（当前 装甲 X% / 结构 Y%）」` → `addLog(state, 'combat', text)`（**无 id**）＋ `state.autoLoopStopNotice = text` | 日志行 ＋ 在线弹窗**两处都出中文** |

## 4. C 类 · 不影响玩家（49 条 · 只登记不逐条列）

三类，逐条见本机探针日志 `tools/_ui-artifacts/core-zh-audit-20261002.log`（该目录已被 `.gitignore` 忽略）：

1. **日志文本构造器**（`hitLogText` / `deliveryLogText` / `placeOrderLogText` / `grantLog` / `startGrantLog` / `rollAiCoreDrop` / `dcUsageText` / `repairUsageText` / `hitDamageText` / `ammoTierFallbackLog` 等）——
   ⚠ 它们的合规性**逐处成立**：同一个构造器，这个调用点给了 id 就算合规，没给就落进 §3.5.1 那 92 处。
   它们的返回值在**调用点**被 `addLog(state, kind, 中文原串, 'core.x.y')` 收走，**id 在调用点** ⇒ **甲案合规**（这正是设计：中文原串永远照写 ＋ id 供界面按语言渲染）。
2. **布尔/数值判定里的中文**（`securityZoneOf(...) === '高安'` / `'低安'` 这类）——中文是**数据值**不是显示串。
3. **仅工具 / 测试 / 内部账本用**（`formatBattleDur` / `fmtSec` / `defaultName` / `expeditionFeasibility` 等）。

## 5. 建议分批（按 §十八「一个功能域一批」，你挑）

| 批 | 域 | 条数 | 内容 | 建议 id 域 |
|---|---|---|---|---|
| ① | **舰船** | ~~10~~ → **19** | 换船 / 维修 / 入仓 的逐档拒因（`CommandResult` 三字段化）—— **✅ 2026-10-02 已做**（`core.shipyard.034~054`；`shipyard.ts` 工具读数 19 → **0**）；工作文档 `docs/design/ship-reject-i18n-20261002.md` | `core.shipyard.*` |
| ② | **AI 副船** | 11 | 四种指派的拒因 ＋ `aiTaskView.label`（忙态标签）＋ `aiCoreName` 参数注入 | `core.ai.*` · `ui.aiTask.*` |
| ③ | **远征 / 自动循环** | 9 | `autoLoop*` 的停止与重开原因 | `core.expedition.*` |
| ④ | **市场** | 2 | 买单预扣不足 ＋ 买基础 AI 核心 | `core.market.*` |
| ⑤ | **工业** | 3 | 三台机器的"需停靠空间站"闸 | `core.industry.*` |
| ⑥ | **装配** | 1 | CPU 超载 | `core.equipment.*` |
| ⑦ | **虫洞 ＋ 战斗读数** | 2 | 丢弃谜质件提示 ＋ 伤害分层读数 | `core.wormhole.*` · `ui.dmg.*` |
| ⑧ | **B 类待核** | 9 | 先把 §3 那两组追完再定 | 待定 |
| ⑨ | **日志行补 id（定值型）** | **92** | `addLog` 缺 `textId` 的 92 处 —— **按模块分小批**（战斗 12 · 地点/搬运 12 · 虫洞残骸 11 · 远征 10 · 遭遇 7 · 虫洞战 6 …） | 沿用各域既有 id 段（`core.combat.*` · `core.wormhole*.*` · `core.expedition.*` …） |
| ⑩ | **随档提示串** | 2 | `equipment.ts:863` 的 `droneLossNotice` ＋ `expedition.ts` 的 `stopAutoLoopReason` | `core.equipment.*` · `core.expedition.*` |
| ⑪ | **共享拒因（跨域）** | 5 | `state.shipLockedReason`（2 条）＋ `activityGate.cannotInterruptReason`（3 条）——前者 **8 文件 15 处**在调，改返回类型要动 6 个域 ⇒ **按 §十八 需先申请** | `core.state.*` · `core.activityGate.*` |

**做法（每批一致，与 2026-09-27 那批同款先例）**：把返回 `string | null` 的闸门改成返回**结构化拒因**（`{ error, errorId, errorParams }`，类型 `CoreBlockReason` 已在 `core/engine.ts`）／给 `CommandResult` 补 `errorId`；中文措辞**一字不改**照抄进 `table.ts` 的 `zh` 列，英文按 `docs/glossary-en.md` 出稿；渲染点改走 `cmdText(...)`。
**每批闸门**：`typecheck` · core 全量 · `content:check` · `l10n:check` · `l10n:params` · `ui:rot-check`。

**工作量粗估**：批①~⑦ 合计 38 条，按 2026-09-27 那次（8 条 · 一轮）的节奏 ⇒ **约 4~5 轮**；其中批②（忙态标签 ＋ 参数注入）最绕，批① 最规整（同一族拒因）。
批⑨（92 处日志行）**不并进上面几轮**：它量最大，但每处都是「加第 4 参 ＋ 往 `table.ts` 补一行 zh/en」，机械程度最高、风险最低 ⇒ 建议**单独立项**，按模块拆成 6~8 个小批，做一批合一批。

## 6. 顺手提一件事（未做，等你点头）

本次用的取证探针是**一次性的**（已删）。它对应的体检**有复用价值**：每清一批，跑一次就能看"还剩几条"（本轮覆盖三类：`return` 型 · `addLog` 缺 id 型 · `state` 赋值型）。
建议转正成 `tools/l10n-core-zh-audit.ts` ＋ `npm run l10n:core-zh`（照 `tools/l10n-en-scan.ts` 的做法：输出候选表 ＋ 渲染层调用点），**要不要做？**

## 7. 边界

- **本件是盘点稿，零代码/数值/存档改动**；没碰任何一个上面列出的函数。
- 探针脚本（6 个 `_` 前缀）用完即删；日志留在 `tools/_ui-artifacts/`（已被 `gitignore`），供随时复核：
  `core-zh-audit-20261002.log`（return 型 94 条）· `core-zh-verdict-20261002.log`（调用点分类）·
  `core-zh-assign-20261002.log`（赋值型粗扫）· `core-zh-addlog-20261002.log`（`addLog` 92 处精确表）。
- **覆盖边界（如实登记）**：本盘点扫的是 `return` / `addLog` / `state` 赋值三类；**没有**扫「中文串当参数传给渲染层 API」那类，也没有用真机英文界面复读（那要起无头浏览器，属读数工具）。
- 模块自报（§十八）：本件是**只读盘点**，不落在任何功能域。
