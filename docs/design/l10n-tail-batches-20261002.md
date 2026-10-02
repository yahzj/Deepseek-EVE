# 本地化尾巴清场 · 批②~⑦ 台账（工作文档 · 2026-10-02）

**状态：进行中**（船长 2026-10-02 令「**继续**」＝ 接着做盘点稿里的批②~⑦；每批一条独立提交、各自跑闸门）

**经办**：三号（`H:\Deepseek-EVE-verify`，分支 `verify`）

**缘起**：`docs/design/core-zh-leak-audit-20261002.md`（盘点稿 · 全仓 271 处裸中文上屏）＋ 批①（舰船域，已做，见 `ship-reject-i18n-20261002.md`）。

**做法（每批一致）**：core 侧拒因按甲案补 `errorId`/`errorParams`（中文原串照写、**一字不改**）→ `table.ts` 补 zh + en（英文按 `docs/glossary-en.md` 口径）→ 渲染点走 `cmdText(...)` / `tr(id)` → 跑 `l10n:core-zh` 复核读数 → 闸门 → 独立提交。

---

## 批② AI 副船域（2026-10-02）

**读数**：`npm run l10n:core-zh` 复核 —— `ai.ts` 的**可上屏**裸中文已清完（剩下 4 条：2 条注释误判 · 2 条日志文本构造器 id 在调用点 · 1 条 `aiCoreName` 有意保留，见下）。

**落码（4 个文件）**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/ai.ts` | ① `aiCoreCapBlock` 返回类型 `string \| null` → **`CoreBlockReason \| null`**（5 条上限拒因各带 id：`core.ai.041~045`，带 `used/cap/shipUsed/indOnShared` 等参数）② `checkAssignable` 两条（`core.ai.046` ＋ 上限拒因透传）③ 四种指派的 11 条拒因（`core.ai.047~055`，其中「未知星系」「尚未探明」各复用同一 id）④ `AiTaskView` 新增 **`labelId`** 字段，8 个阶段标签各带 id（`ui.aiProgress.002~009`） |
| 2 | `packages/core/src/industry.ts` · `lab.ts` · `manufacturing.ts` | `aiCoreCapBlock` 的 **5 处调用点**改为透传三字段（`error/errorId/errorParams`）——⚠ 见下"跨域" |
| 3 | `apps/desktop/.../ui/aiProgress.tsx` | 阶段标签改走 `tr(view.labelId)`（缺省回落中文原串）——**AI 任务进度条的唯一渲染件**，改这一处覆盖 MapPage/ShipPage 三处调用 |
| 4 | `apps/desktop/.../pages/IndustryPage.tsx` | 核名从 `aiCoreName()`（只出中文）改走 `aiCoreText()`（渲染层本地化取词）＋ 去掉无用 import |
| 5 | `packages/data/src/l10n/table.ts` | 新增 23 条：`core.ai.041~055` ＋ `ui.aiProgress.002~009` |

**⚠ 跨域如实登记（§十八）**：`aiCoreCapBlock` 是**共享守卫**，除 `ai.ts` 外还被 **`industry.ts`（3 处）· `lab.ts`（1 处）· `manufacturing.ts`（1 处）**调用 ⇒ 本批改动落在 **AI ＋ 工业 ＋ 实验室 ＋ 制造** 四个域。
性质 = **类型透传（5 行 `if (capBlock) return {…}`）**，机制、判据、文案一律未变；不改为「返回结构化拒因」的话，AI 域永远清不干净（上限拒因正是从这些入口上屏的）。**如需退回，只需把这 5 行改回 `error: capBlock`**（但那会让本批的 AI 域读数回到未清状态）。

**验证**：`typecheck` 四包 0 错 · core **286 文件 / 3008 用例全绿** · `l10n:check` ✅ · `l10n:params`（0 漏喂）✅ · `content:check` ✅ · `ui:rot-check` ✅。
**用例同步 2 处**：`tests/ai.test.ts` 的两条断言由"靠中文子串"改成**断 id**（`?.errorId).toBe('core.ai.041')`）——这是甲案的老规矩（断言 id 与参数，不靠文案）。

**过程中的两次自纠（留痕）**：
1. 我先前用 `git grep … | Select-Object -First 6` 找调用点 ⇒ **只看到 6 处、漏了 lab/manufacturing 两处**，first typecheck 当场报红才补上。**教训：数"全部调用点"不能用 -First 截断。**
2. 行匹配 helper 第一版没强制"整行命中"，把 `label: '采掘中',` 这类短行误判成 2 处 ⇒ 加"整行相等"判据后通过（该 helper 两次运行都**在写盘前抛错**，所以没有半成品落盘）。

---

## 批⑤ 工业域（2026-10-02）

**读数**：`npm run l10n:core-zh -- industry` —— `industry.ts` **7 → 0 处**。

**落码（2 个文件）**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/industry.ts` | ① 三台机器的「需停靠空间站」闸补 id（`core.industry.084` 精炼炉 · `085` 货柜拆解 · `086` 残骸回收炉）② **`sellItemFrom` 的来源标签改走 `p1Id`**：原先把 `'货仓'` / `'仓库'` 当**中文参数**喂进 `core.industry.016`（`{p1}里没有 {p2}。`）⇒ 英文界面中英混排；现在多收一个 `sourceId`，`errorParams` 补 `p1Id`（复用既有标签 id **`ui.CargoPage.004`** 货仓 / **`ui.ItemsPage.001`** 仓库，不新造词条） |
| 2 | `packages/data/src/l10n/table.ts` | 补 3 条（`core.industry.084~086`） |

**✅ 顺带收口盘点稿的 B 类待核 4 条**（"出售来源标签会不会上屏"）：答案是**会**——`sellItemFrom` 本来就把它们当参数喂模板；本批已按 `p1Id` 修好（B 类 9 条里清掉 4 条，剩 `aiCoreCapBlock` 那 5 条已在批② 一并转正）。

**验证**：`typecheck` 四包 0 错 · core **286 文件 / 3008 用例全绿** · `l10n:params` 0 漏喂 · `content:check` ✅ · 工具复核该域 **0 处**。

---

## 批⑦ 虫洞丢弃提醒 ＋ 战斗克制读数（2026-10-02）

**落码（5 个文件）**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/wormholeMatter.ts` | `wormholeMatterDiscardHint` 由 `string \| null` 改 **`CoreBlockReason \| null`**（id **`ui.Wormhole.379`** ＋ 参数 `p1` 装置名 / `p2` 回合数）；中文原串一字不改 |
| 2 | `apps/desktop/.../panels/Wormhole.tsx` | **两处**渲染点改走 `cmdText(...)`（临时空间那一行的副注 ＋ 丢弃确认条） |
| 3 | `packages/core/src/combatMath.ts` | **删掉 `layerMultText()`**（中文整句 `盾 ×1.5 · 甲 ×0.75 · 结构 ×1`）——它由伤害徽章悬停直接显示 ⇒ 英文界面必出中文 |
| 4 | `packages/core/src/combat.ts` · `index.ts` | 同步去掉 `layerMultText` 的再导出（全仓 0 引用后才删） |
| 5 | `apps/desktop/.../ui/shipInfo.tsx` | 伤害徽章悬停改由界面按语言组装（id **`ui.shipInfo.248`**，数字仍走 core 的 `typeLayerMult` 单一真相源）；顺手把中文全角冒号 `：` 收进模板（英文用 `:`） |
| 6 | `packages/data/src/l10n/table.ts` | 补 2 条（`ui.Wormhole.379` · `ui.shipInfo.248`） |

**读数**：`l10n:core-zh` 复核 —— `wormholeMatter.ts` **0 处**；`combatMath.ts` 剩 1 处为**误判**（`typeLayerMult` 返回 number、中文只在行尾注释里，工具暂不剥行尾注释，已在报告里登记）。

**验证**：`typecheck` 四包 0 错 · core **286 文件 / 3008 用例全绿** · `l10n:check` ✅ · `l10n:params` 0 漏喂 · `content:check` ✅。
**用例同步 1 处**：`tests/wormhole-matter.test.ts` 由"断言中文子串"改成**断 id 与参数**（`?.errorId` / `?.errorParams`）——第一次我把参数猜成 `{p1:'时间晶体',p2:-10}`，被用例当场纠正为实测值 `{p1:'时序核心',p2:10}`（留痕：断言要**取实测值**，别照中文语序推）。

---

## 批⑥ 装配域（2026-10-02）

**落码（4 个文件）**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/equipment.ts` | `cpuOverloadText` 由 `string \| null` 改 **`CoreBlockReason \| null`**（id **`core.equipment.032`** ＋ 参数 `p1` 合计需 / `p2` 预算）；中文原串一字不改；一处调用点（卸件闸）改透传三字段。⚠ 另一处调用点（装件闸 `equipment.ts:648`）**判空即可**——它自带更细的文案 `core.equipment.009`（本就合规） |
| 2 | `apps/desktop/.../game/engine.ts` | `unfitAtAt` 的 `if (why !== null) return { ok:false, error: why }` 改透传三字段（装配页"为什么卸不掉"直接按语言渲染） |
| 3 | `packages/core/tests/cpu-coprocessor.test.ts` | 一条断言由"断中文子串"改成**断 id** |
| 4 | `packages/data/src/l10n/table.ts` | 补 1 条（`core.equipment.032`） |

**读数**：`cpuOverloadText` 这条渲染路径已清；`equipment.ts` 余 4 条**不属本批** —— 2 条 `addLog` 缺 `textId`（批⑨ 日志行）· 1 条 `state.droneLossNotice` 赋值型（批⑩，见下）· 1 条工具误判。

**验证**：`typecheck` 四包 0 错 · core **286 文件 / 3008 用例全绿**。

**⚠ 批⑩（随档提示串）的性质补充（重要，供船长裁）**：`state.droneLossNotice` / `state.autoLoopStopNotice` 这两条**是存档字段**（`state.ts` 持久化）。要让它们按语言渲染，得**新增 `…Id` / `…Params` 字段**（或把字段本身改成结构化对象）⇒ **属改存档结构**，按约定要你先点头，所以本批**没动**，只在盘点稿里挂着。

---

## 批④ 市场域（2026-10-02）

**范围判定（先查界面入口，再决定做不做）**：盘点稿把本域写成"2 条"，实际逐条查完是 ——

| 函数 | 条数 | 有没有界面入口 | 处置 |
|---|---|---|---|
| `buyOrderBlockedReason` | 4 | **有**（`MarketPage.tsx:848` 挂单闸） | 本批做 |
| `sellStoredShipAtMarket` | 2 | **有**（`engine.sellStoredShipAt` → 舰船仓库「出售」） | 本批做 |
| `buyBasicAiCore` | 1 | **有**（`engine` → toast） | 本批做 |
| `shipSellable` | 7 | **没有**（`market.ts:2080` 头注明写：舰队实例版出售**自 2026-09-22 起没有界面入口**） | 归 C 类，**登记不动**（日后若加界面入口需补 id） |
| `sellShipAtMarket` | 3 | 同上 | 归 C 类，登记不动 |

**落码（4 个文件）**：`market.ts`（`buyOrderBlockedReason` → `CoreBlockReason`，含把**锁标**改走既有结构化孪生 `marketLockNote`（同一条文案同一个 id，2026-09-30 的先例）· `sellStoredShipAtMarket` 补 `reasonId/reasonParams` · `buyBasicAiCore` 补 `errorId`）· `engine.ts`（买单闸返回类型 ＋ 卖船结果透传）· `MarketPage.tsx`（提示走 `cmdText`）· `table.ts`（`core.market.041~047` 七条）。

**验证**：`typecheck` 四包 0 错 · core **286 文件 / 3008 用例全绿** · `l10n:check` ✅ · `l10n:params` 0 漏喂 · `content:check` ✅。
**用例同步 2 处**：`wormhole-core-drop.test.ts`（只收不卖 → 断 `core.market.043`）· `market-buy-escrow.test.ts`（信用点不足 → 断 `core.market.044` ＋ 参数 `{p1:'100',p2:'10'}`）。

---

## 批③ 远征 / 自动循环（2026-10-02）—— **可做部分已做，两条链挂账**

`expedition.ts` 是最大的一域（盘点稿 37 处）。逐条查**去向**后拆成两半：

### ✅ 本批已做（6 条 · 有界面入口且不涉存档）

| 项 | 条数 | 渲染点 |
|---|---|---|
| `autoLoopReopenBlockReason`（重开重复清剿的逐档拒因） | **4**（`core.expedition.032~035`：机队无此船 / 装甲结构 <50% / 机群全灭 / 机群尚未补充 p1·p2·p3） | **3 处**：`ExpeditionCards.tsx:405` · `StarMap.tsx:2218` · `StarMap.tsx:2276` ⇒ 一律改走 `cmdText(...)`（原先直接把对象/字符串塞进 `title`） |
| `expeditionPreflight`（远征前置闸：声望 / 冷却） | **2**（`core.expedition.036` p1·p2 / `037` p1·p2） | 经 `CommandResult.error` → 界面 `cmdText` |

另：`setAutoLoopBounty` 一处转发改透传三字段（否则重开被拒时只回中文）。

### ⛔ 挂账两条（各有前置，需船长裁或另立批）

| 链 | 条数 | 卡在哪 |
|---|---|---|
| **停环提示**：`advanceAutoLoopBounty`(3) · `advanceAutoLoopInvasion`(4) 的返回串 | 7 | 它们的**唯一玩家可见出口**是 `stopAutoLoopReason()` 组合出的那句「重复清剿已暂停：…（当前 装甲 X% / 结构 Y%）」，而它被写进 **存档字段 `state.autoLoopStopNotice`** ⇒ 要按语言渲染得**给存档加 `…Id`/`…Params` 字段**（同批⑩ 的 `droneLossNotice`）—— **属改存档结构，等你点头**。（日志那一半可以单独给 `textId`，不留档，可随批⑨ 一起做。） |
| **等待标签**：`autoLoopWaitLabel`(6：本次出击/采矿/残骸打捞/航行/亲自开炉/亲自开线) | 6 | 它由 `activity.ts:422` 消费，拼进活动栏「重复清剿」那一行的 `sub`（`主控正在等待：…` 之类）⇒ 要做需连**活动栏那一行的组合句**一起改成 id 参数（属**主控活动**域），另立一批更干净。 |

### 验证

`typecheck` 四包 0 错 · core **286 文件 / 3008 用例全绿** · `l10n:check` ✅ · `l10n:params` 0 漏喂 · `content:check` ✅。
**用例同步 2 处**（`tests/drone-loss.test.ts`）：由"断言中文子串"改成**断 id**（`core.expedition.034`）与**断 id ＋ 参数**（`035` → `{p1:1,p2:1,p3:2}`）。
**过程中的一次自纠**：我第一版补类型 import 的判据写成 `if (!源码.includes('CoreBlockReason'))` —— 而签名行**已经包含**这个词 ⇒ import 被跳过、typecheck 报 `Cannot find name`。已改成按 `import type {...CoreBlockReason...}` 正则判据（留痕：判据别拿"文件里有没有这个词"当"有没有 import"）。

---

## 批⑨-① 日志行补 id：`location.ts` 四条（2026-10-02 · 同步一号 10 笔之后）

**背景**：一号 2026-10-02 那批把「落盘正文 ≠ id 表文」的扫描转正成常设护栏；本批是**同一条链的另一半** ——
把「有正文、**没有** `textId`」的日志补上 id（英文界面那一整行才会按语言渲染）。

**范围判定**：`location.ts` 共 12 条缺 id 的 `addLog`；本批先做**结构规整的 4 条**（纯模板 ＋ 简单参数），
带 `unloadNote.text` 之类**拼接段**的复合句（253/258/525/556/567 等）留第二批走 `composeLog()`（`logParts.ts` 的既有 API）。

**落码（2 个文件）**：

| # | 位置 | 新 id | 内容 |
|---|---|---|---|
| 1 | `location.ts:530` | `core.location.041` | 清仓交付建材（`p1` 已交 / `p2` 还差） |
| 2 | `location.ts:679` | `core.location.042` | ⚐ 掩护巡逻抵达（`p1` 星系名） |
| 3 | `location.ts:703` | `core.location.043` | ⚐ 掩护巡逻就位（`p1` 星系名） |
| 4 | `location.ts:722` | `core.location.044` / `045` | 取消掩护巡逻的**两种收尾各一个 id**（带卸货数 / 不带）——⚠ **不合并成"可选段"**：`composeLog` 的硬规矩①写着"空段会被整段丢掉、段链跟着断"，这里用两个基础模板最稳 |

**读数**：`l10n:core-zh -- location` **12 → 8**（余 8 条 `addLog` ＋ 1 条 return 误判）。

**验证**：`typecheck` 四包 0 错 · core **287 文件 / 3016 用例全绿** · `l10n:params`（**一号加强版**）**0 漏喂** · `content:check` ✅。

### 批⑨ 的后续计划（按模块拆小批）

| 小批 | 模块 | 条数 | 备注 |
|---|---|---|---|
| ⑨-② | `location.ts` 余下 8 条 | 8 | 多为拼接句（`unloadNote.text` / 嵌套三元）⇒ 走 `composeLog()`；含一条 `reconcileDockSanity` 的"两种情况"三元（拆两个 id） |
| ⑨-③ | `combat.ts` | 12 | 战斗日志（网/捕获/损管） |
| ⑨-④ | `wormholeSalvage.ts` | 11 | 虫洞打捞 |
| ⑨-⑤ | `expedition.ts` | 10 | 远征 |
| ⑨-⑥ | `encounters.ts` · `wormholeBattle.ts` | 13 | 遭遇战 / 虫洞战 |
| ⑨-⑦ | 其余零散（`market` 5 · `sideTasks` 5 · `manufacturing` 4 · `station` 2 · `explore` 2 · `hauling`/`mining`/`matterTech`/`onboarding`/`foeSpecs` 各 1） | 23 | 按域合并成一两批 |

---

## 批⑨-② 日志行补 id：`location.ts` 余下 8 条（2026-10-02）

**做法 = 照搬同文件既有的"三键挂法"**（190~212 行 `core.location.039/040` 就是这么写的）：
卸货附注按 `p{n}`（文本）＋ **`p{n}Id`**（段译文 id ＝ `core.location.037`）＋ **`p{n}p1`**（段内参数 ＝ 单位数）挂上。
这样中文原串逐字不变，而英文界面能逐段按语言渲染（这正是 `logParts.ts` 段链设计的用法）。

| # | 位置 | 新 id | 说明 |
|---|---|---|---|
| 1 | `location.ts:253` | `046` | 交付任务收尾（返航停靠）：`{p1}` 站名 · `{p2}` 副站后缀 · `{p3}` 卸货附注 |
| 2 | `location.ts:258` | `048` | 返航完成（停靠）：同上三槽 |
| 3 | `location.ts:400` | `049` | ⚑ 建站交付航线启程（`p1`~`p7`：起点/星系/工地/航程/装载量/货仓用量/容量） |
| 4 | `location.ts:435` | `050` / `051` | 交付航线取消的**两种收尾各一个 id**（带卸货数 / 不带） |
| 5 | `location.ts:525` | `052` | 达成「建成」档交付：`{p1}` 站名 · `{p2}` 卸货附注 |
| 6 | `location.ts:558` | `053` | 交付任务收尾（返航到基地）：同 046 三槽 |
| 7 | `location.ts:569` | `054` | 自动返航（`p1` 基地名 · `p2` 分钟数） |
| 8 | `location.ts:589` | `055` / `056` | 停靠自检的**两种情况各一个 id**（工地未建成转现场停留 / 副站已不存在回母港） |

**新增片段词条**：`core.location.047` ＝ 「（副空间站）」/` (outpost)` —— 那处后缀是**可选**的（`dockedName` 有才出现），
原先夹在中文整句里 ⇒ 现在走 `p2Id`（有则挂、无则空），**1 条词条覆盖有/无两种情形**（比拆 4 个模板干净）。

**读数**：`l10n:core-zh -- location` **8 → 1**（剩下那 1 条是 `dockedStation` 的 return 误判：返回对象、中文只在行尾注释里）。
⇒ **`location.ts` 的 addLog 型漏口已清零（12 → 0）**。

**验证**：`typecheck` 四包 0 错 · core **287 文件 / 3016 用例全绿** · `l10n:params`（一号加强版）**0 漏喂** · `l10n:check` ✅ · `content:check` ✅。

**下一批（⑨-③）**：`combat.ts` 12 条（网/捕获/损管那几族战斗日志）。

---

## 批⑨-③ 日志行补 id：`combat.ts` 四条（2026-10-02）

`combat.ts` 的 12 条里多数是**复合拼接句**（`+` 串联 ＋ 嵌套三元，如 1070/1221/3132/3139/3142/3153/3351/3425）⇒ 那一半要
走 `composeLog()` 段链、单列 **⑨-③b**。本批先做**结构规整的 4 条**（劫掠网 / 墨潮网的失效与松开）：

| # | 位置 | 新 id | 内容 |
|---|---|---|---|
| 1 | `combat.ts:1094` | `core.combat.008` | 劫掠捕获网已失效（发动者被击沉 · `p1` 船名） |
| 2 | `combat.ts:1099` | `core.combat.009` | 劫掠捕获网已失效（距离超限 · `p1` 船名 `p2` 米数） |
| 3 | `combat.ts:1178` | `core.combat.010` | 墨潮捕获网已失效（网手被击沉 · `p1` 船名） |
| 4 | `combat.ts:1206` | `core.combat.011` | 墨潮捕获网松开（`p1` 被击沉者 `p2` 网手名） |

**读数**：`l10n:core-zh -- combat.ts` **13 → 9**（余 8 条复合句 ＋ 1 条 return 误判）。

### ⚠ 一处自纠（值得记）

我第一版把 4 条表键写成了 **`core.combat.8` / `.9` / `.10` / `.11`**（少了三位补零），而代码里引用的是 `core.combat.008`…
—— **所有闸门都不报**：`l10n:check` 只查表自身（无死引用/占位符/中日韩残留），`l10n:params` 只查"表里占位符有没有被喂"，
而"代码引用的 id 在不在表里"**没有静态检查**（渲染层 `tr()` 查不到就静默回落中文原串）。是**我自己复核时撞见**的。

**已顺手做了一次全量一致性核对**：把我这会话改过的 **20 个文件**里所有 `'core.x.NNN'` / `'ui.x.NNN'` 形态引用（**722 个 id**）
逐个对表 ⇒ **缺失 0**（补零修完之后）。

**建议（未做，等你点头）**：把这条校验做进 `npm run l10n:check`（或 `arch:guard`）——
「**源码里引用的 `core.*` / `ui.*` id 必须都在唯一表里**」，成本很低（一次正则扫全仓），能永久堵住"补零/拼错 ⇒ 静默回落中文"这类**闸门看不见的漏**。

**验证**：`typecheck` 四包 0 错 · core **287 文件 / 3016 用例全绿** · `l10n:check` ✅ · `l10n:params` 0 漏喂 · `content:check` ✅。

**下一批**：⑨-③b `combat.ts` 余 8 条（复合句走 `composeLog`）· ⑨-④ `wormholeSalvage.ts` 11 条 · ⑨-⑤ `expedition.ts` 10 条。

---

## 待做（按盘点稿顺序）

批③ 远征/自动循环（9 条）· 批④ 市场（2 条）· 批⑤ 工业（3 条）· 批⑥ 装配（1 条）· 批⑦ 虫洞＋战斗读数（2 条）· 批⑧ B 类待核（9 条）· 批⑨ 日志行（97 处，建议单独立项）· 批⑪ 共享拒因（`shipLockedReason` / `cannotInterruptReason`，跨 6 域，需先申请）。
