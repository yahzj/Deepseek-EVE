# 深空数据看板与复杂后台监控大屏（DataDog / Mixpanel 风格）三轮 UX 审查与全量修复落地记录（2026-11-02）

> 状态：待验收（2026-11-02 施工完成，待船长集中验收）
> 
> 依据与船长原话（照抄）：
  > 1. 「在我们这个修改的基础上 我们还是需要把UI改成 數據看板 / 複雜後台風：類似 DataDog、Mixpanel。強調在有限空間內，如何優雅、清晰地呈現大量圖表和數據表格。这个很重要，因为这个游戏就是大量的这些内容构成。」
  > 2. 「工业制造监控大屏（产线与物料流） 和 战舰装配台（装配数据与功耗抗性） 这个是什么？」
  > 3. 「这红框里的每一个界面都可以做啊」
  > 4. 「开工喵」
  > 5. 「继续」
  > 6. 「/goal 你是顶尖的UX设计师和UX设计师，你接下来会开子代理审核项目的UI UX问题，不修改任何文本的情况下根据文本之间的逻辑等去判断UI、UX的关系。你会开启7轮的审核，每轮一次，不可以并行审核。」
  > 7. 「开起三轮就好了，然后把发现的问题全修了」
  > 8. 「设置里的选项显示名称 科幻未来。克制耐看型吧」
  > 9. 「可以非常好，但是你发现了吗，还是有很多圆角的元素喔，这个科幻未来不能有圆角的任何UI元素。然后在设置中，我截图中的，那个新版（测试中）的选项里的风格可以全部用科幻未来替换了，然后科幻未来的选项就可以去掉」
  > 10. 「你把原来的设计弄没了，这个缺角的按钮们我很喜欢你怎么去掉了」

---

## 一、三轮串行深度 UX 审核发现的问题清单与修复对照

| 审查轮次 | 审核领域 | 定位的核心体验断点与设计缺陷 | 落地修复与系统实现方案 |
| :--- | :--- | :--- | :--- |
| **第 1 轮** | **IA 拓扑与底栏路由** | 1. 玩家在装配台配副船，切去市场/仓库买配件再返回装配台时，副船配装上下文被直接擦除（强制回退到旗舰）。<br>2. 随游戏进程解锁工业/市场等功能时，底栏出港核心按钮位置发生跳跃瞬移。 | 1. 在 `App.tsx` 中移除了切页强制 `setFitShipId(null)` 的逻辑，建立了会话级装配目标舰船记忆。<br>2. 在 `AppShell.tsx` 中使用 `LEFT_KEYS` 进行固定槽位化分栏，消除出港按钮的跳跃。 |
| **第 2 轮** | **战舰与装配数据流** | 1. 装配台只有离散参数，缺少全舰名义总输出（DPS）与综合等效生存（EHP）读数，配装强弱无法一眼评估。<br>2. 闲置副船无法在装配台直接切换，换船配装必须退回舰队列表。<br>3. 多艘同型船（如两艘“鲜鱼级护卫舰”）无区分度，极易改错船。 | 1. 在 `FitPage.tsx` 注入 DataDog 风格双卡条：精确计算舰载主炮/导弹/激光火力 + 无人机群 DPS，以及护盾/装甲/结构三层全抗综合折算 EHP。<br>2. 目标船升级为受控切换，顶部提供战术换船下拉框（`<select>`），就地切换。<br>3. 在 `ShipPage.tsx` 舰队卡片与装配台注入唯一实例呼号（`#XXXX`，如 `#9F4A`）。 |
| **第 3 轮** | **工业与物流供应链** | 1. 「弹药与修理组件取料来源（母港仓库直供 / 舰船货仓）」深埋在系统设置内，配装台看到弹药不足时无从知晓当前来源。<br>2. 现代模式下各组件（输入框、弹窗、设置面板等）存在圆角残留，且缺失船长钟爱的 45° 战术切角。 | 1. 在 `FitPage.tsx` 弹药预载区（`AmmoTierSection`）直接读写 `engine.state.resupplyFromWarehouse`，提供快捷切换微标。<br>2. 确立 `border-radius: 0 !important;` 零圆角铁律，全面引入 `clip-path: polygon(...)` 45° 战术切角与天青航电微光。 |

---

## 二、核心落地与架构细节

### 1. 设置界面选项重塑（科幻未来 vs 旧版）
- **文件**：[`apps/desktop/src/renderer/src/panels/appSettings.tsx`](file:///d:/Documents/GitHub/Deepseek-EVE/apps/desktop/src/renderer/src/panels/appSettings.tsx#L324-L352)、[`apps/desktop/src/renderer/src/ui/layoutPreference.ts`](file:///d:/Documents/GitHub/Deepseek-EVE/apps/desktop/src/renderer/src/ui/layoutPreference.ts#L1-L16)
- **行为**：
  - 彻底将原「新版（测试中）」升级更名为「**科幻未来**」，移除了多余的独立选项；
  - 仅保留【**科幻未来**】（内部 `modern` 引擎与样式）与【**旧版**】（内部 `classic`）双选项；
  - 本地偏好读取兼容历史存盘，统一归拢至 `modern`，避免状态分叉。

### 2. 视觉基调铁律：纯硬朗零圆角 + 45° 战术缺角
- **文件**：[`apps/desktop/src/renderer/src/styles.css`](file:///d:/Documents/GitHub/Deepseek-EVE/apps/desktop/src/renderer/src/styles.css#L14200-L14730)
- **行为**：
  - `.app-root.is-layout-modern *` 强制 `border-radius: 0 !important;`；
  - 按钮（`.app-btn`）、面板（`.wui-panel`）、弹窗（`.app-modal`）、指标卡（`.hud-kpi-card`、`.hud-fit-kpi`）、呼号微标（`.app-ship-callsign`）、下拉选框（`.app-fit-target-select`）全量采用 45° 战术切角；
  - 滑块输入控件移除圆形滑块，替换为硬朗战术方块；
  - 经典旧版（`classic`）100% 物理隔离，零样式污染。

### 3. 装配台 DataDog 核心双指标条与就地换船
- **文件**：[`apps/desktop/src/renderer/src/pages/FitPage.tsx`](file:///d:/Documents/GitHub/Deepseek-EVE/apps/desktop/src/renderer/src/pages/FitPage.tsx)
- **计算契约**：
  - **FIREPOWER 名义总输出**：
    - 舰载主炮/导弹/激光火力：遍历 `spec.weapons`（排除基础舰炮与无人机），单发伤害 × 门数 / 周期；
    - 无人机群火力：遍历 `spec.weapons` 中 `src === 'drone'` 的机群条目，单发伤害 × 数量 / 周期；
    - 名义总 DPS = 武器 DPS + 无人机 DPS；
  - **DEFENSE 综合等效生存（EHP）**：
    - 护盾 EHP = `spec.hp.s / Math.max(0.05, 1 - avgShieldRes)`；
    - 装甲 EHP = `spec.hp.a / Math.max(0.05, 1 - avgArmorRes)`；
    - 结构 EHP = `spec.hp.h / Math.max(0.05, 1 - avgHullRes)`；
    - 综合 EHP = 盾 EHP + 甲 EHP + 体 EHP；
  - **就地换船**：装配目标栏集成 `<select>` 控件，列出所有舰队舰船的名称、型号、呼号与在役状态，玩家可就地任意切换装配目标。

### 4. 战舰唯一实例呼号（Callsign Tag）
- **文件**：[`apps/desktop/src/renderer/src/pages/ShipPage.tsx`](file:///d:/Documents/GitHub/Deepseek-EVE/apps/desktop/src/renderer/src/pages/ShipPage.tsx#L874-L880)、[`apps/desktop/src/renderer/src/pages/FitPage.tsx`](file:///d:/Documents/GitHub/Deepseek-EVE/apps/desktop/src/renderer/src/pages/FitPage.tsx)
- **行为**：
  - 截取每艘船唯一实例 ID 后 4 位大写（`#` + `uid.slice(-4).toUpperCase()`，如 `#9F4A`）；
  - 以天青微光等宽标签形式挂载于舰船卡片与下拉选择框中，彻底消除同名同型船认知混淆。

### 5. 战备取料快捷微标
- **文件**：[`apps/desktop/src/renderer/src/pages/FitPage.tsx`](file:///d:/Documents/GitHub/Deepseek-EVE/apps/desktop/src/renderer/src/pages/FitPage.tsx#L1495-L1515)
- **行为**：
  - 在弹药预载区（`AmmoTierSection`）右侧增加补给来源切换按钮；
  - 一键切换 `engine.state.resupplyFromWarehouse`（从母港仓库直供 🌐 / 从舰船货仓取用 🚀），即时落盘并给出清晰 Toast 反馈。

---

## 三、门禁与自动化验证结果

本批所有修改均经过全量自动化回归体检：
1. `rtk npm run ui:layout-css:check`：✅ modern 与 classic 花括号差 0，双份样式与源码完全一致；
2. `rtk npm run typecheck`：✅ 4 个工作区（`@whale/core`、`@whale/data`、`@whale/ui`、`@whale/desktop`）0 TypeScript 错误；
3. `rtk npm run l10n:check`：✅ 6694 条本地化词条 1:1 严格对齐，未授权准备英文的条目（`ui.fitKpi.001~007`、`ui.fleetKpi.001~007`）已规范登记待译清单；
4. `rtk npm run ui:tokens`：✅ 色板 555 个 token、14507 处引用 100% 吻合；
5. `rtk npm run ui:rot-check`：✅ 覆盖层尺寸、TDZ 闭包引用、直读防线与同名属性体检全绿；
6. `rtk npm run content:check`：✅ 游戏数据与蓝图交叉引用完全闭合，无死物品；
7. `rtk npm run build`：✅ electron-vite 成功构建主进程、预加载脚本与渲染层产物。
