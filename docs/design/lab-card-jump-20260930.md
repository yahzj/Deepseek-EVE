# 实验室卡「去弄料」跳转 ＋ ⭐标记（工作文档）

- **状态：进行中**（2026-09-30 开工，实现与四闸门已完成，待船长批准 save 相关提交 ⇒ 见 §5 待裁决点）
- 经办：三号（worktree `Deepseek-EVE-verify`，分支 `verify`）
- 归档时：关键结论并入 `docs/roadmap.md` 一条精简条目后删除本文件（§8 文档纪律）

## 1. 船长原话（照抄）

> 「实验室的卡牌没有参考其他工业页面的卡牌添加跳转吗」

## 2. 三问三答（船长裁决，2026-09-30）

| 问 | 答 | 含义 |
| --- | --- | --- |
| 跳转按钮走哪条链 | **甲** | 复用精炼炉卡的「去矿带」同款四支链（`handleNeedMineral`），按钮**常驻** |
| 要不要一并补 ⭐ 标记 | **甲** | 新增**第五类**标记族 `labRecipes`（接受 `save.ts` 改动代价） |
| 改动范围 | **乙** | **只补旧工业页**；工业 HUD 页（调试用）不动 |

## 3. 范围 / 不做

**做**

- 实验室三张卡（超空间折跃燃料 / 突触加速剂 / 信号发射器）卡头右侧补：**⭐标记** ＋ **「去弄料」**。
- 「去弄料」= 缺料时跳到能弄到它的地方，缺料名写进悬停提示。

**不做**

- 不动工业 HUD 页（船长定「只补旧工业页」）。
- 不改实验室配方本身、不改用料/工期数值。
- 不新增布局（仍是卡头右侧既有三段：⭐ · 按钮 · 齐备度）。

## 4. 实现要点

- **⭐ = 第五类标记族**：`MarksState` 加 `labRecipes: string[]`；`marks.ts` 的 `MarkKind`/`MARK_KIND_TEXT`（「实验室配方」）/`markTargetExists`（校验 `ctx.labRecipes`）/`ensureMarks`/`pruneMarks` 五处登记。
  - ⚠ 与 `recipes` **不是一个 id 空间**：那边收**物品 id**（精炼炉卡），这边收**配方 id**（`jump-fuel` 等）⇒ 必须单开一类，混用会让「打过星的物品」和「打过星的配方」串进同一张表。
- **save.ts**：标记白名单重建由四类扩到五类（**纯增量**，老档缺字段 ⇒ 五类全空；无版本号变化，沿用 v24 兼容字段先例）。
- **「去弄料」**：`LabPanel`/`LabCard` 加 `onNeedMaterial?: (itemId: string) => void`；卡内取**第一味缺料**（`recipe.materials.find(...)`，按用料顺序，不是按缺口大小），点击后交给工业页既有的 `handleNeedMineral(itemId)` 四支链：
  ① 有精炼来源 ⇒ 切「精炼炉」子页 ＋ 一级回「原矿」 ＋ 二级清空 ＋ 高亮那张矿石卡；② 有组装机配方 ⇒ 切「组装机」并聚焦；③ 市场有货 ⇒ 跳市场；④ 四支全落空 ⇒ toast `ui.IndustryPage.097`。
- **文案（id 制）**：`ui.lab.025`「去弄料」/「Go get materials」· `ui.lab.026`「去弄料：缺 {p1}——跳到能弄到它的地方」· `ui.lab.027`「去弄料：看看第一味投料从哪来」。

## 5. 待裁决点（等船长）

- **`packages/core/src/save.ts` 动了**：提交会被 `.githooks/pre-commit` 的 **B-2「需裁决」**拦下（触及 `save.ts` ⇒ 拒绝提交，无放行开关）。
  按规定「报告船长 → 拿到明确批准 → `--no-verify` 提交 ＋ 汇报里写明」执行。**待船长批准**。

## 6. 验收读数（`tools/_ui-artifacts/lab-jump-readings-20260930.log`；截图 `shots/lab-jump.png`）

> 口径：以下均为**读数**（DOM 文本/属性/档内字段），**不是观感结论**——好不好看只有船长能判。

1. **卡头右侧**：三张实验室卡都有 ⭐（`data-ui-group=mark-star`，初始 `aria-pressed=false`）＋「去弄料」（提示带缺料名，如「缺 折跃等离子」）＋「可跑批次 0」。
2. **⭐落盘**：点「超空间折跃燃料」的 ⭐ ⇒ `aria-pressed=true`，档里 `state.marks.labRecipes = ['jump-fuel']`，**其余四类仍为空**（证明进的是第五类，没串到 `recipes`）。
3. **跨读档**：拆掉注档脚本后刷新 ⇒ 仍 `aria-pressed=true`、档里 `labRecipes` 仍在（走过 `save.ts` 白名单重建仍读得回）。
4. **「去弄料」**：点「超空间折跃燃料」的按钮 ⇒ 子页切到 **♨精炼炉**（选中）、高亮卡 = **氖云气**，**无 toast**。
   - 链条核对（不是巧合）：`packages/data/src/items.ts` 的 `gas-neon`（氖云气）`refine` 首项 = `min-jumplasma`（折跃等离子，perOre 0.178）⇒ 跳到的正是折跃等离子最低一档来源。
