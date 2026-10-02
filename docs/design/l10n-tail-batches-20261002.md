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
| 1 | `packages/core/src/wormholeMatter.ts` | `wormholeMatterDiscardHint` 由 `string \| null` 改 **`CoreBlockReason \| null`**（id **`ui.Wormhole.380`**（合并让号前为 `.379`，与一号「禁止打捞」批撞号后顺延）＋ 参数 `p1` 装置名 / `p2` 回合数）；中文原串一字不改 |
| 2 | `apps/desktop/.../panels/Wormhole.tsx` | **两处**渲染点改走 `cmdText(...)`（临时空间那一行的副注 ＋ 丢弃确认条） |
| 3 | `packages/core/src/combatMath.ts` | **删掉 `layerMultText()`**（中文整句 `盾 ×1.5 · 甲 ×0.75 · 结构 ×1`）——它由伤害徽章悬停直接显示 ⇒ 英文界面必出中文 |
| 4 | `packages/core/src/combat.ts` · `index.ts` | 同步去掉 `layerMultText` 的再导出（全仓 0 引用后才删） |
| 5 | `apps/desktop/.../ui/shipInfo.tsx` | 伤害徽章悬停改由界面按语言组装（id **`ui.shipInfo.248`**，数字仍走 core 的 `typeLayerMult` 单一真相源）；顺手把中文全角冒号 `：` 收进模板（英文用 `:`） |
| 6 | `packages/data/src/l10n/table.ts` | 补 2 条（`ui.Wormhole.380` · `ui.shipInfo.248`） |

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

## 批⑨-④ 日志行补 id：`wormholeSalvage.ts` 六条（2026-10-02）

**本批 6 条**（`🕳` 那族里结构规整的：单模板 ＋ 简单参数）：

| # | 位置 | 新 id | 内容 |
|---|---|---|---|
| 1 | `wormholeSalvage.ts:1053` | `046`（合并让号前为 `044`）| 放进临时空间（`p1` 名 · `p2` 格数） |
| 2 | `wormholeSalvage.ts:1243` | `047`（原 `045`）| 装舱（`p1` 名 · `p2`×`p3` 占地 · `p4`/`p5` 货仓） |
| 3 | `wormholeSalvage.ts:1333` | `048`（原 `046`）| 抛弃（`p1` 名 · `p2` 数量 · `p3`/`p4` 货仓） |
| 4 | `wormholeSalvage.ts:1788` | `049`（原 `047`）| 残骸堆里翻出（货仓腾不出 `p2`×`p3`） |
| 5 | `wormholeSalvage.ts:1851` | `050`（原 `048`）| 遗迹深处发现（货仓腾不出 `p2`×`p3`） |
| 6 | `wormholeSalvage.ts:1858` | `051`（原 `049`）| 遗迹深处发现（货仓与临时空间都放不下） |

**读数**：`l10n:core-zh -- wormholeSalvage` **14 → 8**（余 5 条 `addLog` ＋ 3 条 return）。

**验证**：`typecheck` 四包 0 错 · core **287 文件 / 3016 用例全绿** · `l10n:params` 0 漏喂 · `l10n:check` ✅ · `content:check` ✅。

---

## ⚠ 关于剩余日志的一句实话（供船长排期）

到这一批为止，**"单模板"的日志已经全部做完**（`location.ts` 已清零、`combat.ts`/`wormholeSalvage.ts` 只剩复合句）。
剩下的 70 余条 `addLog` **绝大多数是复合句**：`+` 串联两段（如 `combat.ts:1070` 的捕获网通报）、
或带"可选片段"（`${who ? `（…）` : ''}` 这类，如机群战损/补充那 5 条）、或嵌着别的拼装串（`text`/`refillTxt`/`shortTxt`）。

**这类要走 `composeLog()` 段链**（`logParts.ts` 的既有 API），而该文件头注里**明确留着一个未修的缺口**：
「参数自己那层还能再挂模板的三层结构，渲染层取不到值、会原样漏 `{p1}`」——现由 `tests/industry.test.ts` 钉成显式断言。

⇒ 我的建议（**请你裁**）：**先修 `logParts` 那个三层缺口、再批量做复合句日志**；
否则复合句做完仍会在那些三层路径上露出 `{p1}`（等于白做一轮）。修法 `logParts.ts` 头注里已经写好了（参数位改有序三段式）。

---

## 批⑫ 虫洞自动探索面板整批：`wormholeAuto`（2026-10-02）

**范围**：把 `wormholeAuto.ts` 这条链**整条面板**清完（core 拒因 ＋ 面板三处渲染点 ＋ 包装层签名 ＋ 用例）。

**读数**：`npm run l10n:core-zh -- wormholeAuto` **17 → 2**（剩下 2 条是**复合句日志**，见下"仍挂账"）；
渲染层引用型 **1 处**（出发日志）。

**落码（5 个文件）**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/wormholeAuto.ts` | ① `wormholeAutoShipBlockReason` 由 `string \| null` 改 **`CoreBlockReason \| null`**（5 条：`004` 无此船 · `005` 主控船不参与 · `006` 该舰在虫洞里 · `007` 已在别的 AI 副船任务 · `008` 已在本域另一趟自动探索里）② `wormholeAutoCoreBlock` 改结构化（`009` 上限为 0 · `010` 核心不够，带 `p1`~`p5`）③ `wormholeAutoBlockReason` 改结构化（`011`~`014`），其中"船名 ＋ 拒因"那条**合成句**（`015`，`{p1}：{p2}`）把内层拒因按**三键挂法**转发（`p2` 原串 · `p2Id` 内层 id · `p2p{k}` 内层参数）④ `WormholeAutoHandover` 增 `reasonId`/`reasonParams`（`016` 主控忙（槽译文挂 `BusyLabel`）· `017` 主控在虫洞里 · `018` 没有别的空闲船）⑤ `wormholeAutoStart` 两处 `return` 改**透传三字段** ⑥ 召回日志补 `textId`（`019`）⑦ 候选行 `blocked` 类型随之内收 |
| 2 | `apps/desktop/.../game/engine.ts` | 包装层 `wormholeAutoBlockReason` 返回类型同步改 `CoreBlockReason \| null` |
| 3 | `apps/desktop/.../panels/Wormhole.tsx` | ① `autoMainReason` 由中文串改**结构化对象**（与 `autoBlock` 同款 ⇒ `autoGate` 直接合并）② 候选行 `busy:` 改走 `cmdText(autoBlocked)` ③ **三处** `{autoGate}` 直出改 `cmdText(autoGate)`（进入按钮 `title` · 准备页警示条 · 扫描页警示条） |
| 4 | `packages/core/tests/wormhole-auto.test.ts` | 5 条断言由"断中文子串"改**断 id**（`005` · `007` · `010` · `011` · `015`）＋ 1 条对象断言改取 `.error` |
| 5 | `packages/data/src/l10n/table.ts` | 补 16 条（`core.wormholeAuto.004~019`） |

**验证**：`typecheck` 四包 0 错 · core **287 文件 / 3018 用例全绿** · `l10n:check` ✅ · `l10n:params` 0 漏喂 ·
`content:check` ✅ · `ui:rot-check` ✅ · `arch:guard` ✅。
另做了一次"**引用的 id 是否都在表里**"的一次性核对：本批 4 个文件共引用 **572** 个 `core.*`/`ui.*` id ⇒ **缺表 0**
（3 处命中全是注释里"已作废 id"的记录）。

**过程中的一次自纠（留痕）**：改 `Wormhole.tsx` 那段 `title` 三元时，落码脚本在行尾多留了一个 `)`
⇒ 桌面包 `typecheck` 一次报 **14 个** JSX 语法错（含"JSX 表达式必须有唯一父元素"这类下游误报）。
按报错首条定位、删掉那个括号即全绿 —— 教训：**JSX 里的三元/括号改动，落码后立刻过 typecheck**（语法错会级联，别逐条追下游）。

### ⛔ 仍挂账（本文件剩 2 条 · 都是复合句日志）

| 位置 | 内容 | 卡在哪 |
|---|---|---|
| `wormholeAuto.ts:679`（出发日志） | `🛰 自动探索队出发：{原型名} · {N} 条舰（{名单}）——约 5 分钟后返航（…）` | 原型名要 `p1Id`（表里已有 `core.wormholeArch.001~005`，缺的是 **core 侧的原型→id 映射**，属小改）；**名单**是"顿号连接的动态列表" ⇒ core 不知道该用哪种语言的分隔符 |
| `wormholeAuto.ts:940`（返航日志） | `🛰 自动探索队返航：带回 {战利品}（已入仓库）{核心}；损伤：{明细}。{谜质科技}…` | 同上（战利品/损伤都是列表）；且**损伤明细每一项自己还有模板**（`{船名}（结构 −{x}% / 装甲 −{y}%）`）⇒ 正是 `logParts.ts` 头注那个"参数那层再挂模板"的缺口 |

### 🆕 本批新发现的缺口（比上面两条更大 · 供船长裁）

**core 侧"列表参数"没有语言感知的拼装机制**。现象：core 里到处是 `${names.join('、')}`
（`git grep "join('、')"` 读数：core **46 处**），把中文顿号**焊进参数值**；而参数值不会再被翻译
⇒ **英文界面里这些列表用中文顿号连接**（例：`Ship A、Ship B`）。
名单里的**名字**没问题（`ctx` 在渲染层已按语言覆盖，见 `data/src/l10n.ts` 的 `localizeCtx`）——**分隔符**才是漏的。

渲染层已有先例可照搬：`ui/foeBrief.ts:294` 写的是 `join(en ? ', ' : '、')`，但那是**渲染层自己拼**；core 拼的串拿不到这条信息。
两条路（**请船长裁**）：

- **甲（推荐）**：给"列表槽"立个机制 —— core 传 `p{n}List: string[]` ＋（可选）`p{n}ItemId` 逐项模板 id；
  渲染层按当前语言的分隔符（zh `、` / en `, `）拼接、逐项套模板。改一处渲染层收口，全仓 46 处 core 列表都能受益。
- **乙**：暂不做，接受"英文界面里名单用中文顿号连接"，带名单的日志先按单模板补 id。
  ⚠ 不推荐：等于明知半中半英还落码（船长 2026-09-29 报障的正是这一类）。

⚠ 与**既有待裁项**的关系：这条与 `logParts` 三层缺口**是同一类问题**（都是"参数里再套模板/列表"）。
建议**一起裁、一起修**（先修机制、再批量做 70 余条复合句日志），否则复合句做完仍要回头返工。

---

## 批⑬ 机制批：**列表槽**（船长「按你建议来修」· 2026-10-02）

**缘起**：批⑫ 挂账的两条虫洞日志（出发/返航）卡在同一处 —— core 里 `${names.join('、')}`（全仓 46 处）
把**中文顿号焊进参数值**，而参数值不会再被翻译 ⇒ 英文界面里列表是「A、B」。
**船长令**：「按你建议来修」＝ 走**甲案**（立列表槽机制），并把挂账的日志一并清掉。

### 一、机制（两处收口，全仓受益）

| # | 位置 | 改动 |
|---|---|---|
| 1 | `packages/core/src/logParts.ts` | 立契约：`p{n}List`（逐项值）＋ `p{n}ItemId`（逐项模板，可选）＋ `p{n}ItemParams`（逐项参数，可选、索引对齐）；新增 `logParams()`（不走段链的单段日志用）与 `LogParamsExtra` 类型；`logParamsOf` 扩第二参。**单点断言仍只在本文件**（依据 `state.ts` 的 `LogParams` 头注） |
| 2 | `apps/desktop/.../i18n/locale.tsx` | 实现：`composeParts` 里按 `p{n}List` 拼列表（基础模板槽 ＋ 段链 `seg{n}p{k}List` 都认）；**分隔符按当前语言取** `core.state.043`（zh `、` / en `, `）；逐项模板的 `{p1}` 缺省 = 该项值、`{p2}…` 取 `ItemParams[i]` |
| 3 | `packages/data/src/l10n/table.ts` | 新增分隔符词条 `core.state.043`（与 `core.state.042`「。」同族：共享标点） |
| 4 | `packages/core/src/aiCores.ts` · `wormholeGrid.ts`（＋ `ai.ts`/`index.ts` 再导出） | **两张「名字 → id」表挪进 core**（`AI_CORE_IDS` · `WORMHOLE_ARCHETYPE_IDS`）：core 当参数喂名字时要给 id；渲染层 `ui/labelsText.ts` 改为 **import 这两张表**（原先各写一份 ⇒ 必漂） |
| 5 | `tools/param-miss-check.ts` | 新增**第五段判据**（列表槽契约四条：分隔符词条在表里 · 外层模板真有那一槽 · 逐项模板在表里且逐项参数给齐 · 不许只有 `ItemId` 没有 `List`） |
| 6 | `tools/l10n-render-probe.ts` | 新增 3 条**渲染层真身**夹具（出发名单 / 返航四类槽齐 / 返航空态），中英各一遍 |
| 7 | `tools/l10n-core-zh-audit.ts` | 顺手修工具自身盲区：三条判据改为在**剥注释后的源码**上跑（此前 JSDoc 里的 `addLog(…, 中文原串, …)` 示例会被当成真漏口） |

### 二、用新机制清掉的两条挂账日志（虫洞域）

| 位置 | 新 id | 槽位 |
|---|---|---|
| `wormholeAuto.ts:679` 出发 | `020` | `{p1}` 原型名（挂 `p1Id` = `WORMHOLE_ARCHETYPE_IDS`）· `{p2}` 条数 · `{p3}` **名单（列表槽）** · `{p4}` 分钟 |
| `wormholeAuto.ts:940` 返航 | `021` | `{p1}` 战利品（列表槽 `022` 逐项模板；**空态**挂槽译文 `023`「空手而归」）· `{p2}` 核心附注（`024`，内层核心名再挂 `p2p1Id` = `AI_CORE_IDS`）· `{p3}` 损伤明细（列表槽 `025`）· `{p4}` 谜质科技段（`026`） |

**中文原串一字未改**（逐字核对：两条的 `text` 与改造前同款，`p{n}` 只是另挂的 id 参数）。

### 三、过程中的两个坑（留痕）

1. **英文里"空格的归属"**：中文串 `…损伤：X。谜质科技：…。2 条舰…` 段间**直接相接**，英文句号后却要空格，
   而谜质科技段**可能为空** ⇒ 空格必须由"恒在的那一侧"提供：基础模板 en 写 `{p3}.{p4} All {p5} ships…`、
   谜质科技段 en 自带**一个前导空格**。第一版没这么写，`l10n:render` 当场报出 `0.80.All.` 少一个空格。
2. **可选槽必须"恒传空串"**：`{p4}` 是硬槽，缺键会**原样漏 `{p4}`**（渲染层既定行为：宁可漏出来也不悄悄改中文）
   ⇒ 谜质科技段改回 `p4: techText`（空串也传）。这条同时写进了 core 用例与真身夹具。

### 四、护栏的负向自测（"护栏不报"是最危险的）

第一版第五段判据**只认"对象字面量实参"** ⇒ 本批推荐的写法 `logParams({…})` / `logParamsOf(composed, {…})`
整条被跳过（负向自测：把 `p1ItemId` 改成不存在的 id，判据居然 0 报）⇒ 改成**拆开包装函数**取那个额外参数、
并且**递归收集键**（可选键常挂在条件展开 `...(x ? {…} : {…})` 里）。重跑三种坏法**都报**，且复原字节一致：
`ItemId` 不在表里 · 缺 `ItemParams`（模板要 `{p2}`）· 只有 `ItemId` 没有 `List`。

### 五、验证

`typecheck` 四包 0 错 · core **289 文件 / 3025 用例全绿** · `l10n:check` ✅ · `l10n:params` **五段判据全 0** ·
`l10n:render` ✅（11 条夹具 × 中英各一遍，逐字相符且无残留占位符）· `content:check` ✅ · `ui:rot-check` ✅ ·
`ui:subs-check` ✅ · `arch:guard` ✅ · `npm run build` ✅。

**读数**：`l10n:core-zh -- wormholeAuto` **17 → 0**（批⑫ 之后剩的 2 条已清）；
全仓 **172 → 161**（⚠ 其中一部分是**工具口径更正**：剥注释后少了 11 处注释误报 —— `return` 97→88 · `addLog` 74→72）。
⇒ 历史读数（含 271 那笔起点）是**旧口径**测的，含注释误报；逐域"清了多少"以各批的实测读数为准。

**⚠ 跨域如实登记（§十八）**：本批落在 **虫洞 ＋ AI 核心** 两个域 ——
AI 侧只有 2 个文件、各加一张「档名 → id」表（`AI_CORE_IDS` 十行、`ai.ts` 一行再导出），**零行为变化**；
理由是返航日志要把核心档名当参数喂模板（不这么做的话英文侧那一小段仍是中文）。**如需退回，删掉 `p2p1Id` 那一行即可**，
机制与虫洞侧不受影响。

## 待做（按盘点稿顺序）

**已完成**：批① 舰船（提交 `7bb830e4`）· 批② AI · 批⑤ 工业 · 批⑥ 装配 · 批⑦ 虫洞＋战斗读数 · 批④ 市场（`shipSellable`/`sellShipAtMarket` 无界面入口 ⇒ C 类登记不动）·
批③ 远征（可做 6 条已做，两条链挂账）· 批⑨-①~④ 日志行（`location.ts` 清零 · `combat.ts` 余 8 条复合句 · `wormholeSalvage.ts` 余 5 条复合句）· 批⑫ 虫洞自动探索面板（`wormholeAuto.ts` 17 → 2）。

**待做**：
- **等船长裁（三条，按优先级）**：① 列表槽机制（本页批⑫ 一节末 · 甲/乙）② `logParts` 三层缺口先修不修 ③ 批⑩ 随档提示串走甲（并列 `…Id`/`…Params` 字段，零迁移）还是乙（字段改结构化对象，需存档迁移）。
- **等船长批准**：批⑪ 共享守卫 `state.shipLockedReason`（8 文件 / 15 处调用点）＋ `activityGate.cannotInterruptReason`——跨域，需先申请。
- **可直接接着做（不涉跨域/不涉存档）**：批⑨-⑤ `expedition.ts` 10 条 · ⑨-⑥ `encounters.ts`＋`wormholeBattle.ts` 13 条 · ⑨-⑦ 零散 23 条（`market` 5 · `sideTasks` 5 · `manufacturing` 5 · `station`/`explore` 各 2 …）· 批⑧ B 类待核 9 条（其中 4 条已在批⑤ 顺手核清）。
- **建议一并立护栏（等船长点头）**：把"源码里引用的 `core.*`/`ui.*` id 必须都在唯一表里"做进 `l10n:check`——本批一次性核对花了几秒、全仓可复用，能永久堵住"少补零/拼错 ⇒ `tr()` 静默回落"这类闸门看不见的漏。
