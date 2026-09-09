# 出港三页排序下拉（状态：已确认，2026-09-09 船长拍板；二号实现）

> 2026-09-09 船长拍板（前会话记录于 handoff-20260909-activitybar-progress.md 任务 A），
> 二号(继承会话)实现。纯 renderer 改动：core 零改动、存档零改动。

## 1. 悬赏（BountyPanel · Expedition.tsx）
- TaskSort 键集：`'default' | 'distance' | 'galaxy' | 'reward' | 'standing'` →
  **`'danger' | 'distance' | 'galaxy' | 'reward' | 'standing'`**（删 `'default'`）；
- 选项文案：危险（安全优先）/ 距离最近 / 星系名称 / 奖励最高 / 声望收益最高
  （「默认（可接取优先 · 名称）」退役——可接取冒泡排序删除）；
- 默认与旧存兼容：无选择或本地旧存 `'default'` → 按新默认 **`'danger'`** 读取；
- `'danger'` 语义 = 目标星系安全等级 `security` 降序 = **安全在前**（次级按名称）；
- 存储键不变：`whale-idle:task-sort`；页头右侧提示文案改「默认：危险（安全优先）」。

## 2. 矿带（MiningTab · MapPage.tsx）
- 新增排序下拉，选项：危险（安全优先）/ 星系名称 / 矿石价值最高 / 矿带名称；
- `'danger'` = 矿带所在星系 `security` 降序（无星系归属的母港矿带按安全 1.0）；
- `'value'` = 矿石价值 = 每小时产出估价（与矿带卡内效率行同口径：
  `belt.outputs` 加权 × `items.baseSellPriceIsk`，含当前驾驶船采矿参数）；
- 默认 `'danger'`；存储键 `whale-idle:mine-sort`。

## 3. 打捞（SalvageTab · MapPage.tsx）
- 新增排序下拉，选项：危险（安全优先）/ 星系名称 / 残骸密度最高 / 名称；
  原「硬排残骸密度降序」退役（作为「残骸密度最高」选项保留可选）；
- `'danger'` = 星系 `security` 降序（安全在前）；`'density'` = 密度降序；
  行实体为星系，故「星系名称」与「名称」目前同效（待船长验收时确认是否精简其一）；
- 默认 `'danger'`；存储键 `whale-idle:salvage-sort`。

## 涉及 / 验证
- renderer：Expedition.tsx、MapPage.tsx；样式复用既有 `.app-task-sortrow + .app-select`（无新增 CSS）；
- 验证：typecheck ×4 + desktop build 绿；core 无改动不重跑全量（行为只涉排序视图与本地存储）。
