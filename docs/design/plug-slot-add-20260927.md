# 舰船插件「扩槽」无效（中层舱段 / 下层舱段）— 工作文档

- **状态**：进行中（2026-09-27 开工 · 一号 · 主树 `main`）
- **来源**：船长追问「其他插件呢」⇒ 我做了 12 件插件的**逐字段读取点审计** ⇒ 只有这 2 件是坏的 ⇒ 船长令「修」。

## 船长原话（照抄）

> 其他插件呢
>
> 修

## 审计结论（12 件插件 · 2026-09-27）

| 插件 | 字段 | 生效点 | 状态 |
|---|---|---|---|
| 护盾强化插板 | `shieldHpAdd` | 建档基线 `baseHp` → 再吃装备/技能百分比 | ✅ |
| 装甲强化插板 | `armorHpAdd` + `speedPenaltyMps` | 基线 ＋ 速度式 | ✅ |
| 结构强化插板 | `hullHpAdd` | 同上 | ✅ |
| 协处理插件 | `cpuBonus` | `equipment.cpuBudgetOf` | ✅（同日修） |
| 火力强化插件 | `damageBonusPct` | `dmgFlat = … + plugDmg` | ✅ |
| 瞄具插件 | `hitBonusPct` | `eqHitMul = hitEq * plugHitMul` | ✅ |
| 射程插件 | `plugRangeBonusPct` | 并进战前射程池 ＋ 无人机射程 | ✅ |
| 推进插件 | `speedAddMps` | 速度式 | ✅ |
| 靶标 / 隐匿插件 | `targetWeightMul` | 进 spec 的选靶权重 | ✅ |
| **中层舱段插件** | `midSlotsAdd: 1` | **core 零消费**（只有 `shipInfo` 的说明文字 `ui.shipInfo.190`） | ❌ |
| **下层舱段插件** | `lowSlotsAdd: 1` | **core 零消费**（`ui.shipInfo.191`） | ❌ |

⚠ **第三次同一类病**：`combat.ts` 里留着前一位的记录 —— 插件加血/加速度**曾经也全无效**
（「只在下面那段里累加、全仓没有任何消费点……插件加血一点都没生效」），后来被提到基线处才修好；
今天又修了 CPU 预算。⇒ 病根 = **插件效果分散累加、没有护栏**。

## 根因

`midSlotsAdd` / `lowSlotsAdd` 要让"这艘船能装的件数"变多，而槽位数量在本作里是
**`fitted.mid` / `fitted.low` 数组的长度**（`labels.rackBays` 按长度取位、装配页按长度画格子、
`fitModule` 按长度找空位）——**数组长度在造船时定死**，插件装上去之后没人去动它 ⇒ 字段没人读、读了也没地方用。

## 修法（三处，同源单点）

1. **槽位单点加插件那份**：`labels.shipSlotsOf` = 船型 `ShipDef.slots` ＋ 已装插件的
   `midSlotsAdd` / `lowSlotsAdd` 之和（与 `cpuBudgetOf` 补插件那一段同一个思路）。
2. **装插件时扩容数组**：`installPlug` 成功后把 `fitted.mid` / `fitted.low` 补到新长度（补 `null`）。
   插件**不可拆**⇒ 只增不减，单向扩容，不需要缩容逻辑。
3. **读档对齐（老档迁移）**：已装插件的档、数组长度仍是旧值 ⇒ 在归一化处按"应有槽位数"补齐 `null`。
   **不写迁移键**（判据从 `plugs` 现算，与"老档零迁移"的一贯口径一致）。

## 待办

- [ ] 落码 + 用例（含老档对齐、装配页格子跟随、`ui.shipInfo` 说明与真实容量一致）
- [ ] 全闸门（typecheck · core 全量 · content · l10n · ui:rot · 构建）
- [ ] 归档（§8 三步：并入 roadmap ＋ 删本工作文档）
- [ ] **待船长定（另议）**：给 `content:check` 加一道**插件字段护栏**——断言"每个插件效果字段必须能在 core
      找到消费点"，谁新加字段忘了接线当场红。这是同一类病第三次复发后我提的建议，船长尚未裁定。
