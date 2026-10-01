# 工业 HUD 页：组装机书架筛选收口 ＋ 卡片溢出修复（工作文档）

- **状态：进行中**（2026-10-01 开工；**①卡片溢出已修**，②筛选/搜索/动画待船长确认设计后实现）
- 经办：三号（worktree `Deepseek-EVE-verify`，分支 `verify`）
- 归档时：关键结论并入 `docs/roadmap.md`（＋必要的 `docs/glossary.md` 词条）后删除本文件（§十五）

## 1. 船长原话（照抄）

> 「新工业界面的组装机的蓝图书架筛选过于简陋，建议参考旧版的组装机筛选和搜索，同时一并应用AI指挥中心对应的SVG动画。」
> 「我还发现，制造队列内的卡片宽度超出了制造队列的窗口宽度」

## 2. 需求①：制造队列卡片宽度溢出（**已修**）

- **根因（静态可判，不需要起浏览器）**：`ui/layout-css/_hud-industry.css` 的 `.hud-card` 写着 `width: 100%`
  ＋ `padding: 10px 12px` ＋ 1px 边框，而**仓库没有全局盒模型复位**（`styles.css` 里那条 `*{box-sizing}`
  是顶栏局部的）⇒ 默认 `content-box` 下实际宽度 = 面板内容宽 **＋24 ＋2 = 溢出 26px**，正好顶出右列窗口。
- **同坑前科（本文件注释里已记两处）**：顶栏 `--app-max-w` 注释；`styles.css:2775` 训练项那次
  「训练项右侧顶到窗口」。**这是第三处** ⇒ 已在改动处写明。
- **改法**：给 `.hud-card` 补 `box-sizing: border-box`（一行，风格与既有同类修复逐字同款）。
- **影响面核过**：`.hud-card` 全仓只有 `IndustryHudPage.tsx` 两处（制造队列卡 / 实验室配方卡），
  没有宽度即不受影响、有 `width:100%` 的正是溢出那两处。
- ⚠ `_hud-industry.css` 是**直接 import 的源文件**（不是 `styles.css` 的派生件）⇒ 改它无需重跑
  `npm run ui:layout-css`；已跑 `ui:layout-css:check` 确认两份派生物仍与源码一致。

## 3. 需求②③：书架筛选/搜索 ＋ AI 指挥中心 SVG 动画（设计已确认，待实现）

船长四答（2026-10-01 全取推荐）：**①一级门类补齐五档**（全部 / 装备 / 零件 / 消耗品 / 舰船插件）·
**②二级子类按旧版粒度**（装备=产物功能组 · 消耗品=产物大类 · 零件=基础/高级）·
**③搜索 ＋ 已学会/未学会都要**（按旧版原样）· **④动画落点 = 制造队列行 ＋ 书架"正在造的那行"**。

**数据源核实**（`tools/_probe-shelf-src.mts`，一次性）：`ctx.blueprints` 里已经有 `item:part` 14 张（零件）、
`mod:plug` 12 张（舰船插件）⇒ 五档**在现有数据源上都能落地**，不需要新增数据；舰船蓝图在另一个集合
（`ctx.shipBlueprints`）且书架本就不列它（归造船厂页签）。

## 3.5 需求②③的实现（2026-10-01 落码）

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/renderer/src/ui/itemSubs.ts` | **`bpFilterKeysOf` 从旧工业页提升到这里**（成为真单点：旧页与 HUD 页共用一份）；同时**修正零件分类**——零件（`item.kind === 'part'`）原先落到「消耗品」档，现按既有单点 `partTierOf` 归 `part` 档（连带修好了**旧页蓝图书架的「零件」档**：它此前是空的） |
| `apps/desktop/src/renderer/src/panels/Industry.tsx` | 删掉本文件里的 `bpFilterKeysOf` 定义、改从 `ui/itemSubs` import（两处调用点改传 `engine.ctx`） |
| `apps/desktop/src/renderer/src/pages/IndustryHudPage.tsx` | 书架：一级五档（`SHELF_KIND_TABS`，插件档按 `plugCraftUnlockedOf` 闸）· 二级子类（`manuSubsOf` ＋ `presentSubs` 现算，"全部"门类不带子类）· 搜索（`.app-head-search`）· 已学会/未学会 · 仅可造；读数两态（筛剩 N 张 / 共 N 张）。动画：**制造队列卡**与**书架"正在造的那一行"**都挂 `AiWorkFx kind="craft"`（与 AI 指挥中心同一个组件） |
| `apps/desktop/src/renderer/src/ui/layout-css/_hud-industry.css` | 书架表加 `.is-queue`（动画槽首列 40px，与工位表 `.is-station` 同一套做法） |
| `packages/data/src/l10n/table.ts` | 新增 `ui.hud.151`（筛剩 {p1} 张）· `ui.hud.152`（共 {p1} 张）——⚠ **118/119 号段已被 main 占用，故用 151/152** |
| `packages/core/src/manufacturing.ts` | **顺手修一处类型缺陷**：`sortManuRows` 原签名把泛型 `T` 丢了（声明返回 `ManuOrderRow[]`），调用方拿排序结果放回自己的行类型就会被判不兼容（旧调用点靠结构相同侥幸通过）⇒ 改为返回 `T[]`（语义本就是"同一批行、只换顺序"） |

**取数纪律**：门类/子类/学会/可造四把尺**全部走既有单点**（`bpFilterKeysOf` · `manuSubsOf` · `presentSubs` · `canStartBlueprint` ＋ `missingMaterials`），本页不自算任何分类。

## 4. 验证

- 需求①（溢出）：`ui:rot-check` ✅ · `ui:layout-css:check` ✅（两份派生物与源码一致）。
- 需求②③：`typecheck` 四包 ✅ · `content:check` ✅ · `l10n:check` ✅ · `l10n:params` ✅（明确漏喂 0 处 ·
  模板用法 0 处）· `ui:rot-check` ✅ · `ui:layout-css:check` ✅ · core 全量用例 ✅。

## 5. 待裁决点

1. 需求①②③**已全部落地**，交船长验收（观感归船长：书架三行筛选条 ＋ 两处动画）。
2. 旧页蓝图书架的「零件」档因单点修正而**从空变有**（这是修 bug 的连带效果，已如实记在上面）。
