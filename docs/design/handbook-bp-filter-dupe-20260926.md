# 工作文档 · 手册蓝图图鉴筛选不消失（BP_MAIN 重复键）（2026-09-26 · 三号）

> **状态：进行中** —— 根因已实锤、已落码、闸门待跑；归档按 AGENTS.md §8（船长验收 + 合入 main 后当批做：
> 关键内容并入 `docs/roadmap.md` 一条 → 删本文件 → 重跑 `docs:index`）。
> **船长原话（照抄）**：「**出现了BUG，手册内点击蓝图图鉴切换其他图鉴后，蓝图的筛选不会消失**」

## 一、根因（实测实锤 · 一行定位）

`apps/desktop/src/renderer/src/panels/Handbook.tsx` 的 **`BP_MAIN`（蓝图图鉴的一级筛选表）里
`equip` / `ship` / `consume` 三个键各重复一次**（数组共 7 项：`equip, ship, consume, equip, ship, consume, part`）：

```ts
const BP_MAIN: SubOption[] = [
  { key: 'equip', label: tr("ui.ShipPage.115") },
  { key: 'ship',  label: tr("ui.ShipPage.116") },
  { key: 'consume', label: tr("ui.ShipPage.114") },
  { key: 'equip', label: tr("ui.ShipPage.115") },   // ← 重复
  { key: 'ship',  label: tr("ui.ShipPage.116") },   // ← 重复
  { key: 'consume', label: tr("ui.ShipPage.114") }, // ← 重复
  { key: 'part',  label: tr("ui.Handbook.265") },   // 并入 main：对方新增「零件蓝图」门类（id 新登记）
]
```

**为什么表现为"筛选不消失"**：筛选胶囊用 `key={o.key}` 渲染 ⇒ 前三个键各出现两次、**React 遇到重复 key**；
子筛选判定按**键值**（`main === 'equip'` 等）⇒ 点**第二颗**同名胶囊时 `mainKey` 立刻成立（二级栏照常出现），
但**高亮落在第一颗上**（两颗同名、玩家看到的是"选中的那颗还在"）；切别的图鉴回来再看，那三颗仍是双份
⇒ 玩家观感 = 「蓝图筛选不消失」。一级/二级的**判定逻辑本身没错**（`changeTab` 确实归零），
错的是**这张表有重复项**。

## 二、来源（如实记：这是**我合并时留下的**）

`git show 16a2a4bf` / `1c1bb2ce` / `451ae461` / `ec000449` / `main` **五处 BP_MAIN 完全相同**（都是 7 项带重复），
引入点是 `16a2a4bf`（`Merge branch 'main' into d2/workspace`）——注释里那句
「并入 main：对方新增「零件蓝图」门类」正是**解冲突时把同一段数组粘了两遍、只去掉了注释**留下的痕迹。
⇒ **不是本次新引入的功能缺陷，是 2026-09-26 那次合并的残留**；本次（`ec000449` 我解的那次）只是**原样继承**。

## 三、改法

1. **删掉三行重复项**：`BP_MAIN` 回到 4 项 `equip / ship / consume / part`（各自只出现一次）。
   判定与分组键的语义**一字不改**（有 `shipId` = 舰船蓝图、有 `itemId` 且产物是零件 = 零件蓝图、其余 = 装备蓝图）；
   胶囊顺序仍是 装备 → 舰船 → 消耗品 → 零件。
2. **加防复发契约**（见下）：这类"重复项"在 typecheck / 单测 / 现有五道闸门里**全查不出来**
   （数组合法、类型合法、判定按值），必须新增一条体检。

## 四、防复发契约（正式工具入库）

新增 **`tools/ui-subs-check.ts`** ＋ `npm run ui:subs-check`，并挂进 `ui:rot-check` 链
（与 2026-09-24 的 `ui:tdz-check` 同款做法）。

判据（三条，全部只读源码文本、不需要浏览器）：

1. **同一张选项表内 `key` 不得重复** —— 扫 `apps/desktop/src/renderer/src` 与 `packages/ui/src` 下
   **模块级对象数组**（含 `export const` 与非导出的 `const`，如 `BP_MAIN`）；
2. 同表内 `label` 不得重复（同一栏出现两颗同名胶囊 = 玩家分不清）；
3. `id` 不重复（有 `id` 的表，`id` 是本地化键，重复 = 两处共用一条文案，多半是复制粘贴）。

**首次运行的存量读数**（给船长看清全仓现状）：29 张带 `key` 的选项表，**有重复的只有 `BP_MAIN` 这一张**
（其余 28 张干净）⇒ 修掉它以后本契约应为全绿。

## 五、验证（实测读数）

| 闸门 | 读数 |
| --- | --- |
| `npm run typecheck` | 四包 **0 错**（core / data / ui / desktop） |
| `npm run test`（core） | **227 文件 / 2492 用例全绿** |
| `npm run content:check` | ✅ 通过（两条既有警告：`bp-shieldfield-2/3` 书价偏离，**改动前就在、与本批无关**） |
| `npm run l10n:check` | ✅ 通过（无死引用 · 无中文源串 · 占位符对齐 · 无残留中日韩字符） |
| `npm run ui:rot-check` | ✅ 通过（含**新挂的 `ui:subs-check`**：26 张表无重复项；TDZ 体检"直接执行 0"） |
| `npm run ui:theme-check` | ✅ 通过（token + 伤害类型配色契约，六套主题逐套打印读数） |
| `npm run build`（桌面） | ✅（2.09 秒；产物含 styles-modern / styles-classic 两份布局样式） |
| 网页构建 | ✅（⚠ `web/` **不在 npm workspaces 里**（`workspaces` = `packages/*` + `apps/*`）⇒ 必须在 `web/` 目录里跑 `npm run build`，`-w @whale/web` 会报 "No workspaces found"） |

**新契约的两次运行（正向 ＋ 负向）**：

- **正向**（修好后）：`筛选/选项表体检：扫描 26 张带 key 的表（label 写法：tr(id) 72 处 · 字面量 40 处）` ⇒
  `✅ 无重复项：每张表内 key / label / id 各自唯一`（exit 0）；
- **负向**（临时把一条 `equip` 加回去）：报 **2 处**重复并 **exit 1** ——
  `Handbook.tsx:107 BP_MAIN 的 key 重复：equip 出现 2 次（第 107 / 113 行；数组共 5 项）` ＋ 同处 `label` 重复；
  撤销注入后复跑逐字回到正向读数。

**观感/手感**：修复只让重复胶囊消失，判定口径与胶囊顺序一字未改 ⇒ 请船长真机看
「手册 → 蓝图图鉴 → 点胶囊 → 切别的图鉴再切回来」是否正常。


## 六、不做（本批范围外）

- 不改筛选的判定口径与分组顺序（那是 2026-09-13 起船长定过的口径）；
- 不动 `changeTab` 的归零逻辑（它本来就是对的）；
- 不碰其它 28 张表（体检读数证明它们干净）。

_维护：本件按 §8 归档；关键内容并入 `docs/roadmap.md` 一条精简条目后删除本文件。_
