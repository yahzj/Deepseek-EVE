# 工业 HUD · 工位窗口折叠 ＋ 工位行动图 ＋ 工位号下屏 ＋ 悬停卡铺到投料/组装机/造船厂（状态：进行中 · 2026-09-30）

> **状态**：进行中（代码已落 main，**待船长在本地构建上验收观感**）
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
- **悬停卡（1600 档实读 `.app-tip`）**：
  - 工位行：「**工位 03** · 辉云岩 · 贝塔 AI 核心 ｜ 输入 辉云岩 / 每批 100 件 / 手上 13,524,258 件 / 每批 27.9 秒 ｜ 输出 同位聚晶 ×138 · 钛钢合金 ×112 ｜ 本批进度 33%」
  - 投料行：「曦棱晶 ｜ 输入 曦棱晶 ×19,208,356 / 每批 100 件 / 手上 19,208,356 件 / 每批 40 秒 ｜ 输出 同位聚晶 ×142 · 银纹超金属 ×53」
  - 组装机行：「护盾增强器 MK1·高爆型 ｜ 输入 钛钢合金 ×175 · 手上 120,011,547 件 / 银纹超金属 ×54 · 手上 53,868,378 件 ｜ 输出 护盾增强器 MK1·高爆型 ｜ 齐备度 100%」
  - 造船厂行：「座头鲸级矿舰 ｜ 输入 4 味料逐行（需要 ×N · 手上 M）｜ 输出 座头鲸级矿舰 ｜ 齐备度 100%」
- 截图：`tools/_ui-artifacts/shots/hud-refine-{1280x860,1340x900,1440x900,1600x1000,1920x1080}.png`（最左列＝动图、行高 45px）。

闸门：`typecheck` ✅ · `content:check` ✅ · `l10n:check` ✅ · `l10n:params` ✅ · `ui:rot-check` ✅ ·
`ui:layout-css:check` ✅ · `arch:guard` ✅ · `npm run test -w @whale/core` ✅ · `build -w @whale/desktop` ✅。

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
