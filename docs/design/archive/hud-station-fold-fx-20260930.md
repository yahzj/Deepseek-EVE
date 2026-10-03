# 工业 HUD · 工位窗口折叠 ＋ 工位行动图 ＋ 工位号下屏 ＋ 悬停卡铺到投料/组装机/造船厂（状态：已实现并验收 · 2026-09-30）

> **状态**：已实现并验收（代码已落 main；观感验收按船长 2026-10-03 裁定视为完成）
> **船长原话（逐条照抄）**：
> ① 「**当屏幕过窄时，在工位窗口加个最小化的按钮，允许玩家将工位界面最小化成一个标题栏**」
> ② 「**之前在AI只会中心做的各种活动的SVG动图里，将精炼的动图应用到工位内。工作最左侧不要显示工位编号。**」
> ③ 「**鼠标悬停工位的悬浮窗，在投料窗口内也要有**」
> ④ 「**悬浮窗内，因为还需要应用到组装机和造船厂，所以请对左侧输入进行一定优化。**」
> **船长裁定（逐条照抄）**：「**投料没必要做，其他按你执行。**」（⇒ 折叠按钮：常显 · 不落盘 · 只做工位面板）
> ＋「**按你推荐来，动画不建议压缩，可以拉高行高。工位号挪进悬停。**」

## 一、范围 / 不做

- **做**：工位面板折叠（最小化成标题栏）· 工位表最左列换成**精炼/回收动图**（编号下屏）· 工位号移进悬停卡与「停炉」提示 ·
  悬停卡铺到**投料行 · 组装机书架行 · 造船厂可造舰船行**（左列做成**材料清单**形态，供多料蓝图复用）。
- **不做**：投料面板的折叠按钮（船长明令不做）· 实验室配方卡的悬停卡（船长未点名；卡片本身是"点选"控件，
  加悬停另需一轮审核）· 不动任何取数口径与结算。

## 二、技能判定（§九之八 三步：现状 → 技能 → 意见/风险）

**技能依据（`ui-ux-pro-max` 原文）**：
- UX · Animation · **Excessive Motion（High）**：「Animate **1-2 key elements per view maximum**」／「Don't: Animate everything that moves」
  ＋ **Continuous Animation（Medium）**：「Use for loading indicators only」／「Don't: Use for decorative elements」
  ⇒ **与船长②冲突**（他要 20+ 行逐行都动）。已把冲突摆给船长，船长裁定「动画不建议压缩」，故**照船长**，
  并按下面"风险与护栏"逐条兜住。
- UX · Accessibility · **Reduced Motion（High）**：「Check `prefers-reduced-motion` media query」⇒ 无动画偏好 / 关特效下**停帧保留静态线稿**。
- UX · Animation · **Cancellable State Transitions（High）**：「**set the final semantic state directly**」／
  「Don't depend on animationend or transitionend」⇒ 折叠**直接置位**（正文不渲染），不等过渡事件。
- UX · Accessibility · **Text Reflow and Spacing（Critical）**：「Don't clip text in fixed-width or fixed-height boxes」⇒ 标题栏不裁字。
- UX · Accessibility · **ARIA Labels**：「Add aria-label for icon-only buttons」⇒ 折叠按钮是真 `<button>` ＋
  `aria-label`（稳定名＝面板名）＋ `aria-expanded` ＋ `aria-controls`。
- UX · Tables · **Table Handling（Medium）**：「Don't: Wide tables breaking layout」⇒ 去掉编号列后少一列，更不容易顶出列外。

**技能与仓库规约的冲突**：图标域建议 Phosphor `caret-up` / `arrows-in`；**本仓 §六/§九 优先**（形状只许 SVG 线稿、符号走自有
`ui/Glyphs.tsx`）⇒ 自绘 `ico-fold` / `ico-unfold` 一对。

## 三、改动清单（逐个文件）

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/renderer/src/ui/hud.tsx` | 新增 **`HudHoverCard` ＋ `HudIoLine`**（悬浮卡骨架：标题 ＋ 左输入 / 右输出两列 ＋ 脚注；**左列是清单形态**——1..N 行材料，单料页只多传几行"规格行"）· `IconBtn` 补三个**可选**无障碍入参 `ariaLabel` / `ariaExpanded` / `ariaControls` |
| `apps/desktop/src/renderer/src/ui/aiWorkFx.tsx` | 新增 **`industryWorkKindOf(fx)`**：料是残骸 ⇒ `reclaim`、其余 ⇒ `refine`（**单点**，原先把这句话写死在 `ShipPage`） |
| `apps/desktop/src/renderer/src/pages/ShipPage.tsx` | `isReclaim` 改走上面那个单点（文案与动画共用一句判据） |
| `apps/desktop/src/renderer/src/ui/Glyphs.tsx` | 新增 `ico-fold` / `ico-unfold` 两枚线稿（同一家族：细描边 / currentColor / viewBox 24） |
| `apps/desktop/src/renderer/src/pages/IndustryHudPage.tsx` | ① 工位面板：标题行改 `.hud-panel-head`（标题 ＋ 右侧折叠按钮）＋ 正文包 `id="hud-station-body"`，折叠时**不渲染正文**；② 工位表**删 `#` 工位号列**，最左列改挂 `<AiWorkFx>`（判据走上面的单点）；③ 工位号进悬停卡标题（`ui.hud.143`）与「停炉」提示（`ui.hud.047` 改写）；④ 新增 `feedTip()`（投料行）、`shelfTip()`（书架行 ＋ 造船厂行）；⑤ `readinessOf` 抽出 `matRowsOf()`（材料清单行的**同一份取数**，悬浮卡左列直接用） |
| `apps/desktop/src/renderer/src/ui/layout-css/_hud-industry.css` | `.hud-panel-head`（flex 标题行）· `.hud-panel-title`（不换行不裁字）· `.hud-panel.is-folded`（不留标题下边距）· `.hud-fx-cell`（**固定 40×26 动画槽** ⇒ 行高不跳动）· `.hud-io-row.is-short`（缺料行弱化，缺什么另有文字）· `prefers-reduced-motion` / `body.no-fx` 下停帧 |
| `packages/core/src/industry.ts` | 导出 **`refineBaseParamsOf(def)`**（原私有 `refineParamsOf`，起炉与卡面共用）＋ 新增 **`recycleBatchM3Of(wreckItemId)`**（原先是 `startRecycleRun` 里的三元式，抽成单点） |
| `packages/core/src/index.ts` | 导出上面两个（渲染层只走包入口） |
| `packages/data/src/l10n/table.ts` | 新增 `ui.hud.141`（最小化提示）· `.142`（展开提示）· `.143`（工位 {p1}）· `.144`（手上 {p1} m³）· `.145`（每批 {p1} m³）· `.146`（保底原材料）· `.147`（工位动画，列名给读屏）；改写 `ui.hud.047`（停炉提示带工位号） |
| `tools/hud-geom.ts` | 新增：**折叠前后读数**（面板高 / `aria-expanded` / 正文在否 / 动图槽数 / 运行中动画数）＋ **帧率 3 次中位对照**（逐行动 vs `prefers-reduced-motion`）＋ **四张悬停卡抽查**（真发 `mouseMoved`，读 `.app-tip`） |

## 四、验证（读数，非观感结论）

`npm run ui:hud-geom`（本地构建 ＋ 无头 Chrome · 五档窗口 × 四页签，日志 `tools/_ui-artifacts/_hud-fold-fx-20260930.log`）：

- **折叠**：工位面板高 **1029 → 62px**（只剩标题行）· `aria-expanded` true→false · 正文**不在 DOM** ·
  动图槽 20→0 · 运行中动画 139→17 · 页内横滚 0 · 表溢出 0（五档窗口一致）；
- **帧率（1600×1000 · 3 次取中位）**：**逐行动 57 fps**（55/57/60）vs **停动画 60 fps**（57/60/60）
  ⇒ 20 行动画的成本约 **3 fps**（都在 vsync 上限附近，无掉到卡顿区间）；
- **悬停卡（1600 档实读 `.app-tip`，**2026-09-30 船长报障后的复读**）**：
  - 工位行：「**工位 03** · 辉云岩 · 贝塔 AI 核心 ｜ 输入 辉云岩 / 每批 100 件 / **（可用：13,524,258 件）** / 每批 27.9 秒 ｜ 输出 同位聚晶 ×138 · 钛钢合金 ×112 ｜ 本批进度 31%」
  - 投料行：「曦棱晶 ｜ 输入 曦棱晶 / 每批 100 件 / **（可用：19,208,356 件）** / 每批 40 秒 ｜ 输出 同位聚晶 ×142 · 银纹超金属 ×53」
  - 组装机行：「护盾增强器 MK1·高爆型 ｜ 输入 钛钢合金 ×175 / （可用：120,011,547 件）/ 银纹超金属 ×54 / （可用：53,868,378 件）｜ 输出 … ｜ 齐备度 100%」
  - 造船厂行：「座头鲸级矿舰 ｜ 输入 4 味料**逐味两行**（×需要量 ＋（可用：M 件））｜ 输出 座头鲸级矿舰 ｜ 齐备度 100%」
- 截图：`tools/_ui-artifacts/shots/hud-refine-{1280x860,1340x900,1440x900,1600x1000,1920x1080}.png`（最左列＝动图、行高 45px）。

### 四之二、船长复审后的两处修正（2026-09-30 同日）

**船长原话**：「**悬浮窗宽度有些太窄，导致数字被截断自动换行。建议'手上XXXX件'另外起一行，修改为（仓库：XXXX），
且精炼炉的投料悬浮窗有BUG，输入直接乘仓库内数量。**」

| 问题 | 处置 |
|---|---|
| **投料卡"输入直接乘仓库内数量"（真 BUG）** | 材料行尾原先挂 `×拥有量`（看着像"这一炉要吃下全部库存"）⇒ **去掉**；输入列改为「料名 / 每批多少 / 可用多少 / 每批多久」 |
| **数字被折行截断** | 库存**另起一行**；多料卡（组装机/造船厂）改成**每味料两行**（需求行 ＋ 可用行）⇒ 每行都短，300px 内不再断字 |
| 标签用词 | 船长建议写「仓库：XXXX」，但那个数是 **`oreAvailable` = 货仓 ＋ 仓库合计**（旧工业页对同一口径用的是「**可用**」）⇒ 落成「**（可用：XXXX 件）**」并回报船长；要改成「仓库」是两个字的事 |
| 悬浮窗宽度 | `.app-tip` 的 **300px 上限是 §九 的硬口径**（`hoverTipProps` 不接受宽度参数）⇒ **不动宽度**，改的是"每行更短"；要加宽得先改 §九 |

## 五、已知取舍 / 待船长裁决

1. **动画密度**：技能明确反对"逐行都动"，船长裁定「不建议压缩」⇒ 照船长执行，护栏 = 只碰 `transform/opacity`（沿用既有
   `.app-aifx-*` 关键帧，**零新增关键帧**）· `memo` 子树不参与引擎 tick 重算 · 无动画偏好/关特效停帧 ·
   槽位定尺不跳动 · **帧率读数见四**。若日后工位数上限再涨（几十行以上），退路是"只让可见行播"（一个 IntersectionObserver）。
2. **行高**：动画槽 40×26 ⇒ 工位行高从 ~24px 涨到 **45px**（船长已同意"可以拉高行高"）；满 25 炉时表格约 900px，
   折叠按钮正是为此准备。
3. **残骸/货柜的悬停卡输出列**：引擎在**未起炉**时不给每批件数 ⇒ 残骸只列**保底原材料名**（件数的估算口径留在工业页回收卡）、
   货柜用**物品自己的说明**兜住产出列。起炉后的真值仍在工位卡里。
4. **工位号**：已从表格下屏，只出现在悬停卡标题与「停炉」提示里（船长裁定「工位号挪进悬停」）。
5. **未推送**（推送闸门：等船长验收）。

## 六、船长第三次报障：「默认宽度就进窄屏压缩模式」（同日）

**船长原话**：「**发现一个问题，默认的宽度下工业 HUD（调试）的精炼炉会直接进入窄屏的压缩模式，那个应该是过窄时才触发。**」

### 6.1 两处处置

1. **顶栏/页签不再"折字"**（"压缩"最显眼的一处）：`.hud-top` 允许整体换行（`flex-wrap` ＋ `row-gap`），
   而 `.hud-title` / `.hud-tab` / `.hud-readouts` **一律 `nowrap`** —— 装不下就让整块掉到下一行，
   不再把「精炼炉」折成「精炼 / 炉」、「工业 HUD（调试）」折成两行。
2. **折列断点 1500 → 实测门槛 1440**，并把两处下限各收一档（顺带把门槛又往下压了一点）：
   `td:first-child` 96 → **72px** · `td.act` 40 → **32px** · 工位表资源列 96 → **72px** · 进度列 64 → **44px** ·
   窄档（≤1500）`.hud-body` 内边距与 `.hud-grid` 间距各收一档（多让出约 20px）。

### 6.2 门槛是怎么量出来的（读数，不猜）

`tools/hud-geom.ts` 新增**逐列最小宽拆解**（把表的克隆放进 `width: min-content` 的离屏盒子量）：

- **工位表最小 366px**（逐列 `46 / 84 / 53 / 35 / 56 / 42 / 50`）＋ 面板内边距 32 ⇒ **左列需 398px**；
- **投料表最小 307px**（逐列 `127 / 80 / 50 / 50`；资源名列的 127 是"图标 ＋ 名 ＋ 档位 chip（nowrap）"顶的）
  ＋ 面板内边距 32 ⇒ **右列需 339px**；
- 两列 ＋ 间距 12px ⇒ 网格需 **749px** ⇒ `.hud-body` 需 ≈785px ⇒ **视口 ≈ 1440px**（实测 1440 干净、
  1400 右表仍越出 9px）。

**最终读数**（日志 `tools/_ui-artifacts/_hud-final-20260930.log`）：1280 / 1400 / 1440 单列且**四页签全部
`✅ 全在列内`＋页内横滚 0**；1460 / 1600 两栏 60:40（521:348 / 595:396）同样全绿。

### 6.3 已知限制（待船长裁决，三条都已摆出）

**默认窗口 1280×860 的页面区实测只有 719px，比两栏所需的 ~785px 少 66px ⇒ 这个宽度下两栏装不下**
（内容不裁、不横向滚的前提下）。要在默认宽度也看到两栏，可选：

- **甲（船长已选，✅ 已落码）**：把默认窗口开大 —— `apps/desktop/src/main/index.ts` 的 `width/height`
  从 **1280×860 → 1540×940**（并按**显示器工作区**收口：小屏自动退到放得下的尺寸，窄了就是单列，
  那本来就是设计行为）。取 1540 而不是 1440 的原因：1440 外框的渲染区约 1424px，正好卡在折列门槛上，
  右列只拿到 340px（需要 339px，1px 余量）；1540 ⇒ 渲染区约 1524px ⇒ 页面区约 963px ⇒ 网格 927px ⇒
  左 556 / 右 370px，留出约 30px 余量。`minWidth/minHeight` 仍是 1024×700（窄到那儿就单列）；
- **乙**：窄档**自动收起右侧事件日志坞**（复用既有「收起」能力，页面区从 719px 涨到 ~1040px ⇒ 1280 也能两栏，
  零内容取舍；代价是外壳级行为改动，影响所有页）；
- **丙**：窄档允许**面板内横向滚动**（技能 `Table Handling` 的推荐处置），断点可降到 ~1150；
- **丁**：窄档**收内容**（投料表隐藏档位 chip ＋ 收紧动作列内边距）——能再挤出约 78px，但会少一项可见信息。

⚠ 乙/丙/丁都要改已定的口径（外壳行为 / 表格呈现 / 内容），按 §5.2 先摆给船长；本次只落**甲**。

## 七、同批：悬停卡限宽 300 → 380px（船长令）

**船长原话**：「**悬浮窗建议加宽50~100px**」（继"数字被截断自动换行"与"库存另起一行"之后的第三步）。

- 取 **+80px**（落在船长给的 50~100 区间）：`styles.css` 的 `.app-tip { max-width }` **300 → 380px**、
  旋转模式档 `min(340px, 92%)` → `min(420px, 92%)`；`ui/Tooltip.tsx` 的 **`TIP_W` 300 → 380**（两处必须同步，
  它驱动"右边放不下就翻到左边"的定位）。
- **规则档已同步**：`docs/development-conventions.md` §九 的「限宽 300px」改成 380px（并订正同一条里过期的
  「悬停 200ms」→ 停驻 `TIP_DELAY_MS` ＝ 500ms）；changelog 顶部记了一条。
- 技能依据（§九之八）：UX「Text Reflow（Critical）：Don't clip text in fixed-width or fixed-height boxes」·
  「Essential Text Truncation（Critical）」·「Container Width：limit max-width for text content」——三条都指向放宽，无冲突。
- 读数（`tools/hud-geom.ts` 新增"盒宽 ＋ 横溢"）：四张卡 **横溢全部 0**、盒宽 298 / 298 / 358 / 319px
  （`max-width` 是上限不是定宽 ⇒ 短卡不会被拉宽），组装机卡从被 300px 截住变为 358px 自然展开。
