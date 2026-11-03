# 设计文档：UI/UX 工效学与视觉硬伤全面修复 (2026-11-03)

## 1. 状态与背景
- **状态**：开发中
- **船长原话**：「全部搞定，然后自动git提交」
- **来源**：基于 `.wiki/` 知识库（丹·斯科特《色彩理论指南》、利德威尔《通用设计法则》、诺曼《设计心理学》与 Refactoring UI / Better UI）全仓 UI/UX 审计出的 5 大高危体验硬伤。

---

## 2. 详细修复范围与设计清单

### 1. 修复 Modern 布局下 CPU 计量条告警色与超载色被强行覆盖的 Bug
- **位置**：`apps/desktop/src/renderer/src/styles.css` (约 14214 行)
- **原因**：`.app-root.is-layout-modern .app-fit-cpustrip-track i` 的类特异性 `(0, 3, 1)` 覆盖了 `.app-fit-cpustrip-track.is-warn i` 和 `.is-full i` 的规则，导致告警金与超载红失效。
- **修复**：增加排除伪类 `.app-root.is-layout-modern .app-fit-cpustrip-track:not(.is-warn):not(.is-full) i` 或提升告警状态选择器权重（`.app-root.is-layout-modern .app-fit-cpustrip-track.is-warn i`），确保告警色最高优先级。

### 2. CPU 计量条（CpuStrip）逻辑回归“占用率”正常心智
- **位置**：`apps/desktop/src/renderer/src/pages/FitPage.tsx`
- **原因**：原先以 `(total - used) / total` 剩余量为宽度，装得越多条越短，满载时条长归零，与人类“资源占用（Utilization Rate）”心智严重倒挂。
- **修复**：
  - 进度条宽度映射为已用百分比：`usedPct = Math.min(100, Math.max(0, (used / total) * 100))`；
  - 超载时（`rem < 0`）以 100% 满格闪烁超载深红；
  - 保留并清晰标注 `used / total` 及 `剩: rem`。

### 3. 战斗三层血条（HpTri）与市场盘口数值安全与等宽排版
- **位置**：
  - `apps/desktop/src/renderer/src/features/combat/battleViewCore.tsx`
  - `apps/desktop/src/renderer/src/styles.css`
- **原因**：
  - `HpTri` 数值列写死 `flex: 0 0 26px`，大额血量折行；
  - 市场盘口单价写死 `58px`，大额单价折行，且无 `tabular-nums` 导致数字跳变抖动。
- **修复**：
  - `HpTri` 当前数值由 `flex: 0 0 26px` 改为弹性安全容器：`min-width: 32px; flex: 0 0 auto; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;`；
  - 市场盘口 `.app-mkt-depth` 采用 `minmax(64px, max-content)` 并声明 `font-variant-numeric: tabular-nums`，数量与价格列右对齐。

### 4. 微型按钮（.app-btn.is-small）物理点击热区扩充
- **位置**：`apps/desktop/src/renderer/src/styles.css`
- **原因**：上下 padding 仅 2px，字体 11px，实际计算高度低于 20px，严重违背菲茨定律。
- **修复**：
  - 增加 `min-height: 24px;`；
  - 利用相对定位与伪元素增加不可见的触控外延热区，保持紧凑视觉外观同时大幅提升光标与触控命中率。

### 5. 左上角舰船小窗（ShipStatusWin）示能与交互打通
- **位置**：`apps/desktop/src/renderer/src/ui/ShipStatusWin.tsx`
- **原因**：处于第一主视区，平时处于纯展示态（`disabled={!restore}`），点击毫无响应，示能割裂。
- **修复**：
  - 平态下赋予小窗手型光标与微发光交互，支持点击快速跳转至「舰船」或「装配」页；
  - 当有最小化活动需要还原时，保留还原优先级与呼吸灯提示。

---

## 3. 验证闭环计划
- `npm run ui:layout-css` & `npm run ui:layout-css:check`
- `npm run typecheck`
- `npm run ui:rot-check`
- `npm run content:check`
- 相关单元测试。

