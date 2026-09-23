# 技能页合并（旧目录 → 科技树页）· 2026-09-23

状态：**已落码，待船长验收**（core 前置按等级 / 一键补齐 / 取消级联 + 技能页图标·列表切换与确认条）

> 船长原话（照抄）：
> 「旧版技能页面的技能目录，合并到现有的技能树页面内，加一个类似其他页面图标/列表的切换按钮。方便玩家切换。
> 玩家选择某个技能后，如果该技能有前置技能，可以直接添加前置技能到训练队列。训练队列内取消一个技能的同时
> 会取消所有依赖其前置的后续技能的训练。（但是假设前置是LV1，你取消的是LV2并不会移除后续的其他技能训练。）」

> 口径确认（船长答，照抄）：
> ① 「玩家默认是技能树，切换列表显示旧目录，但是搜索栏依旧在标题上，不嵌入旧目录。切换按钮就放搜索边上。」
> ② 「甲：详情窗给「一并加入前置」按钮，点一下补齐」
> ③ 「甲：逻辑按等级实现，数据侧本轮不标具体等级（现有技能仍只要求 Lv1）」
> ④ 「甲：清整个队列里所有不满足的依赖项（含排在它前面的）＋ 会连带取消时先弹确认条列出」

## 范围与不做

- 只动**技能页**（`pages/SkillsTreePage.tsx` + `pages/skillShared.tsx` 的队列面板）与 core 的训练队列语义
  （`packages/core/src/engine.ts`）；旧页 `SkillsPage.tsx` **不恢复、导航不加项**（它的目录渲染从 git 历史取回后接进树页）。
- **不改存档结构**：`skills.queue` / `skills.trained` / `savedProgress` 字段一律不动（级联只是删条目）。
- 不改训练时长、不改技能数值；**数据侧本轮不标具体前置等级**（`prereqLevel` 字段留空 ⇒ 全部仍要求 Lv1）。
- 不新写第二套训练逻辑：入队/取消一律走既有 `enqueueSkill` / `removeQueueAt`。

## 现状（落码前已核）

| 事 | 单点 |
|---|---|
| 真前置判据 | `SkillDef.prereq`（`packages/data/src/skills.ts`，43 处，全部只要求 **Lv1**）＋ `PREREQ_MIN_LEVEL = 1` |
| 前置缺口（界面置灰与入队共用） | `skillLockMissing(state, def, catalog)`（`engine.ts:427`）——**本轮改成返回"缺口 + 要求等级"** |
| 入队 | `enqueueSkill(state, skillId, targetLevel, catalog)`（`engine.ts:443`）：前置校验 + **逐级入队**（`target = 已练 + 1 + 同技能已排数`） |
| 取消 | `removeQueueAt(state, index)`（`engine.ts:542`）：同技能后续条目**顺延一级**、队首进度转交或存 `savedProgress` |
| 界面动作包装 | `apps/desktop/src/renderer/src/game/engine.ts` 的 `dequeueAt` / `moveQueueAt` |
| 图标/列表切换的唯一实现 | `ui/itemView.tsx`（`useItemView` / `ItemViewBar`，手册·物品页·货仓页同款） |
| 技能页搜索栏 | **已在页头**（`.app-head-search-wrap` / `.app-head-search`，`SkillsTreePage.tsx:144`）⇒ 切换按钮放它边上 |
| 旧目录（已退役，从 git 取） | `87c1df71^:apps/desktop/src/renderer/src/pages/SkillsPage.tsx`（469 行：`SkillWideRow` / `nextLevelAction` / `skillUiState` / 分组渲染） |

## 三条落法

1. **视图切换**：页头搜索框右边加「图标/列表」切换（`ItemViewBar`）；**图标＝科技树（默认）**、**列表＝旧目录行**
   （沿用页头搜索 + 页内既有「大类 / 技能书」导航做筛选，**不再嵌一个搜索框**）。
2. **一键补齐前置**：详情窗在前置未满时给「**一并加入前置**」按钮 ⇒ core `planPrereqChain` 算出要补的级
   （**拓扑序**：更深的前置排前面；已在队列里的**复用不重复**；逐级入队），界面逐条 `enqueueSkill`。
   ⚠ 只补**前置**、不代排目标技能本身（船长的原话是"添加前置技能到训练队列"；要连目标一起排，改一行即可）。
3. **取消级联**：判据 = **该技能取消后最终会停在的等级** `V(s) = 已练 + 队列里该技能剩余条数`；
   凡队列中某项的前置要求 > `V(前置)` ⇒ 一并取消（**含排在被取消项前面的**）；删一项会让 `V` 变小 ⇒ **迭代到不动点**。
   界面先调 `skillCancelImpact` 拿"会连带取消哪些"⇒ 非空时**先弹确认条列出**，确认后才真取消。

## 落码结果（与上面的落法逐条对应）

| 项 | 落点 | 说明 |
|---|---|---|
| 前置按等级 | `types.ts` `SkillDef.prereqLevel?` · `engine.ts` `prereqNeedLevel` / `skillLockMissing`（**返回 `{def, needLevel}[]`**） | 数据侧本轮不标 ⇒ 全部仍 Lv1；判据/文案/级联同一把尺 |
| 一键补齐 | `engine.ts` `planPrereqChain` · `game/engine.ts` `enqueuePrereqChain` | 拓扑序 + 逐级 + **已在队列里的复用不重复**；只补前置、不代排目标 |
| 取消级联 | `engine.ts` `skillCancelImpact`（纯计划）＋ `removeQueueAt(state, index, catalog?)` | 判据 = **最终等级** `已练 + 队列剩余条数`；迭代到不动点；**含排在前面的项**；`catalog` 缺省不级联（老调用点不变） |
| 确认条 | `pages/skillShared.tsx` `QueueBlock` ＋ `.app-train-ask*` | **只在会连带取消时**弹出，逐项列出（名称 + 等级），确认才真取消 |
| 视图切换 | `pages/SkillsTreePage.tsx`（`useItemView` / `ItemViewBar`，与手册·物品页同款） | `图标 = 科技树（默认）`、`列表 = 旧目录`；**切换按钮在页头搜索框右边**，搜索栏留在标题上 |
| 列表视图 | 同页 `app-skilltree-catalog` 分支 | ⚠ **取舍**：没有照搬旧页 469 行，而是按同一套单点（`statusOf` / `skillLevelTimeMs` / `trainNextLevel` / `prereqTextOf`）**重写为精简目录行**（分组 + 名称/Lv/说明高亮/状态/时长 + 训练或"一并加入前置"）；样式沿用仍在仓里的 `.app-skill-group(-tag)` 家族 |

## 船长追加两条（2026-09-23 当日）

- 「**「一并加入前置」要练目标一起排**」⇒ `planPrereqChain(..., { includeTarget: true })`：末尾排上**目标本级**
  （等级 = 已练 + 队列已排 + 1，与 `trainNextLevel` 同尺；满级/隐藏技能不排）。配套把入队校验从
  「前置**已练成**」放宽为「前置**轮到这一项之前**到位」（新增 `skillLockMissingAtQueue`：已练 + 队列已排条数）
  —— 否则目标本级排不进去；**空队时与老判据完全一致**。为守住队列顺序语义，`moveQueueItem` 加**顺序契约**
  （传 `catalog` 时校验"没有哪一项排在它要的前置之前"，破了**整单回滚**并返回 false）。
- 「**正在训练的首位技能也要加入训练队列内（排第一）**」⇒ `skillShared.tsx` 的队列面板改为
  **队首 + pending 一起列**（编号 1..N 天然接上）；队首只给 ↓ / ×（它已在第一位），并给 `is-head` 强调色；
  空队列才显示空闲文案。

## 验证口径

- 闸门（本轮实跑）：typecheck 四包 0 错 · `npm run test -w @whale/core` **2123/2123**（新增 7 例：补齐链拓扑/逐级/复用、取消 Lv1 级联含前置项、**取消 Lv2 不动 Lv1 依赖项**、无 catalog 走老语义）· `content:check` · `ui:rot-check` · `l10n:check` · `npm run build`。
- 观感（列表行排布 / 确认条）交船长审；读数型问题（溢出、页签存在性）需要时用无头探针补。

## ⚠ 过程记录（失误与纠正）

本轮 core 的四笔改动一度**误写进主树**（路径写成 `H:\大鲸鱼\Deepseek-EVE\...` 而非工作树）。发现后：`git diff --output=<patch>` 导出 → 工作树 `git apply` 应用 → 主树 `git checkout --` **只还原那 4 个文件**（先确认主树当时无其他未提交改动）⇒ 主树回到干净状态，改动完整落在工作树。
