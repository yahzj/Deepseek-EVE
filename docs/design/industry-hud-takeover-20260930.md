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

## 6. 第二批（同日追令：真值修正 ＋ 三处报障 ＋ 版式/图形重做 ＋ UI 审核机制）

**船长原话（照抄）**：「**按照真实数值修正。而且我发现工位那边资源图标是错误的，以及除了原工业界面的卡牌上的进度条外，
其他地方的进度条都是瞬间涨幅的。新增UI审核，当我提出一处UI修改时，你需要用skill进行判断，并对我提出的UI给出意见。**
比如说，我现在希望将有产出和那个的窗口挪到左侧顶部。并给圆环添加动画，按照当前所有精炼炉产出各个资源的占比，
将其分配到圆环上并染色，玩家鼠标移动上去时，显示该资源产量。玩家将鼠标移动到某一个生产项时，出现一个悬浮窗口。
悬浮窗口内分成两列，左侧这列为输入资源（原料），右侧为输出资源（产出）。」
＋ 追加报障：「**精炼炉没有筛选，也不显示残骸和货柜**」
＋ 三问裁定：**占比口径 = 产值/h** · **版式 = 左「产出读数块（上）＋工位表（下）」，右「投料 ＋ 资源构成表」** ·
**进度条 = 本批修 HUD 页（scaleX）＋ 全仓 5 处补过渡**。

**技能判定（先判后做，依据见 §九之八 新规）**：Part-to-Whole（≤5 类 · 差异<5% 别用 · 必须标注 · 不能只靠颜色 ·
Accessibility Risk: high）· Hover vs Tap（High：重要动作不能只放悬停）· Transform Performance（动 transform/opacity，
别动 width/height）· Reduced Motion · Empty States / Search No Results（空结果要给下一步建议）·
Compact Control Semantics（Critical：可点件必须真控件）。**未命中一条**：技能里没有"KPI 该摆哪一角"的条目 —— 如实标注。

### 6.1 真值修正（三处页面自造刻度 → 引擎真值）
| # | 位置 | 改前 | 改后 |
|---|---|---|---|
| A | 顶栏「在跑工位」 | `n/6`（写死） | `n/(aiCoreCap+industryAiBonus)`（该档实测 **13/20**） |
| B | 环旁「满产基准」 | `rate×120%`（该档 **184%**，超过真实满级） | 拆成真实两行：**基础倍率 120%** · **满级倍率 170%**（`refineRateMax(ctx)` 现算）＋ 当前倍率 |
| C | 精炼「产出区间」Bullet | `rate×72`、刻度死钉 86%（该档条恒满、目标恒被超过） | 换成**倍率区间条**：区间 = 基础→满级、刻度 = 当前值、两端有文字（技能：无目标区间就别用 Bullet） |
| D | 实验室「效率」Bullet | `outputUnits/12`、目标钉 92% | 区间 = **同产物各配方的实际件/分区间**、目标刻度 = 该产物最优、下方三处文字读数 |

**core 侧新增两个单点**（渲染层不许自己乘）：`refineRateMax(ctx)`（满技能倍率上限）·
`refineBatchOutputOf(state, ctx, def, perBatchUnits)`（**一批产出的唯一实现**，`advanceRefining` 的结算
改调它 ⇒ 悬停卡与结算逐字同源）。

### 6.2 三处报障
1. **工位资源图标错**：原先挂的是**劳动者**图标（`nav-ship`/`ai-core`）⇒ 改挂**资源自身**的类别图标
   （`RowGlyph(def.kind)`），并**新增「劳动者」列**（图标＋主控/核心名）。
2. **进度条瞬跳**：HUD 页原 `width` 无过渡 ⇒ 改**技能口径的 `transform: scaleX(var(--v)/100)` ＋ 0.35s ease**；
   全仓另外 4 处（`.app-activitybar-fill` · `.app-act-bar` · `.app-dur-fill` · `.app-skill-card-bar i`）
   原先都没有过渡 ⇒ 统一补 `width .35s ease`（**与原工业卡牌同参数**），并在 `prefers-reduced-motion` 下退化为瞬时。
3. **精炼炉没有筛选、不显示残骸与货柜**：投料面板原先只筛 `refine` 配方 ⇒ 补**一级 4 档**
   （全部 / 可精炼资源 / 残骸回收 / 货柜拆解，复用现有 id）＋ **二级**（资源大类 / 残骸档位）＋ **搜索框**；
   起炉按 `def.kind` 分走 `startRefineRunAt` / `startRecycleRunAt` / `startUnboxRunAt`；空结果给"换个档 / 去星图"的引导。

### 6.3 船长提的版式与图形（技能判定 = 支持，附护栏）
- **产出读数块挪到左侧顶部** ⇒ 左列 = 读数块（上）＋ 工位表（下），右列 = 投料 ＋ **资源构成表**（右列原本只有投料，会空）。
- **圆环按各资源占比分段染色 ＋ 悬停显示该资源产量** ⇒ 重新实现为 **SVG 多段环**（每段一条 `<circle>` 的
  dash 片段、每段 `data-tip`、`stroke-dasharray/offset` 过渡）：同时解决"多段染色 / 分段悬停 / 动画"，
  并回到「**形状只允许用 SVG 画**」的合规线（原先那个环是 CSS `conic-gradient` 画的）。
  护栏：**只用前 5 名 ＋「其他」**、**环旁同名同值的文字构成表**（技能要求的非颜色回退）、`aria-label` 逐段念占比、
  `prefers-reduced-motion`/关特效下不动画。占比口径 = **产值/h**（船长 2026-09-30 选定）。
- **生产项悬停出「左输入 / 右输出」两列卡** ⇒ 走全站 `hoverTipProps`（桌面悬停、手机点按即看；不叠加 `title`），
  左列 = 投料（每批件数 / 手上件数 / 每批秒数），右列 = 该批产出逐矿物（`refineBatchOutputOf`）＋ 本批进度。

### 6.4 新增 UI 审核机制（船长令 → 已写进规约）
`docs/development-conventions.md` **新增 §九之八**：船长每提一处 UI 修改 ⇒ 先用 `ui-ux-pro-max` 判一次 ⇒
回话给**技能依据（引原文）＋我的意见＋风险与护栏** ⇒ 再按 §二 走设计总结与确认；反向（我自己的 UI 提议）同样适用。
`development-conventions-changelog.md` 顶部已记账。

### 6.5 第二批验证（读数）
闸门：typecheck 四包 ✅ · core 274 文件 / 2885 用例 ✅ · content:check ✅（陈旧术语契约当场抓到「矿石」→「投料」）·
l10n:check ✅ · ui:rot-check ✅ · ui:layout-css:check ✅ · build ✅（桌面与网页版）。
**界面读数**（无头 ＋ 网页版 · 视口 1340×900 · 日志 `tools/_refine-readings-20260930.log`）：11/11 全绿 ——
环 6 段（5 资源 ＋「其他」）每段带 `data-tip`、`aria-label` 逐段念占比、过渡挂在 `stroke-dasharray`；
构成表行数 = 分段数；工位资源列挂的是资源图标（无船/核心图标）；劳动者列有值；投料有一级 4 档＋搜索框
（表内 72 行含残骸与货柜）；顶栏 **13/20**；基础/满级/当前三行齐；HUD 进度条 `transform: matrix(0.66…)` ＋
`transition: transform 0.35s`；全仓 4 处补过渡实测 `width 0.35s`；悬停卡两列
（输入「曦棱晶 · 每批 100 件 · 手上 4,642,749 件 · 每批 32.1 秒」｜输出「同位聚晶×137 · 银纹超金属×51」）。
截图：`tools/_ui-artifacts/shots/hud-refine.png` · `hud-refine-hover.png`。
