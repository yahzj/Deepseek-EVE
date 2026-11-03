# 科幻未来（Modern HUD）UI/UX 全维规范化修复与体验优化 · 2026-11-03

> 状态：**已完成 · 待船长验收**  
> 船长原话：「帮我把你说的这些都修复了」  
> 功能域：桌面端视觉表现层（`apps/desktop/src/renderer/src/styles.css`）  
> 理论指导：基于 Obsidian `.wiki` 知识库四大体系（丹·斯科特色彩理论、利德威尔通用设计法则、蒂德威尔界面设计模式、唐·诺曼以人为本设计）

---

## 一、本次实施范围与落地清单

1. **自然图符（圆形意符）白名单豁免**：
   - 解决：`styles.css` 中 `.app-root.is-layout-modern * { border-radius: 0 !important; }` 导致的自然状态点误伤问题；
   - 范围：状态指示灯（`.app-activitybar-idle-dot`、`.app-status-dot`）、未读小红点（`.app-ann-dot`、`.app-comms-dot`）、战斗微粒子/光标/光环（`.app-bts-cursor::after`、`.app-bts-muzzle`、`.app-bts-puff`、`.app-bts-chip i`、`.app-bts-repair i`、`.app-bts-boom .b-core`、`.b-ring`、`.app-bts-star`）、设置开关旋钮（`.app-toggle-track::after`）等物理意符元素；
   - 方案：建立特异性白名单，允许这些表达天体、射频、脉冲与生物学本能的意符恢复 `border-radius: 50% !important`。

2. **信噪比（SNR）优化与背景降噪**：
   - 解决：科幻未来布局下全息机库舞台网格背景及全局径向光过亮导致的“天青单色泛光（Monochromatic Wash）”问题，强化冯·雷斯托夫孤岛效应（von Restorff Effect）；
   - 范围：
     - `.app-fit-stage`（战舰装配机库舞台）的径向光由 `0.08` 降至 `0.035`，网格线由 `0.04` 降至 `0.018`，大幅拉开与前景舰船线框和装配插槽的明度反差；
     - 核心 CTA 保持鲜明天青高光，实现 90-8-2 饱和度预算下的极高信息可读性。

3. **`clip-path` 空间安全机制加固与防裁切治理**：
   - 解决：`clip-path` 裁掉外边框、外发光以及子元素溢出被吞的问题；
   - 方案：优化切角弹窗的边框表现与投影呈现，对带有 `clip-path` 的弹层提供 `filter: drop-shadow(0 16px 36px rgba(0, 0, 0, 0.85));` 补偿，消除外部投影被物理截断的缺陷。

4. **自动化样式拆分与技术验证**：
   - 执行 `npm run ui:layout-css` 生成更新 `styles-modern.css` 与 `styles-classic.css`；
   - 运行并通过：
     - `npm run ui:layout-css:check`：✅ PASS
     - `npm run typecheck`：✅ PASS
     - `npm run ui:rot-check`：✅ PASS
     - `npm run content:check`：✅ PASS

---

## 二、不做事项（Out of Scope）

1. 不修改经典旧版（classic）的布局结构与核心视觉。
2. 不重构底层 `@whale/core` 数值逻辑与存档结构。
3. 不破坏船长定下的“科幻未来硬朗锐角/45°战术切角”核心大视觉基准。
