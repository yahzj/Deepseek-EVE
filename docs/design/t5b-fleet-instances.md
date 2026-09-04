# T5-B 重复舰船：舰队实例化（uid + 自动编号 + 自由改名）（状态：已确认并实现）

> 来源：T5 立项卡 B（结构级）。2026-09-04 设计闸门确认（编号方案甲：默认名带号、
> 固定不回收；改名规则：免费、10 字上限、允许重名）后实现。
> 关联：`docs/roadmap.md` T1–T11、`docs/design/t5-sell-guard.md`（A 部分 + B 立项卡）。

## 需求与确认口径

- 目标（T5 立项卡）：玩家可拥有重复舰船（fleet 实例化 key）；同型自动编号「#2」+ 自由改名（Q4 甲）。
- 设计确认（船长拍板）：
  - **编号（Q1 甲）**：默认名带号、固定不回收——第 2 艘起默认显示「船型名 #N」；
    出售后剩余船号不变（号 = 船的身份，稳定不重排）；玩家改名后完全由自定义名决定。
  - **改名（Q2）**：免费任意改；上限 10 字（按字/码点）；**允许重名**；提供"恢复默认名"。

## 实现（core，存档 v17 结构迁移）

### 1. 实例键与数据
- `fleet: Record<uid, FleetShipState>`；条目新增 `defId`（船型锚）与 `customName`（可空）。
- uid 规则：第 1 艘同型 = 船型 id（如 `sandcat`）；第 2 艘起 = `sandcat#2`、`#3`…。
  - 分配 = 现存最大 #N（含市场挂卖 escrow 中的同型）+1；中间空号不复用；同型清空后重新从第 1 艘。
  - 旧档每型只有一艘：**键原样保留**（= 第 1 艘 uid），驾驶 shipId / AI 指派 / 锁定 /
    shipReturns / escrow 里的船 id 全部无需改写 → 迁移风险极低。
- 迁移 `MIGRATIONS[16]`（v16 → v17）：给每艘 fleet 船与每条 escrow 舰船快照补
  `defId`（= 键/uid）与 `customName: null`；normalize 兜底（defId 按 uid 前缀解析、
  customName 去空白、按 10 字截断）。

### 2. 显示名（全链统一入口 `shipDisplayName(state, ctx, uid)`）
- 自定义名 ?? 船型名（同型第 2 艘起自动带「 #N」）；改名后全权自定义。
- 落点：日志（远征出发/战报/撤退/采矿/返港/维修/锁定/改名/离线报告）、活动栏 AI 与善后返航条目、
  战场我方单位、装配/货仓/舰船页/AI 下拉与执行列表、矿带页副船行——所有以"舰队实例"取名的点统一走 helper；
  以船型数据 id 取名的点（市场品目/蓝图/手册/舰船数据锚）不动。

### 3. 引擎行为
- `addShipToFleet(state, defId)`：**每次新增一艘实例**并返回 uid（取代旧"幂等加入"；
  隐性的一型一艘限制解除）。购买/蓝图完工 = 新实例；escrow 撤单 = 原实例原样恢复
  （uid/船型/耐久/自定义名全保留——escrow 快照扩展为 `{shipId, defId, durability, customName}`）。
- 新增 `renameShip(state, uid, name | null)`（null = 恢复默认）；`allocateShipUid`。
- 驾驶/AI 指派/锁定/出售守卫/维修/装配/善后返航：键语义自然变成实例 uid，逻辑不变；
  `changeShip`/`repairShip` 等的船型数据改经 `fleetDefOf(state, ctx, uid)` 解析（uid ≠ defId）。
- 购买即登舰：`buyShip` 市价成交登舰到**新实例**；驾驶船忙（远征/扫描/采矿/野外/返航途中）时
  只入机库不登舰（不打断作业，日志说明）；同型第二艘照买。

### 4. UI
- 舰船页舰队列表按实例渲染（同型多艘各自成卡）；卡名 = 显示名；新增「✏️ 改名」内联行
  （输入 + 确定 / 恢复默认名 / 取消）；市场现货卡显示「机库 ×N」且不再禁用重复购买。

## 涉及文件
- core：`state.ts`（v17/字段/初始档）、`labels.ts`（uid 工具）、`instances.ts`（新：
  fleetDefOf/shipDisplayName 零依赖查询）、`shipyard.ts`、`market.ts`、`industry.ts`、
  `manufacturing.ts`、`expedition.ts`、`mining.ts`、`ai.ts`、`combat.ts`、`inventory.ts`、
  `travel.ts`、`activity.ts`、`save.ts`（迁移 16 + normalize）、`index.ts`；
- UI：ShipPage（实例卡 + 改名 + 市场×N）、CargoPage/FitPage/MapPage/BattleScreen/engine wrapper 名称适配、styles.css；
- 测试：新增 `tests/t5b.test.ts`（7 组：编号分配不回收 / 显示名 / 改名规则 / 驾驶与 AI 双实例 /
  escrow 原实例往返与占号 / 重复购买登舰与忙时入库 / v17 迁移与往返保真）+ 存量迁移/往返测试适配。

## 验证
- core 测试 251/251 绿；typecheck 四包全绿；desktop build 通过。
