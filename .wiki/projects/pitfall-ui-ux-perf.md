---
id: pitfall-ui-ux-perf
title: UI/UX 与性能：踩坑与经验
category: projects
tags: [pitfall, ui]
summary: UI/UX 与性能踩坑：字号字体、主题令牌、盒模型布局、背景几何、刷新动画、提示可达（docs 蒸馏，非现行规则）
tier: core
source: docs-distill:pitfall-ui-ux-perf
confidence: extracted
created: 2026-11-04T10:43:20.925Z
updated: 2026-11-04T10:43:20.925Z
---

# UI/UX 与性能：踩坑与经验

> 本页是 docs 提炼的经验记录，非现行规则；与 AGENTS、docs 现行正文或代码冲突时，以它们为准。

## 结论先行
- UI 溢出的头号真凶常常不是宽度写错，而是**没有全局盒模型复位**：`width:100%` ＋ padding ＋ border 在 content-box 下天生多出 24~26px，本仓库已因此复发到第三处。
- 「进度条刷新太慢 / 抽搐」通常不是渲染慢：先查**数据心跳是否被写死 1Hz**，再查 CSS `transition` 时长与数据周期是否同量级，最后才看 React 重渲染。
- 字体问题的根因是**字形覆盖不到**：等宽栈不含汉字，中文就回落成新宋体；一屏出现三种字形时，改单个组件没用，得改字体栈单点。
- 场景视觉必须走**主题令牌**：写死 hex/rgba 字面量会让换主题时半明半暗，并让 `ui:theme-check` 的字面量闸门长期判红。
- 改布局要同时核三件事：**盒模型、`background` 简写是否重置了 `background-image`、`clip-path` 是否把投影与溢出子元素一起裁掉**；宽高比由宽度推算的 SVG（`width:100%; height:auto`）在超宽屏会按比例长高，把二级窗撑出纵向滚动条，要改成受可用高度约束的 flex 缩放。
- 视觉定位（坞景 / SVG 缩放）**禁止靠猜**：`transform-box` / `transform-origin` 一类"看起来该有用"的改法可能完全无效，必须无头实测 `getBoundingClientRect` ＋ 截图收敛。
- 提示里冒出 `{p1}` 或 `ui.MapPage.006` 这类内部串，是**错误模板缺参、或参数被当普通文本**，不是文案问题；`l10n:check` 全绿也证明不了这类路径没问题。
- 窄列（150px 量级）里做横排信息流，默认行为是**被 flex 挤成竖排竹简**，必须显式分层、给满宽行、给 `nowrap`；换布局 / 换端时，旧形态的尺寸假设（固定 px 宽、`aspect-ratio:1/1`、触控阈值）会全部失效，必须逐条重算并实机量。

## 1. 字号与字体：全站缩放为什么"看起来没生效"

### 坑：字号滑块拖到 150% 也几乎没变化
- **现象**：设置里调整「字体大小」，只有少数区块变大，其余 200+ 处文字纹丝不动；重启/刷新后还退回默认。
- **根因**（文档实测的三个叠加）：① 首版只让 6 个类（`.app-inv-*` / `.app-sr-*` / `.app-chip` / `.app-btn`）自己乘 `--ui-fs`，其余走字阶令牌的地方根本不缩放；② `--ui-fs` 只在**设置面板挂载时**写到 `.app-root`，启动不应用，而字阶令牌声明在 `:root`，解析不到 `.app-root` 上的变量；③ 修的时候若让调用点再乘一次，会和字阶自身缩放叠成平方。
- **解法 / 规避**：缩放基准收敛到字阶本身（`calc(Npx * var(--ui-fs, 1))`），调用点一律不自乘；`ui/uiScale.ts` 做读/写/钳制单点；启动在 `prebootRenderer()` 里就写 `<html>`，而不是等面板挂载。
- **复发检查点**：`rg -n "calc\([^)]*var\(--ui-fs" apps/desktop/src/renderer/src/styles.css` 查调用点自乘残留；字号 150% 冒烟必须同时验证「重启后保持」与「全站同比放大」。
- **来源**：`docs/design/settings-fixes-20261102.md:38-47`

### 坑：同一屏出现「雅黑 ＋ 等宽 ＋ 新宋体」三种字形
- **现象**：玩家报「项目 UI 上还有别的字体，应该是宋体什么的，全局字体应该统一」；同一屏中文观感不一致。
- **根因**：新 HUD 块里有 5 处裸 `font-family: monospace` 落在**中文元素**上（页签、任务页签、日志标题、战术按钮、舞台装饰）；`--wui-mono` / `--hud-mono` 只含 Cascadia Mono/Consolas/Courier New 等 Latin 等宽体，没有汉字字形 ⇒ 中文回落浏览器默认 NSimSun（新宋体）；另外正文还有 `body` 雅黑栈与 `html[data-locale='en'] body` 的 Segoe 栈两套。船长看到的"宋体"就是 NSimSun。
- **解法 / 规避**：新增全站唯一正文字体栈 `--wui-font`（中英同栈），`--wui-mono` 末尾补中文无衬线兜底；两处 body 都改引同一 token；裸 `monospace` 按元素性质分别改 `inherit`（中文）或 `var(--wui-mono)`（装饰性英文）。
- **复发检查点**：`rg -n "font-family:\s*monospace" apps/desktop/src/renderer/src/styles.css apps/desktop/src/renderer/src/ui/layout-css/`；用 CDP `CSS.getPlatformFontsForNode` 逐节点读真实渲染字体，搜 NSimSun/宋体命中数应为 0。
- **来源**：`docs/design/settings-fixes-20261102.md:161-187`

### 坑：数字列写死像素宽度，大额数值折行、行情跳字抖动
- **现象**：三层血条数值列、市场盘口单价在数值变大后折行；行情刷新时数字左右抖动。
- **根因**：`HpTri` 数值列写死 `flex: 0 0 26px`、市场盘口单价写死 `58px`，没有弹性安全容器；且未声明 `font-variant-numeric: tabular-nums`，非等宽数字每个字宽不同，刷新即抖。
- **解法 / 规避**：数值列改 `min-width: 32px; flex: 0 0 auto; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums`；表格列用 `minmax(64px, max-content)` 而非固定 px；所有实时读数绑定 `--wui-mono` ＋ `tabular-nums`。
- **复发检查点**：`rg -n "tabular-nums" apps/desktop/src/renderer/src/styles.css` 对照 `rg -n "flex:\s*0 0 \d+px"` 命中的数值列；把数值放大 2~3 个数量级做实机截图。
- **来源**：`docs/design/ui-ux-ergonomics-audit-20261103.md:25-34`

## 2. 主题、配色与视觉铁律

### 坑：392 处颜色字面量把界面钉死在深空
- **现象**：切到亮白 / 高对比 / 暖色 / 纯黑 / 色盲主题后，HUD 区块仍是天青＋近黑，出现"半明半暗、整体错色"；`ui:theme-check` 的字面量闸门长期红着。
- **根因**：一次视觉重塑把颜色直接写成 hex/rgba 字面量，绕过了主题令牌层；切换主题时只有令牌驱动的部分跟着变。
- **解法 / 规避**：补齐 HUD 语义令牌（`--wui-hud-primary` / `-hover` / `-active` / `-ok` / `-warn` / `-danger` / `-account` / 文本与表面若干档），**按全部主题各给一档（当时为六套）**，深空档逐值等同改造前（老玩家零变化）；所有字面量换 `rgb(var(--wui-hud-*) / α)`。转换时要连 `.app-root.is-layout-modern` 的别名一起改指向，别留两套并存。
- **复发检查点**：`npm run ui:theme-check`（字面量闸门 ＋ 键集一致 ＋ 对比度）、`npm run ui:tokens`；新增颜色先查 token，禁止在 `styles.css` 直接写 hex/rgba。
- **来源**：`docs/design/settings-fixes-20261102.md:50-58`；对比度口径见 `docs/design/ui-ux-20-rounds-audit-20261104.md:191-195,383`

### 坑：告警金 / 超载红被布局选择器的特异性压掉
- **现象**：CPU 计量条在告警与超载状态下颜色不变，一直是普通色，玩家看不出危险。
- **根因**：`.app-root.is-layout-modern .app-fit-cpustrip-track i` 的类特异性 `(0, 3, 1)` 压过了 `.app-fit-cpustrip-track.is-warn i` / `.is-full i`，状态色规则整条失效。
- **解法 / 规避**：给布局前缀那条规则加排除伪类（`:not(.is-warn):not(.is-full)`），或把状态选择器提升到与布局前缀同级再叠加状态类；核心原则是**状态色永远最高优先级**。
- **复发检查点**：`rg -n "is-layout-modern .*is-(warn|full|danger|ok)" apps/desktop/src/renderer/src/styles.css`；每个告警态实机截图核对，或在 DevTools 看 computed style 最终命中哪条规则。
- **来源**：`docs/design/ui-ux-ergonomics-audit-20261103.md:12-15`

### 坑：`border-radius: 0 !important` 把状态点、未读红点、开关旋钮一起削成方块
- **现象**：确立"科幻未来零圆角"铁律后，进度灯、未读小红点、战斗粒子/光标/光环、设置开关旋钮全部变方，物理意符失去辨识度；后续还发现圆角残留需要一个个清。
- **根因**：用 `.app-root.is-layout-modern * { border-radius: 0 !important; }` 这种全局通配一刀切，把"表达天体/射频/脉冲/生物本能"的圆形意符也当装饰裁掉。
- **解法 / 规避**：建立**特异性白名单**，只对状态指示灯、未读点、粒子/光标/光环、开关旋钮恢复 `border-radius: 50% !important`；真正要零圆角的是按钮、面板、弹窗、指标卡、下拉框，改用 `clip-path: polygon(...)` 做 45° 战术切角。
- **复发检查点**：`rg -n "border-radius:\s*0\s*!important" apps/desktop/src/renderer/src/styles.css`；新增圆形意符时确认白名单已覆盖，并跑 `npm run ui:layout-css:check`（改动要同步生成 modern/classic 两份派生物）。
- **来源**：`docs/design/ui-scifi-hud-refinement-20261103.md:12-15`；`docs/design/datadog-dashboard-ui-20261102.md:25,38-44`

## 3. 盒模型、宽度与窄列排版

### 坑：`width:100%` ＋ padding ＋ border 撑出 26px，制造队列卡顶出窗口
- **现象**：制造队列内的卡片宽度超出队列窗口，右侧被顶掉。
- **根因**：`.hud-card` 写 `width: 100%` ＋ `padding: 10px 12px` ＋ 1px 边框，而**仓库没有全局盒模型复位**（`styles.css` 里那条 `*{box-sizing}` 是顶栏局部的）⇒ 默认 `content-box` 下实际宽度 = 内容宽 ＋24 ＋2 = **溢出 26px**。这是同一坑的**第三处**（前两处：顶栏 `--app-max-w` 注释、`styles.css:2775` 训练项右侧顶到窗口）。
- **解法 / 规避**：给该组件补 `box-sizing: border-box`（一行），并在改动处写明这是同坑第 N 次；影响面要核清（当时 `.hud-card` 全仓只两处使用，只有写了 `width:100%` 的才受影响）。注意 `_hud-industry.css` 是直接 import 的源文件，改它不用重跑 `ui:layout-css`，但要跑 `ui:layout-css:check` 确认派生物仍一致。
- **复发检查点**：新增带 padding/border 的满宽卡片先问"有没有 `border-box`"；`rg -n "width:\s*100%" apps/desktop/src/renderer/src/ui/layout-css/*.css` 逐个对照盒模型；溢出判定用无头 Chrome 量 `getBoundingClientRect().right` 与父容器宽度。
- **来源**：`docs/design/hud-industry-filter-20261001.md:12-23`

### 坑：`min-width` 挂错列，动画槽只有 40px 却塞 56px 的 SVG
- **现象**：工业 HUD 书架把行首改成动画槽后，蓝图列表整体超出容器范围，长物品名把整表撑出面板。
- **根因**：`.hud-table td:first-child { min-width: 72px }` 原本是给"产物名"调的，行首变成槽后这条下限落到了**动画槽**上，真正该有下限的产物名列反而没有下限；同时槽只有 40px，里面的 SVG 是 56px 宽 ⇒ 槽内二次溢出。
- **解法 / 规避**：首列（状态灯）固定 26px，第二列（产物名）接管 72px 下限并允许词内断行；改完明确"哪个元素该有下限"再挂规则，不要沿用位置选择器。
- **复发检查点**：凡是 `td:first-child` / `:nth-child(1)` 的列宽规则，先在 DOM 快照里确认首列现在是什么；`rg -n "td:first-child" apps/desktop/src/renderer/src/ui/layout-css/`。
- **来源**：`docs/design/hud-industry-filter-20261001.md:50-55`

### 坑：150px 窄列把文字压成竖排竹简
- **现象**：左侧活动栏里技能名「导航学」、说明「训练至 Lv1 (当前 Lv0)」、时间与「移除」按钮被压成 1~2 字符宽的垂直折行，字像竹简一样竖着；船长连续三次追修「字体不缩小的情况下尽力横着放」。
- **根因**：窄列内 `.app-activitybar-item` 默认 row 且内部 flex 容器发生挤压；标题、副信息、进度条、时间全挤在同一个 `flex-wrap: wrap` 容器里 ⇒ 技能卡被切碎成 5 行。另有一处「计时中」标题在无计时项时仍渲染，视觉上把下一组当成它的子项。
- **解法 / 规避**：改成**分层垂直信息流**：行 1 图标＋标题（单行 ellipsis，原生 title 兜底）＋右侧微型操作键；行 2 说明独占满宽 `nowrap`；行 3 满宽进度条；行 4 底栏左右对齐百分比/剩余时间与操作键；空标题用条件包裹不渲染。
- **复发检查点**：窄列内禁止 `flex-wrap` 承载多段信息；改完在 150px/1366/375 三个宽度实机量每行 `scrollWidth <= clientWidth`；`rg -n "flex-wrap" app-activitybar` 相关样式。
- **来源**：`docs/design/ui-activitybar-and-bottom-nav-20261102.md:16-27,41-43`

## 4. 背景、几何与窗口形态

### 坑：`background` 简写把宇宙星图整层盖掉
- **现象**：切到「科幻未来」布局后，宇宙背景（星图）看不见了，只剩不透明深空底色。
- **根因**：`.app-root.is-layout-modern` 用 `background:` **简写**重写根背景——简写会把 `background-image` 一并重置，基础 `.app-root` 上的 `var(--space-bg)` 星图底被整层覆盖。
- **解法 / 规避**：改成显式分层：最底层 `var(--space-bg, none)`（512px 无缝平铺，逐层给 `repeat/position/size`）＋ 其上蒙层 ＋ HUD 微光/网格；不铺照片的浅色主题用更高特异性单独覆盖成浅色渐变。凡是"我要加个底色"的场景，优先用 `background-color` 或分层，别用简写。
- **复发检查点**：`rg -n "background:" apps/desktop/src/renderer/src/styles.css | rg "is-layout-modern"`，凡命中简写都要确认没有覆盖 `background-image`；各主题逐张截图核对星图可见性。
- **来源**：`docs/design/settings-fixes-20261102.md:60-65`

### 坑：太空坞舰船全甩到左上角原点，CSS 猜三轮无解
- **现象**：船长报「舰船的图形位置错误」「所有船图形都位于左上角的原点坐标」。坞框画对了，舰船偏移 **−176 / −94 px**。
- **根因**：坞景直接嵌 `ShipSpriteShape`，坐标系口径不对；后续三次尝试（改尺寸单点、CSS `transform-box/origin` 改 `view-box`/`0 0`、外层 `<g>` 变换＋子层反抵消）分别"方向错"、"**完全无变化**"、"抵消不干净（−57 / −39）"。
- **解法 / 规避**：用**嵌套 `<svg viewBox="-w/2 -h/2 w h">` 视口**把位置与缩放一次定死，不叠加 transform，收敛到 +14/+1 并由截图确认居中；残留 +14px 是舰形线条资产固有不对称，不是定位误差。取证做法：仓库内临时目录建最小 React 页 → `npx vite build` → Node 静态服务（**必须挂 harness 后台任务**，`Start-Job` 起的服务会随 pwsh 调用结束而死）→ 无头 Chrome（**必须 `--no-proxy-server`**，否则连不上 127.0.0.1）→ CDP 量 `getBoundingClientRect` ＋ 截图，探针/Chrome/服务 job 收尾全清。
- **复发检查点**：任何"图形跑到左上角"先怀疑坐标系口径而非尺寸；`transform-box` 类改法若无变化要立刻回退别留死规则；几何结论必须附实机截图或读数，不接受"看着应该对"。
- **来源**：`docs/design/hud-industry-filter-20261001.md:63-82`

### 坑：星图 `width:100% + height:auto`，超宽屏按比例长高撑出纵向滚动条
- **现象**：全屏时星图页出现滚动条；2560×1080 溢出 **188px**、3440×1440 溢出 **205px**（页面本身已是 `overflow:hidden`，滚的是二级窗）。
- **根因**：星图为 `<svg viewBox="0 0 700 300">` ＋ `width:100%; height:auto`，高度完全由宽度按 700:300 推出；窗口越宽星图越高，一旦"宽度推出的高度"超过面板可用高度，面板体（`overflow:auto`）就出滚动条。
- **解法 / 规避**：星图容器改列向 flex 且 `min-height:0`；`.app-starmap` 改 `flex:0 1 auto; min-height:200px; box-sizing:border-box`，装不下时 SVG 按 viewBox 居中等比缩小；保底 200px——极矮窗口宁可内滚也不压成一条线。顺带修掉 `width:100%` ＋ 1px 边框叠加造成的 2px 横向溢出。（历史档案，数值为当时读数）
- **复发检查点**：四档（1600×900 / 1920×1080 / 2560×1080 / 3440×1440）量面板体 `clientHeight == scrollHeight`；任何 `height:auto` 的 SVG 容器都要问"高度谁决定"。
- **来源**：`docs/archive/retired-docs-20261029/page-scroll-layout.md:55-80`（**历史档案**，引用前需核对代码现状）

### 坑：窗口化改成"嵌入主区"走了六环，最后战斗侧整体回滚
- **现象**：战斗观战从整屏 → 非全屏可最小化 → 覆盖主区 → 并入左上角小窗 → 取消悬浮嵌入主区 → 洞内战斗内嵌，六环迭代后船长下令回滚战斗侧，只有主控活动窗口留在 main。
- **根因**：窗口形态与「页面让位 / 四类自动收起 / 最小化还原 / 宿主容器」强耦合，是**一整套宿主机制**；单独取其中一环会缺依赖，所以只能整批封存。
- **解法 / 规避**：大改版式/窗体形态要留归档分支＋标签（`archive/window-embed-20260922`）与"按需取文件"的复活说明，而不是整分支合并；同批"顺带修好"的独立缺陷（血条短一截、按钮文案、错误提示居中、战报打得开）**回滚时绝不跟着删**。另有一个夹具坑：手造洞内战斗是无效夹具（视图按编队/威胁重建，单位对不上就抛错），且夹具放旧会被**离线结算**把瞬时态当场跑掉。
- **复发检查点**：回滚前先列"同批顺带修好、不随回滚走"清单并逐条验证；UI 取证夹具优先用引擎自己的入口造真实状态，加载时把存档时间戳改成"刚刚"。
- **来源**：`docs/design/archived-window-embed-20260922.md:14-23,69-90,92-103`（**历史档案**）

## 5. 刷新性能与动画衔接

### 坑：数据心跳被写死 1Hz，进度条"刷新率太慢"
- **现象**：玩家活动、技能训练、副 AI 活动三条进度条顿挫明显，倒计时一秒一跳。
- **根因**：`GameEngine` 常态挂机 `pumpMs` 是 500ms，但 `engine.ts:1506` 硬编码 `if (this.pendingMs >= 1000)` 才推进并 `notify()`；第 1 个 500ms tick 完全空转不推进也不通知 UI，真实刷新率被锁在 1Hz，墙钟抖动时甚至 1.5s 跳一次。
- **解法 / 规避**：切片门槛改成 `pendingMs >= this.pumpMs`，心跳调成 250ms（4Hz）；逻辑计算耗时 <0.1ms，CPU 占用可忽略。关键是**心跳门槛与心跳周期必须同源**，不要再写魔数。
- **复发检查点**：`rg -n "pendingMs >=" apps/desktop/src/renderer/src/game/engine.ts`；任何"数据一秒才变一次"先看 tick 门槛与 `pumpMs` 是否脱节。
- **来源**：`docs/design/activitybar-progress-smoothness-20261103.md:14-24,38-41`

### 坑：`transition: width 0.35s ease` 配 1000ms 数据周期 ⇒ 走 0.35s、停 0.65s
- **现象**：进度条呈"猛冲一下然后死停"的阶梯式抽动，不是匀速流动。
- **根因**：`ease` 是先快后慢的刹车缓动，350ms 就冲完并静止，剩下 650ms 完全不动；叠加 1Hz 数据周期，观感即"走 0.35s、停 0.65s"。另外短周期活动满 100% 结算时 `percent` 从 100 骤降为 0，`transition` 会**倒放**回退，形成非物理的反向动画。
- **解法 / 规避**：过渡改成与心跳同量级的 `0.25s linear`（匀速、下一拍无缝续接，GPU 合成器上恒定流动）；归零路径要加**瞬回保护**（`percent < prevPercent` 时临时禁用 transition），周期循环瞬间归零绝不倒放。
- **复发检查点**：`rg -n "transition:\s*width" apps/desktop/src/renderer/src/styles.css`，逐条核对过渡时长是否 ≈ 数据周期；任何会归零的进度条实机观察一次循环边界。
- **来源**：`docs/design/activitybar-progress-smoothness-20261103.md:26-32,43-48`

### 坑：活动栏订阅整份交易所状态，秒级全栏重渲染
- **现象**：行情每秒跳动时，整个左侧活动栏跟着重渲染，白白消耗性能。
- **根因**：状态订阅挂在 `ActivityBar` 顶层，任何行情 tick 都触发整栏重算。
- **解法 / 规避**：把订阅从活动栏剥离、下沉到真正消费它的微卡片组件内部，活动栏本身不再随行情重渲；同理"全页级 state 驱动局部微卡片"都该下沉。
- **复发检查点**：React DevTools Profiler 录制 5 秒，看行情跳动时活动栏是否 render；`rg -n "subscribe|useSyncExternalStore" apps/desktop/src/renderer/src/panels/ActivityBar.tsx`。
- **来源**：`docs/design/ui-ux-20-rounds-audit-20261104.md:170-174`

## 6. 提示、示能与窄端可达

### 坑：弹窗里冒出 `{p1}` 和 `ui.MapPage.006` 这类内部串
- **现象**：船长「在屏幕中间弹出的提示里看到类似代码的部分」，并回忆是 `ui.mappage.006`。
- **根因**（两条独立成因）：① core 返回的 `errorId` 指向需要 `{p1}` 的模板，但没给 `errorParams`，而 `cmdText()` 优先渲染 id ⇒ 完整正文被换成含占位符的文本（AST 扫描确认 31 处确定形态）；② `paramText` 只判断 `startsWith('core.')`，把合法 ui 域词条当普通文字覆盖原本完整的 `p1`，于是 `ui.MapPage.006` 原样上屏。注意 `l10n:check` / `l10n:params` 当时都是绿的——它们不查"基本 errorId 模板与同一返回参数的完整性"。
- **解法 / 规避**：补齐缺参（实测修 32 处）；错误结果类型允许携带参数；`p{n}Id` 显式指向的词条按唯一表取词，不用 `core.` 前缀猜合法性；未知 id/普通文本/缺键行为保持原有兜底，且**不删占位符掩盖缺参**。同时给 `l10n:params` 加基本错误字面量判据与真实指令→`cmdText` 中英回归。
- **复发检查点**：`rg -n "errorId" packages/core/src | rg -v "errorParams"` 人工核对；`npm run l10n:params`；任何 `{p` 上屏即视为缺参 bug，不当作文案问题。
- **来源**：`docs/design/item-filter-hint-audit-20261004.md:71-118,126-129`

### 坑：Tooltip 在鼠标移出瞬间闪断、贴边被视口裁掉
- **现象**：提示气泡在指针移出时立即消失、来回移动会闪烁；位于视口右侧/底部的提示被截断。
- **根因**：缺少离场过渡与几何钳制；首帧直接用未校正的原始坐标定位会跳一下。
- **解法 / 规避**：引入 `displayState` / `isLeaving` 两态，移出后保留约 140ms 平滑淡出，首帧精修真实坐标防跳跃；几何 Clamp 算法保证气泡不出视口；富内容（装配对比、物品情报）走 `hoverTipProps` / `HoverTip`，不再用 `data-tip` 拼接多行字符串。
- **复发检查点**：`npm run ui:tip-check`；四角与贴边各测一次；同元素只允许一种悬停机制（HTML 用 `title`、SVG 用 `data-tip`、富内容用 `HoverTip`），否则会原生与自绘双弹。
- **来源**：`docs/design/ui-ux-20-rounds-audit-20261104.md:365-368`；AGENTS §6 悬停统一走 `ui/Tooltip.tsx`

### 坑：看起来能点却点了没反应；微按钮实际高度不到 20px
- **现象**：左上角舰船小窗处在第一主视区，鼠标移上去有手型预期但点击毫无响应；微型按钮上下 padding 仅 2px、字号 11px，实际点击高度低于 20px，经常点不中。
- **根因**：小窗平态为纯展示（`disabled={!restore}`），没有示能也没有跳转；微按钮尺寸违背菲茨定律（目标越小、越靠边，命中时间越长）。
- **解法 / 规避**：平态给手型光标＋微发光并支持点击跳「舰船 / 装配」页，有最小化活动需要还原时保留还原优先级与呼吸灯；微按钮加 `min-height: 24px`，并用伪元素扩不可见触控外延热区——视觉仍紧凑，命中率提升。
- **复发检查点**：全站可点元素普查：`cursor`、hover 反馈、点击结果三者是否一致；`rg -n "app-btn.is-small" apps/desktop/src/renderer/src/styles.css` 核对 `min-height`；触控目标下限按 24px 量级验收。
- **来源**：`docs/design/ui-ux-ergonomics-audit-20261103.md:36-48`

### 坑：换布局 / 换端后，旧形态的尺寸假设全部失效
- **现象**：导航从左侧 168px 竖栏改到底栏后，活动栏里固定 `width: 200px` 的条目在 150px 窄列溢出；`.is-featured` 的 `width:100%` ＋ `aspect-ratio:1/1` 是为竖栏写的，横排底栏里完全不对；底栏占了约 96px 后一级页"不滚"红线又要重核。
- **根因**：旧形态的尺寸/比例是硬编码的，换壳时没人逐条重算；窄端还叠加旋转、软键盘、地址栏滞回等视口变量。
- **解法 / 规避**：换布局时列一张"旧写死尺寸清单"逐条改成弹性；窄端按现行外壳边界处理——视口按物理方向判、捏合冻结尺寸、软键盘缩高不误退旋转、输入框至少 16 CSS 像素（防 iOS 自动放大）、单指拖动用 8 物理像素阈值防拖后误切页；底栏占位后必须重新验证一级页无整页滚动条。
- **复发检查点**：`npm run ui:mobile-pages`（需先构建 web）及 `--nav-footer-only`；`rg -n "aspect-ratio|width:\s*\d{3}px" apps/desktop/src/renderer/src/styles.css` 在换壳后重扫；1366 / 600 / 375 三档＋窄横屏核验高度预算。
- **来源**：`docs/design/ui-shell-bottom-nav-20260925.md:8-10,63-66`；`docs/design/ui-ux-20-rounds-audit-20261104.md:379-381`

## 校验回归清单
- [ ] 改 `styles.css` 必跑 `npm run ui:layout-css` 再 `npm run ui:layout-css:check`（modern/classic 两份派生物与源码必须一致；改直接 import 的 `_hud-industry.css` 可跳过生成但要做 check）。
- [ ] `npm run ui:theme-check`：无裸色字面量、token 键集一致、各主题对比度达标（正文 ≥4.5:1，强调/图形 ≥3:1；另有 `npm run ui:contrast` 专项）。
- [ ] `npm run ui:tokens`：色板引用 100% 吻合；新增颜色先登记 token 再引用。
- [ ] `npm run ui:rot-check`：旋转坐标、`transform-box` 等口径、TDZ 闭包直读防线。
- [ ] `npm run ui:tip-check`：Tooltip 几何 Clamp 与防闪烁；富内容走 `HoverTip`。
- [ ] 盒模型普查：`rg -n "width:\s*100%" apps/desktop/src/renderer/src/ui/layout-css/*.css`，逐个确认父级或自身有 `border-box`。
- [ ] 数值排版普查：`rg -n "font-variant-numeric|tabular-nums" apps/desktop/src/renderer/src/styles.css`，所有实时读数必须覆盖。
- [ ] 刷新链路：`rg -n "pendingMs >=" apps/desktop/src/renderer/src/game/engine.ts`；`transition` 时长与心跳同量级。
- [ ] 几何取证：`npm run ui:actwin`；1600×900 / 1920×1080 / 2560×1080 / 3440×1440 四档量 `clientHeight == scrollHeight` 且无横向溢出。
- [ ] 窄端：`npm run ui:mobile-pages`（先 `npm run build`）；150px 活动栏 / 375px / 窄横屏三档逐行量 `scrollWidth`。
- [ ] 提示：`rg -n "errorId" packages/core/src` 对照同处 `errorParams`；`npm run l10n:params`；上屏文本搜 `{p1}` 与 `ui\.` 命中为 0。
- [ ] 字号：切 150% 后重启仍保持；`rg -n "calc\([^)]*var\(--ui-fs"` 无调用点自乘。

## 相关页
- [[pitfall-l10n-copy]]：`{p1}` / 内部 id 上屏的同族问题（本页只写 UI 显示视角）
- [[pitfall-combat-fleet]]：三层血条、战斗 HUD 数值排版与飘字层级
- [[pitfall-tooling-release]]：`ui:layout-css` 派生件与构建闸门
- [[pitfall-save-data]]：字体/布局/主题偏好是本机偏好而非存档字段
- [[human-centered-design]]：示能、反馈与差错（"能点却点了没反应"的理论侧）
- [[universal-principles-of-design]]：菲茨定律、冯·雷斯托夫效应（孤立高亮）
- [[verification-and-commit]]：检查矩阵与提交纪律

## Sources
- 设置 / 字体 / 主题 / 背景 / 星图字号：`docs/design/settings-fixes-20261102.md`
- 工效学（告警色覆盖、占用率心智、数值排版、微按钮、示能）：`docs/design/ui-ux-ergonomics-audit-20261103.md`
- 科幻 HUD 视觉（零圆角误伤、背景降噪、clip-path）：`docs/design/ui-scifi-hud-refinement-20261103.md`
- 看板式 UI 与 IA（装配上下文、底栏槽位、视觉铁律）：`docs/design/datadog-dashboard-ui-20261102.md`
- 工业 HUD 溢出与太空坞定位事故：`docs/design/hud-industry-filter-20261001.md`
- 活动栏进度刷新与平滑：`docs/design/activitybar-progress-smoothness-20261103.md`
- 活动栏竖排与底栏字号：`docs/design/ui-activitybar-and-bottom-nav-20261102.md`
- 全局 20 轮 UI/UX 审核（Tooltip、订阅下沉、响应式、对比度）：`docs/design/ui-ux-20-rounds-audit-20261104.md`
- 提示文本 / 占位符与内部 id 泄漏：`docs/design/item-filter-hint-audit-20261004.md`
- 外壳双布局与手机适配：`docs/design/ui-shell-bottom-nav-20260925.md`
- 设置子页面（弹窗高度稳定、切页回顶）：`docs/design/settings-subpages-20261103.md`
- 一级页不滚 ＋ 星图自适应（**历史档案**）：`docs/archive/retired-docs-20261029/page-scroll-layout.md`
- 窗口化 / 嵌入主区封存记录（**历史档案**）：`docs/design/archived-window-embed-20260922.md`
