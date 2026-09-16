# 后勤舰维修特性入「船体特性」属性（数据字段驱动）· 工作文档

> **状态：进行中**（二号 · `d2/workspace` · 2026-09-16）
> 归档指向：船长验收 + 合入 main 后 ⇒ 关键内容并入 `docs/glossary.md`（后勤舰/船体特性条）与 roadmap 一条，
> **本工作文档删除**（约定 §8 三步）。
> 前情：后勤舰特性本体（我方修最缺血队友 / 敌方 50% DPS 转修理）在同日批次 `4f01a13e`，
> 验收档 `7ec36e63`；本文件只记**同日追批的"入属性"改动**。

## 一、船长原话（照抄）

1. （特性本体，2026-09-16）「**后勤舰添加特性，维修装置可以修理血量最少的队友。**」
2. （本次触发）「**我发现之前给后勤舰的维修特性并添加到船体特性属性中？**」
3. （选择口径）四步闸门二选一里选 **甲**：加数据字段 + 界面「船体特性」显示 + 体检契约。
4. （公告）本次**不发公告**（船长选"不用发公告"）。

## 二、问题定位（改前现状）

- 界面「船体特性」栏（`apps/desktop/src/renderer/src/ui/shipInfo.tsx` 的 `shipInfoLines`）只列**三个数据字段**：
  `weaponRangeBonusPct` / `fleetDamageBonusPct` / `wormholeScanRadiusBonus`（2026-09-13 船长点名的三条船体固有机制）。
- 后勤舰那条特性是**代码硬判据**：`combat.createPlayerSpec` 里 `ship.subClass === '后勤舰'` ⇒ `spec.logistics`。
  **数据层没有任何字段承载它** ⇒ 卡面、界面都看不到（船长报的就是这个）。
- 同批的**敌方**后勤舰走的是**数据字段** `FoeShipDef.repairPct` ⇒ 同一机制两套表达，不一致。

## 三、落值（现行）

| 项 | 内容 | 落点 |
|---|---|---|
| 新字段 | `repairPulseTargetsFleet?: boolean`（缺省 = 只修自己，旧口径） | `packages/core/src/types.ts`（紧接三条船体机制之后） |
| 卡面声明 | 「亡军后勤舰」写 `repairPulseTargetsFleet: true` | `packages/data/src/ships.ts` |
| 引擎判据 | 由 `subClass === '后勤舰'` 改为 `ship.repairPulseTargetsFleet === true` ⇒ `spec.logistics`（**行为逐字不变**：现在只有这一艘且写了 true） | `packages/core/src/combat.ts` |
| 界面 | 「船体特性」栏新增一条：**装了维修装置时，维修脉冲改修编队中最缺血的舰船（含自己）** | `apps/desktop/src/renderer/src/ui/shipInfo.tsx` |
| 族舰复核工具 | 特色栏同源显示该条 | `tools/wh-family-review.ts` |
| 体检契约 | 只认 `true`/缺省；写了就必须 `subClass === '后勤舰'`；舰种契约行加读数「后勤舰特性 … 1 艘（亡军后勤舰）」 | `tools/content-check.ts` |

**不做**：不改修理量、不改选靶规则（三层剩余比例最低者、含自己）、不动敌方后勤舰、不发公告。

## 四、用例

`packages/core/tests/logistics-repair.test.ts`（+2 例，共 10 例）：
- 卡面契约：亡军后勤舰声明了该字段；**声明该字段的船全部是「后勤舰」子分类**（与 `content:check` 同一条）；
- **引擎读字段、不看子分类**：基线（后勤舰 true / 普通船缺省）＋ 补丁上下文双向验证
  （摘掉后勤舰的字段 ⇒ 退回只修自己；给普通船补上 ⇒ 立刻生效）。

## 五、验证

- 五闸门：`npm run typecheck` 四包 **0 错** · core **157 文件 / 1,709 例** 全绿 ·
  `content:check` ✅（舰种契约行已带新读数）· `ui:rot-check` ✅ · 桌面构建 ✅。
- 界面读数属**观感类**，按船长口径由船长自审（本批不截图）。

## 六、待裁决 / 开放点

- 界面那条文案若要换措辞（现为「装了维修装置时，维修脉冲改修编队中最缺血的舰船（含自己）」），说一声即改。
- 归档待办（§8 三步）：词典补「船体特性」四字段口径与后勤舰特性一条；roadmap 一条；删本工作文档；重跑 `docs:index`。
