# 工业 HUD 页接手：组装机 ＋ 造船厂 HUD 化 ＋ 技能体检修正（状态：进行中 · 2026-09-30 船长令）

> **船长原话（照抄）**：「**一号准备了一个工业界面重制，我希望你接手。使用skill来调整。**」
> ＋ 本轮裁定（集中提问后选定）：**范围 = 批 1 ＋ 批 2 一起做**；**验收画布 = 1340×900**。
>
> **技能**：`ui-ux-pro-max`（沿用一号落盘的 MASTER = HUD / Sci-Fi FUI · 密度 8/10 · 动效 Subtle）。
> **范围**：只动调试页 `pages/IndustryHudPage.tsx` ＋ 它的样式层 `ui/layout-css/_hud-industry.css`
> ＋ 新增 `ui.hud.*` 文案。**不动**现有工业页与全仓 `.app-*`；不改引擎/数值/存档；入口仍**仅调试可见**。

## 1. 接手时的现状（查实）

| 项 | 状态 |
|---|---|
| 精炼炉 / 实验室 | ✅ 一号已 HUD 化（工位矩阵 ＋ 产出仪表；配方目录 ＋ 投料 ＋ 运行） |
| **组装机 / 造船厂** | ❌ **内嵌旧面板**（`ManufacturingPanel` / `ShipyardPanel`）⇒ 同一页两种视觉语言 |
| 数据是否够 | ✅ 够：`manufacturingRunViews` · `matNeedCount` · `countWare` · `missingMaterials` · `calcBuildDurationMs` · `ownsBlueprint` · `recipeCapability` · `bookPriceOf` · `sortManuRows` 都是现成的取数口，**不用改引擎** |

## 2. 技能体检读数（改前 · 7 套主题 · 对比度）

口径 = `ui-ux-pro-max` 预交付清单（正文 ≥4.5:1 · 非文字 ≥3:1）；探针 `tools/_probe-hud-contrast.py`（一次性，已删）：

- ✅ 正文 / 次字 / 强调 / 警 / 危 **全部达标**（正文 12.3~18.9:1）；
- ❌ **`--hud-fg-faint`（= 次字 ×0.72）在 6 套主题只有 3.41 ~ 4.09:1**（正文要 4.5）——页面里那些"极弱说明字"用它；
- ⚠ `--hud-line`（发丝线）6 套主题 1.15 ~ 1.51:1：**装饰性分隔**可接受，**当控件边界用就不达标**（默认深空主题 3.44 ✓）
  ⇒ 两类线必须拆成两个令牌。

技能另给出两条本轮直接落地的口径：

1. **Compact Control Semantics（Critical）**：「interactive chips need a native role accessible name state keyboard
   operation and visible focus；**Don't: Use a clickable div**」⇒ 现页实验室的配方卡是 `<div onClick>`，**违反**，改真按钮；
2. **Empty States（Medium）**：「Show helpful message **and action**」⇒ 队列/书架/干船坞的空态都带一句引导；
3. **Bullet（chart 域）**：「Label every qualitative range and target with text; color is supplementary」＋
   「Keyboard: focus reveals the same detail as hover」⇒ 齐备度条旁**必须有文字读数**，且 `title` 与可见读数一致。

## 3. 本批实现（改动清单）

**批 1 · 两个页签 HUD 化**（按一号设计案 §三 的版式：左主视图 ＋ 右目录/列表）

- **组装机**：左「**制造队列**」（每线一卡：产物图标＋名 · 劳动者 chip · 扫掠进度条 · 材料齐备度 Bullet ＋
  文字读数 · 剩余时间 · 停线）＋ 右「**蓝图书架**」（`全部/装备/消耗品` chip ＋ `仅可造` ＋ 发丝线表：
  产物 / 工期 / 状态 / 起线）。排序沿用 core 单点 `sortManuRows`（书价走 `bookPriceOf`）。
- **造船厂**：左「**干船坞**」（舰船线稿 `ShipSprite` ＋ 骨架进度大条 ＋ 三格读数：材料 / 料值 / 工期 ＋ 取消）＋
  右「**可造舰船**」（舰级 chip `SHIP_TIER_SUBS` ＋ 表：舰船 / 料值 / 工期 / 状态 / 开工）。
- 两页签**不再内嵌任何 `.app-*` 卡片**（硬判据：`.hud` 页内 `.app-` 引用计数 = 0）。

**批 2 · 技能体检修正**

- 配方卡/队列卡等**可点件改真 `<button>`**（`aria-pressed` 表达选中态）＋ 新增 `:focus-visible` 焦点环；
- 页签补齐 `aria-controls` ↔ `role="tabpanel"` ＋ `id` 关系；
- 对比度：`--hud-fg-faint` 提到全主题 ≥4.5:1（改走实色，不再靠 alpha 压暗）；
  新增 `--hud-line-decor`（装饰发丝线，保持原样）与 `--hud-line-control`（控件边界，全主题 ≥3:1）；
- 空态补引导动作；Bullet 旁补文字读数（与 `title` 同源）；
- `prefers-reduced-motion` / `body.no-fx` 覆盖到本批新增的动效（骨架条呼吸、扫掠）。

## 4. 验证

- 闸门：typecheck 四台 · core 全量 · `content:check` · `l10n:check` · `l10n:render` · `ui:rot-check` ·
  `arch:guard` · `ui:theme-check`。
- 读数（无头 ＋ 网页版，**1340×900**）：① 四个页签各自"装得下不滚"（`.hud` 根不滚）
  ② `.hud .app-` 计数 = 0 ③ 改后 7 套主题对比度复测 ④ 页签/卡片的 role、aria、焦点可见。

## 5. 待裁决点

- 无（范围与画布 2026-09-30 已裁定）。归档时：本批结论并入 `docs/design/industry-console-design-20260930.md`
  （一号的设计案）＋ roadmap 一条。
