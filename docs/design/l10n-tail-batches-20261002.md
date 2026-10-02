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

## 待做（按盘点稿顺序）

批③ 远征/自动循环（9 条）· 批④ 市场（2 条）· 批⑤ 工业（3 条）· 批⑥ 装配（1 条）· 批⑦ 虫洞＋战斗读数（2 条）· 批⑧ B 类待核（9 条）· 批⑨ 日志行（97 处，建议单独立项）· 批⑪ 共享拒因（`shipLockedReason` / `cannotInterruptReason`，跨 6 域，需先申请）。
