# 通讯界面科幻未来 HUD 缺角风格统一改造 · 2026-11-02

> **状态**：**已落地**
> **船长原话**：「**非常好非常好，通讯界面背景还是有圆角的图案，这个要做成缺角的统一风格。我用红框标注出来了**」
> **范围**：
> 1. 表现层改造：通讯器右侧详情阅读区（机身外框、内嵌屏幕、头像徽章、通栏「前往」按键、分类小片）全面告别圆角，统一为科幻未来（Modern HUD）天青硬朗缺角。
> 2. 左侧列表配套：信件列表卡片（`.app-comms-item`）及分类标签（`.app-tasktab`）同步接入切角。
> 3. 双布局隔离：Classic 布局原样保留圆角复古掌机线框，Modern 布局精准接入战术切角与高科技刻度线，通过 CSS 语义化切换。
> 4. 不破坏 core 逻辑与既有文案契约。

## 一、诊断与重构方案

### 1. 诊断发现的存量圆角图案
- **机身外框（`CommsDeviceFrame`）**：SVG 采用 `<rect rx="5">` 绘制的大圆角矩形，在现代 HUD 环境下显得陈旧割裂。
- **内嵌屏幕（`.app-comms-screen`）**：带 `border-radius: var(--wui-sp-10)` 与围绕圆角的 `outline`。
- **发件方头像（`.app-comms-avatar`）**：带 `border-radius: var(--wui-sp-11)` 的 11px 大圆角框。
- **通栏「前往」按键（`.app-btn.app-comms-goto`）**：带 `border-radius: var(--wui-sp-22)` 的大胶囊半圆两端。
- **立场与类型小标签（`.app-comms-align`, `.app-comms-kind`）**：未脱离通用圆角 chip。

### 2. 现代 HUD 缺角（切角）重构
1. **机身外框（`CommsDeviceFrame`）**：
   - 保留 Classic 模式的复古圆角组 `<g className="app-comms-frame-classic">`。
   - 新增 Modern 模式的战术终端组 `<g className="app-comms-frame-modern">`，采用 `<polygon>` 绘制四角硬朗切角，并配有对角切角加固线与立体战术侧键。
2. **内嵌屏幕（`.app-comms-screen`）**：
   - 彻底清除 `border-radius` 与 `outline`。
   - 接入 `clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))` 对角 8px 微切角。
   - 接入深邃 HUD 半透材质与天青发光微边框。
3. **发件方头像（`.app-comms-avatar`）**：
   - 清除圆角，改为 6px 对角战术切角徽章盒子。
4. **通栏「前往」按键（`.app-btn.app-comms-goto`）**：
   - 清除胶囊圆弧，采用 8px 战术按键切角与 HUD 渐变色光感。
5. **小片与列表**：
   - 统一转为切角多边形，左侧信件条目选中有天青色垂直刻度亮条。

---

## 二、验证记录
- `npm run ui:layout-css` 及 `-- --check`：两份样式表与源码 100% 同步。
- `npm run ui:rot-check`：通过。
- `npm run typecheck`：通过。
- `npm run content:check`：通过。

