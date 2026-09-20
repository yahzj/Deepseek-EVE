# 成就系统（第一批 · 徽章框架）— 设计稿（2026-09-20）

> **状态：第一批已完成并合入 main（2026-09-20）。**
> ⚠ **第二批（里程碑成就内容）仍未完成** ⇒ 未完成挂在**第二批**上，`⟪未完成 2026-09-20⟫` 记号保留在
> **第二批的落点处**（`data/achievements.ts` 的 `milestone` 分类注释、`core/achievements.ts` 头注释、
> `roadmap` 清单行）；**第一批已完成的代码不再挂记号**（按约定 §十一之二：完成即删记号，残留会让本地化永远跳过它）。
> 规则见 `docs/development-conventions.md` §十一之二。

## 落码记录（2026-09-20 · 第一批）

| 落点 | 内容 |
| --- | --- |
| `packages/data/src/achievements.ts` | 63 枚徽章表：13 任务徽章由 `FIRST_TASKS` **派生** ＋ 50 链徽章由链配置**派生**（任务表增删时自动跟随，不会漏配） |
| `packages/core/src/achievements.ts` | `achievementReached` / `advanceAchievements`（每拍现算补发 · 幂等）· `achievementOverview` / `achievementCount` / `chainAchievementGroups`（界面读数） |
| `packages/core/src/types.ts` | `AchievementDef` / `AchievementSource` / `AchievementCategory`（含预留的 `'milestone'`） |
| `packages/core/src/state.ts` | `GameStateV30` ＋ `AchievementState` ＋ `CURRENT_STATE_VERSION 29 → 30` ＋ 新档写 `{ earned: {} }` |
| `packages/core/src/save.ts` | `MIGRATIONS[29]`（补空账本）＋ 载入器逐项清洗（时刻取非负整数、**不查表**） |
| `packages/core/src/engine.ts` | 挂点：`advanceFirstChains` **之后**调 `advanceAchievements(state, ctx.achievements)`（任务与链的达成同拍可见） |
| `packages/data/src/context.ts` · `index.ts` | 注册 `achievements` 目录 ＋ 导出 |
| `apps/.../ui/Glyphs.tsx` | 新增 `ach-*` 盾徽图案族（14 个形状：`ach-first` ＋ 每条链一枚） |
| `apps/.../panels/Achievements.tsx` | 二级窗口 ＋ 任务中心入口按钮（`AchievementsButton`） |
| `apps/.../panels/Expedition.tsx` | 「重要任务」页放入口按钮 |
| `apps/.../styles.css` · `i18n/dict.en.ts` | 样式段（固定尺寸徽章卡）＋ 7 条界面词条 |
| `packages/core/tests/achievements.test.ts` | **17 条**用例：表口径（枚数/档位/图案配色/上限）· 达成判定 · 发放去重 · **纯展示不动资产** · 老档自愈 · 读档往返 · 界面读数 · 与引擎同拍 |

**验证（2026-09-20）**：`typecheck` 四包 0 错 · core **174 文件 / 1913 用例全绿**（新增 17）·
`content:check` ✅ · `ui:rot-check` ✅（UI 改动必跑）· `ui:tip-check` ✅ · `l10n:check` ✅ ·
`save:migrate` **71/71**（v25/v28/v29 真档 → v30，资产不变）· 桌面 **build ✅**。

**与设计稿的两处偏差（施工中发现，已在表中修正）**：
1. 徽章总数 **58 → 63**：设计稿初版把 `FIRST_TASKS` 数成 12 条，实际 **13 条任务 / 13 条链**（见 §3.1）；
2. **老档补发不写在迁移里**：`MIGRATIONS` 只吃 raw state、拿不到内容表 ⇒ 改由 `advanceAchievements`
   **载入后第一拍现算补发**（幂等、判定只有一份）。代价 = 补发时刻记"载入后那一拍"而非当年真实时刻；
   徽章**纯展示** ⇒ 无影响（`save.ts` 的 `MIGRATIONS[29]` 注释已写明）。

## 一、船长原话（照抄）

- 2026-09-18（预留接口时）：「**顺便打算制作成就系统，每个重要任务就会给予一个成就徽章，
  不过等做完这个之后再考虑，先挂机，可以预留接口**」。
- 2026-09-20（本轮指令）：「**继续之前的成就系统，并标注未完成。新增规则，未完成的功能不计入本地化工作排队。**」
- 2026-09-20（链徽章口径修正）：「**链徽章在1级，4级，7级，10级时候各给一枚，图案相同，用颜色区分。**」
- 2026-09-20（宇宙探索家修正）：「**宇宙探索家，只做2枚，分别是1级和5级。**」

## 二、集中提问与船长裁定（2026-09-20）

| # | 问题 | 船长裁定 |
| --- | --- | --- |
| 1 | 「之前的成就系统」指哪个 | **就是 `firstTasks.ts:355` 那个预留接口，从现在立项开工**（仓里确实只有接口、无设计稿） |
| 2 | 标注未完成标在哪 | **roadmap 里建「未完成」清单条目**（另两处未选） |
| 3 | 本地化新规怎么落地 | **写成约定条文**（未选"再加体检护栏"） |
| 4 | 成就范围 | **徽章 ＋ 另设一批里程碑成就** |
| 5 | 发放时机 | **任务达成时自动发** |
| 6 | 界面位置 | **独立一级页** → 因撞「一级页不滚」红线，追问后改判为 **二级窗口** |
| 7 | 徽章是否给利 | **纯展示，不给任何奖励** |
| 8 | 老档处理 | **老档已完成的补发** |
| 9 | 分批 | **分两批：先徽章框架，后里程碑** |

> **红线冲突已摆明并获裁**（AGENTS §5.2）：独立一级页会撞「一级页不滚」（2026-09-08 船长定 ·
> 内容必须完整装下、禁硬裁）；船长改判 **二级窗口**，不开口子、不动红线。

## 三、范围（第一批：徽章框架）

### 3.1 徽章清单 = **63 枚**

| 来源 | 枚数 | 触发 |
| --- | --- | --- |
| 13 条「第一次」任务 | **13** | 任务达成（`advanceFirstTasks` 返回新 id 时自动发） |
| 12 条一般链 × 1/4/7/10 级 | **48** | 链进度达到该档自动发（各 10 级 ⇒ 各 4 枚） |
| 宇宙探索家（`scan` 链） | **2** | **1 级与 5 级**（该链上限就是 5 级，`CHAIN_TIERS.scan = [5,8,12,16,20]`） |
| 合计 | **63** | |

- ⚠ **施工时核对修正**：设计稿初版写「58 枚（12 任务 ＋ 44 链 ＋ 2）」，是把 `FIRST_TASKS` 数成了 12 条；
  实际 **13 条任务 / 13 条链**（`firstTasks.ts` 实测）⇒ 正确总数 **63**。差额 5 枚 = 漏算的那条任务链的 4 枚 ＋ 任务徽章 1 枚。
- ⚠ `scan`（宇宙探索家）与其他链口径**不同是有意的**（船长 2026-09-20 裁定）：它上限只有 5 级，没有 7/10 级可给。
- 其余 12 条链均为 10 级 ⇒ 各 4 枚。

### 3.2 图案与配色（船长：「图案相同，用颜色区分」）

- 每枚徽章 = **一枚 SVG 线稿底纹 ＋ 一个类别小符号**（守 AGENTS §6「视觉物件一律 SVG 线稿」，
  **禁 CSS 拼形状**）。
- **同一条链的 4 枚共用同一张底纹**，靠颜色区分档位；取本仓**既有语汇**（`Glyphs.tsx:870-882`
  的"同造型 · 按档位分色"成例，AI 核心 / 图纸货柜）：

| 档位 | 色值 | 沿用出处 |
| --- | --- | --- |
| 1 级 | `#7fd4a8` 青绿 | AI 核心 · 伽马 |
| 4 级 | `#ffca58` 琥珀 | 图纸货柜 · 中层 / AI 核心 · 贝塔 |
| 7 级 | `#ff9d5c` 炽橙 | AI 核心 · 阿尔法 |
| 10 级 | `#e07bff` 品红紫 | 图纸货柜 · 深层 |

- **宇宙探索家那 2 枚**按首尾取：1 级 = 青绿、5 级 = 品红紫（与四档梯子同向）。
- 未达成的徽章走**灰阶剪影**（可见但无色，便于玩家看到"还差什么"）。

### 3.3 涉及模块（新增 / 修改）

**新增**
- `packages/data/src/achievements.ts` — 58 条定义：`id / 名称 / 说明 / 图案键 / 色档 / 归属（任务或链 ＋ 档位）`。
- `packages/core/src/achievements.ts` — `grantAchievement`（去重、只置一次）＋ `advanceAchievements`（每拍判定）。
- `apps/desktop/src/renderer/src/panels/Achievements.tsx` — **二级窗口**，小卡网格。

**修改**
- `packages/core/src/engine.ts` — 挂点 = 现有的 `advanceFirstTasks` 循环（`engine.ts:186-200`）内、
  `grantFirstReward` 之后加一次发放；链档位在 `advanceFirstChains` 之后判定。
- `packages/core/src/state.ts` — `state.achievements.earned`（id → 达成时刻）＋
  `CURRENT_STATE_VERSION 29 → 30`。
- `packages/core/src/save.ts` — `MIGRATIONS[29]`：**老档补发**（`importantTasks[id].done === true` ⇒
  对应任务徽章；链按 `delivered` 已达成级数补 1/4/7/10 中已达档位；`scan` 按 1/5 补）。
- `packages/core/src/index.ts`（导出）· `packages/data/src/context.ts`（目录注册）。
- 任务中心页（`panels/FirstTasks.tsx` 或 `ImportantTasks.tsx`）— 加入「成就」入口按钮。
- `i18n/dict.en.ts` ＋ `packages/data/src/l10n.ts` — 中英双语条目。

**删除**：无。

### 3.4 明确不做（第一批）

- **里程碑成就内容**（第二批）：另设一批非任务类成就（如首杀、深入层数、AI 核心累计等）——
  内容与判定另批定，第一批只把框架留好。
- 不做成就点数 / 等级 / 排行 / 分享。
- **不发任何 ISK / 物品 / 数值加成**（船长裁定：纯展示）⇒ 不动经济，不用重跑数值工具。

## 四、验证计划（落码时执行）

`npm run typecheck`（四包 0 错）· `npm run test -w @whale/core`（新增用例：发放去重 · 链档位判定 ·
老档补发 · 读档幂等）· `npm run content:check` · `npm run ui:rot-check`（新增界面，必跑）·
`npm run ui:tip-check`（徽章悬停走 `Tooltip.tsx`）· `npm run save:migrate`（67 份真档全绿）·
`npm run l10n:check` · 桌面构建。

## 五、未完成标注

- 本文件头部已标状态；落码时在 `data/achievements.ts` / `core/achievements.ts` 头注与
  `roadmap` 清单处一并标 **`⟪未完成 2026-09-20⟫`**。
- **收口**：第一批完成并合入 main 时，删掉全部 `⟪未完成⟫` 记号、从 roadmap 清单删条，
  并把本文件按 AGENTS §8 归档（关键内容并入老文档 → 删本文件 → 重跑 `docs:index`）。
