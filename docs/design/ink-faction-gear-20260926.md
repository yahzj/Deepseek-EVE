# 墨潮帮（H 族）势力装备三件套（2026-09-26 · 二号 · d2）

- 状态：**进行中** —— 四步闸门已走完（集中提问 → 设计总结 v2 → 船长确认），本件为落码记录；归档按 AGENTS.md §8（船长验收 + 合入 main 后当批做：结论并入 roadmap / 词典 → 删本文件 → 重跑 `docs:index`）。
- 范围：**只做这三件 ＋ 敌方那件的具名化 ＋ 打开 H 族残骸回收**。
- 不做：H 族武器件 · 改装件/黑匣开启 · 提高高级箱概率（仍 5%）· 公告（内容增量，不发）。

## 一、船长原话（照抄 · 四轮）

1. 「**墨潮帮势力装备定为射程压制、捕获网、重袭机，分别占据高槽，高槽，攻坚机。**」
2. 「**敌人的射程压制挂载件好像也还没有命名？墨潮干扰舱改名墨潮电子舱。CPU使用提高到150**」
3. 「**1按你推荐来2，只电子舱。3，玩家的捕获网和武器一样有冷却周期，独立瞄准，不看命中 ，击沉携带者才解除，或者对面被击沉，不选取重复目标。对方被击沉后进入冷却，冷却结束选择新目标。重袭机单发16的动能伤害，40/80/100血量，4500射程，0.05闪避其他不变**」
4. 「**我方捕获网移除武器射程下降的效果，其他没问题了**」

## 二、三件定稿

| # | 件 | id | 槽位 | 关键数值 |
|---|---|---|---|---|
| ① | **墨潮电子舱** | `mod-lair-ecm-h` | 高槽（support） | 敌方射程 −15%（与电子舰乘法叠加）· **CPU 150** |
| ② | **墨潮捕获网** | `mod-lair-web-h` | 高槽（support） | 周期 **20 秒** · 独立瞄准 · 不看命中 · 不选重复目标 · 效果 = 机动 ×0.1 / 推进器全关 / 闪避归零（**不含射程**）· CPU 44 |
| ③ | **墨潮重袭无人机** | `drone-ink-heavy` | 无人机·攻坚机 | 单发 **16 动能** · 血 **40/80/100** · 射程 **4,500** · 闪避 **0.05** · 命中 0.85 · 抗性 盾 25/甲壳 20 · CPU 13 · 20 m³ · 一次掉 **×10 架** |
| ④ | **墨潮干扰阵列**（敌方） | `foe-mount-ink-range-debuff` | 挂载件 | 把 `foe-h-ink-jammer` 的舰级字段 `foeRangeDebuffPct 0.5` 迁成具名件（数值不变） |

## 三、捕获网口径（船长第 3/4 条落死）

- **周期装置**：不是"一场一次"，与武器一样有冷却周期（`captureWebCycleMs = 20_000`）。
- **开战即钉**第一个可选目标；**独立瞄准**（不跟武器打谁）· **不看命中**。
- **不选重复目标**：已被别的网钉住的跳过；**无目标可选 ⇒ 保持待发**（不空转冷却，沿用既有"打空不算用掉"口径）。
- **解除**：目标被击沉（⇒ 进入冷却，冷却结束选新目标）或**携带者被击沉**（⇒ 该网解除）。
- **效果**：机动 ×0.1 · 推进器全关 · 闪避归零 —— **不含"武器射程 −500m"**（船长第 4 条明令移除；敌方那件仍保留 −500m）。

## 四、连带的既有口径改动

- H 族残骸回收**打开**（删 `wreckRecycleClosedOf` 的 H 判据 ＋ 退役 `core.industry.084` ＋ 工业页摘卡过滤退役）——这正是当初关闭它的理由。
- `FOE_LAIR_GEAR.H` 由空池填成三件 ⇒ H 族稀有残骸高级箱（5%）开始产专属件，沿用"集齐前不重复"。
- 计数连带：无人机 7 → **8** 种 · 物品总数 102 → **103** · 敌方挂载件 13 → **14** 件。
- 敌方射程压制的取数口不变（`foeRangeDebuffPct` 仍是运行时字段）——只是来源从舰级改为挂载件。

## 五、落码清单

（落码后逐项补齐：文件 → 改动 → 验证读数）

## 五、落码清单（已落）

| 件 | 改动 |
|---|---|
| `core/types.ts` | `ModuleDef.foeRangeDebuffPct` / `captureWebCycleMs` · `FoeMountDef.rangeDebuff` · `UnitSpec.myCaptureWeb` · `FoeMountId` 加第 14 件 |
| `core/state.ts` | `BattleFoeWebDebuff` 接口 ＋ `BattleState.foeWebDebuffs` / `myWebs`（**随档**） |
| `core/save.ts` | 两格登记 `persist` ＋ `cleanBattle` 清洗器（坏值整条丢） |
| `core/combat.ts` | `meFoeRangeDebuffOf` 收装配件（同舰加和再合成）· `createPlayerSpec` 读周期写 `myCaptureWeb` · `applyFoeWebDebuff` / `advanceMyCaptureWebs`（周期/选目标/冷却/解除/连线/日志）· 建敌阵时压制率**挂载件优先、舰级回落** · 视图 `webLinks` 两向下发 |
| `core/equipment.ts` | `stackingOf` 两类新效果（ecm = flat · capture-web = max） |
| `core/foeMounts.ts` | 第 14 件「墨潮干扰阵列」＋ `resolveFoeMounts` 写 `foeRangeDebuffPct` |
| `core/lairs.ts` | `FOE_LAIR_GEAR.H` 三件（空池转实） |
| `core/salvage.ts` · `core/industry.ts` | H 族回收闸门退役（判据恒 false · 删拒因调用）· 词典删 `core.industry.084` |
| `data/modules.ts` · `data/items.ts` | 墨潮电子舱（15% / CPU 150）· 墨潮捕获网（20 秒 / CPU 44）· 墨潮重袭无人机（攻坚机） |
| `data/foe-ships.ts` | 墨潮干扰舰：删舰级 `foeRangeDebuffPct`，`mounts` 加干扰阵列 |
| `data/l10n.ts` · `data/l10n/table.ts` | 三条英文名与说明 ＋ `ui.shipInfo.185/186` |
| `data/marketCatalog.ts` · `data/rarityTier.ts` | 3 条收购行 ＋ 档 4 |
| `apps/.../IndustryPage.tsx` · `ui/shipInfo.tsx` | 摘卡过滤退役 · 装配页短行两支 |
| `tools/content-check.ts` | 计数（物品 102 / 无人机 8）· 支援件两类新效果（值域 · 槽位） |
| 用例 | 新 `ink-gear-20260926.test.ts`（14 例）· 改 `ink-tide`（挂载件迁移）· `recycle`（已打开）· `market`（种子 1 → 5） |

**验证读数**：typecheck 四包 0 错 · core **2,465 例全绿（222 文件）** · `content:check` ✓ · `l10n:check` ✓ ·
`ui:rot-check` ✓ · `ui:theme-check` ✓ · `build` ✓ · `docs:index` ✓。

⛔ **待船长复核**：两件模块的市场收购价按「同槽位最高档 ×4」取到 **40,000,000**（同族其余专属件在 7.6~12M 一档）——嫌高就改 `marketCatalog.ts` 那两行的一个数。
