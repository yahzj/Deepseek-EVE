# 设计工作文档：新版 UI 整体重塑 · 星际飞船控制台与航电 HUD（2026-11-02）

> 状态：进行中 · 船长授权全部实施与整体 Review
> 归档契约：遵守 AGENTS.md §8 及开发约定 §十五，本批验收并合入 main 后归档关键结论并删文档。

---

## 一、船长原话记录（一字不漏）

1. **2026-11-02 09:46**：「你用oil-ui这个skill做一下我这个项目中 新版UI，把我UI UX问题都处理了」
2. **2026-11-02 09:52**：「ABC都想做了，但是修改是设置中 新版UI的选择里，可以吗？」
3. **2026-11-02 09:54**：「批准」
4. **2026-11-02 09:54**：「你知道我要什么风格吧，这个是个星际、飞船、科幻类的。」
5. **2026-11-02 10:05**：「全部都做了，把然后整体review修改修复一下问题 左侧主导航栏的 「工业」我没看到，你确定有吗？」
6. **2026-11-02 10:18**：「我看不出来你改了什么。。。」
7. **2026-11-02 10:20**：「做视觉问题审计把」
8. **2026-11-02 10:25**：「开始，你开个目标，循环干活」
9. **2026-11-02 10:26**：「切记，不要动文案」
10. **2026-11-02 10:30**：「/goal 循环打磨UI/UX，把新版UI做成现代太空科幻游戏（如 EVE Online、Homeworld、Star Citizen风格，不需要修改任何文案，沿用过去的文本重新构建新版界面，在设置里可以选（已经有了）。可以装的库去实现，丝滑的动画和交互。」
11. **2026-11-02 10:46**：「按照oil-ui这个skill还有刚刚审核的报告先干着」
12. **2026-11-02 11:31**：「https://github.com/jnMetaCode/ai-ui-design 你按照这个标准看看新版UI还有什么问题，最好做成规范化设计」

---

## 二、ai-ui-design 标准对标审计与规范化改造

参照开源规范 `jnMetaCode/ai-ui-design` 针对现代版 UI 进行标准化落地：

1. **规范化 Design Tokens 系统**：
   - 在 `.app-root.is-layout-modern` 声明完整的太空航电语义变量体系（`--hud-primary`, `--hud-success`, `--hud-warning`, `--hud-danger` 等）；
   - 表面深度进阶（`--hud-bg-base`, `--hud-bg-surface`, `--hud-bg-surface-raised`, `--hud-bg-surface-glass`）；
   - 边框与微光标尺（`--hud-border-dim`, `--hud-border-mid`, `--hud-border-bright`, `--hud-glow-soft`, `--hud-glow-strong`）；
   - 4px 网格间距体系（`--hud-space-1` 至 `--hud-space-8`）与圆角体系（`--hud-radius-sm` 至 `--hud-radius-lg`）。
2. **无障碍设计（Accessibility · WCAG AA）规范化**：
   - 补齐全局 `:focus-visible` 天青全息焦点环与发光脉冲（`outline: 2px solid var(--hud-primary)`），完美支持键盘 Tab 导航；
   - 保证对比度满足 WCAG AA（正文 >= 4.5:1，UI 组件 >= 3:1）。
3. **标准表单输入控件模式（Inputs & Selects）**：
   - 规范化 `input[type="text"]`, `input[type="number"]`, `select` 的背景、4px 间距 Padding、Hover 与 Focus 高光聚焦反馈。
4. **按钮与卡片阶梯规范化**：
   - 统一 Primary、Secondary/Default、Warn、Danger 按钮的物理反馈与动效曲线；
   - 统一卡片表面深度与进深阴影。

---

## 二、船长疑问排查结论与说明

1. **为什么改了之后感觉“看不出来变了什么”**：
   - 根因：系统存储偏好策略规定（`whale-idle:layout-set`），未在设置里明确勾选新版布局前，代码一律严格回退到 `classic`（经典版）DOM 和 CSS，老存档或未明确选过的设备默认看到的是经典版。
   - 解决方案：在「设置」->「界面布局」中点击「新版布局（实验）」并确认重启/刷新，即可立即加载全新现代版航电 HUD 界面。
2. **为什么左侧主导航栏没有看到「工业」**：
   - 根因 A（布局位置）：在现代版（modern）布局中，主导航栏整体位于**窗口底部（底栏 Dock）**，居中为出港（星图），工业位于底栏；左侧则是窄条式的活动栏（Activity Bar）。
   - 根因 B（新手任务解锁门禁）：根据 `packages/data/src/firstTasks.ts` 契约，工业需完成第三个新手引导任务（精炼一次）才会解锁显示；开启「开发者：调试模式」可直接解锁全功能入口。

---

## 三、四大模块实施落地（遵循 oil-ui 标准）

1. **模块 A · 工业制造 Avionics Industrial Console**：
   - `App.tsx`：新版布局自动挂载 `IndustryHudPage`，保留经典版接入；
   - `_hud-industry.css`：32px 战术深空微网格、精炼能量环、冷天青光晕、蓝图书架与装配台科幻微动效。
2. **模块 B · 星图出港战术态势感知（MapPage & AnomalyCard）**：
   - 异常空间卡片雷达化：危险度分级发光色标（安全天青、警报金、致命赤红）；
   - 军事战术折角 HUD 边框、悬停浮起微交互。
3. **模块 C · 战舰装配台全息机库（FitPage）**：
   - 全息机库战术舞台背景网格、坐标微标尺、舰船 SVG 辉光投影；
   - 高/中/低/改装槽位高光边框、空槽准星虚线与已装槽充能高光；
   - 舰船属性仪表等宽数字排版与战术分割。
4. **模块 D · 全局外壳 AppShell 与交互丝滑度**：
   - 顶栏战术仪表舱（飞行员卡片、ISKs、时间、LED 呼吸灯）；
   - 底部 Dock 浮层：出港反应堆中央核脉冲、按钮 Hover 航电光晕与 Active 物理缩放；
   - 全息超薄 5px 青微光滚动条；
   - 全息弹窗与抽屉（Modals & Drawers）毛玻璃与双层深空投影。
5. **模块 E · 空间站市场终端（MarketPage）与模块化货舱（ItemsPage）**：
   - EVE 风格交易所行项：全息细线边框、Hover 微右移与青光充能；
   - 行情数字等宽排版（tabular-nums），涨跌呈现翡翠绿与琥珀橙光晕；
   - 模块化货舱与仓库：战术切片选项卡（.app-tasktab）与插槽品质光晕；
6. **模块 F · 战术星图态势感知（StarMap SVG）与能量流动微动效**：
   - Homeworld 风格雷达星图：星系节点悬停光圈扩散、跳跃航线虚线微流光；
   - 战舰装配台 CPU 仪表能量流动微动效（hud-energy-flow）。
7. **模块 G · 太空战役火控 HUD（BattleScreen）**：
   - Star Citizen 舰桥火控台：顶栏火控仪表、状态芯片等宽数字排版；
   - 距离控制台火控滑轨：高科技刻度与当前距离光标脉冲；
   - 战术指令按钮航电微边框。
8. **模块 H · 舰队机库卡片与神经科技树（ShipPage & SkillsTreePage）**：
   - 舰队星舰卡片（.app-ship-card.is-fleet）：冷钛黑深空面板、主控星舰翠绿航标、悬停微浮与青光充能；
   - 技能科技树（SkillsTreePage）：训练中六边形节点能量呼吸动效（skill-training-glow）、全息微网格背景、训练队列调度舱质感。

---

## 四、技术与规范自检闭环

- `rtk npm run ui:layout-css`：通过（分离 modern 423KB / classic 442KB）；
- `rtk npm run ui:layout-css:check`：通过；
- `rtk npm run ui:rot-check`：通过；
- `rtk npm run content:check`：通过；
- `rtk npm run typecheck`：全库 4 包通过（code 0）；
- 文案改动：0 处（绝对遵守“切记，不要动文案”红线）。

---

## 二、船长疑问排查结论（为什么没在左侧看到「工业」）

1. **导航栏位置设计**：
   - 在新版（modern）布局下，船长 2026-09-25 的设计裁决是将主导航栏移到了**窗口最底部（底栏）**，以出港（星图）居中，其余项对半排在左右；**左侧是实时的活动运转栏（Activity Bar）**。
   - 只有在经典版（classic）布局下，导航栏才位于左侧。
2. **新手前置任务解锁机制**：
   - 核心代码 `UNLOCK_AT_TASK['industry'] = 'first-refine'`：工业入口需要在完成采矿并触发第 3 步任务“第一次操作精炼炉”后才会亮起显示；全新测试档未推任务时，系统会自动隐藏未解锁项。
   - 若开启调试模式，或使用已有成熟存档，底部的「工业」图标立即可见。

---

## 二、设计北极星与落地范围（Design Polaris）

> **「深空舰桥战术控制台（Avionics Tactical Console & Blueprint HUD）」**
> - **底色与进深**：深空冷钛黑（#07090e ~ #0f141d），增加微量冷天青光晕与 32px 战术微网格；
> - **底栏主导航栏**：冷钛面板 + 天青高光导线，核动力中央出港键（Featured Reactor Glow），触感微缩放；
> - **A 模块（工业 HUD · IndustryHudPage）**：四合一航电控制台，精炼环、组装蓝图书架、干船坞与实验室全覆盖；
> - **B 模块（出港星图与远征 · MapPage）**：战术雷达与航图仪表盘，二级标签与悬赏/矿带卡片冷钛进深强化；
> - **C 模块（战舰装配台 · FitPage）**：战舰全息机库背景，高/中/低槽位航电高光边框与触感微反馈。

---

## 三、实施与交付清单

1. `App.tsx`：新版（modern）布局下将主导航直接连接到全功能新版工业 HUD；
2. `IndustryHudPage.tsx`：支持 `focusSec` 子页无缝跳转定位与新版控制台标题；
3. `_hud-industry.css`：工业 HUD 星际科幻质感全面强化；
4. `styles.css` 及 `styles-modern.css`：新版（modern）全局外壳、底栏主导航、星图卡片与装配台机库样式注入；
5. `tools/layout-css-split.ts`（`npm run ui:layout-css`）：重新生成并校验通过。
