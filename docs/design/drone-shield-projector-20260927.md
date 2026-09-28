# 新装备「无人机护盾投射仪」MK2 / MK3（2026-09-27）

**状态：已实现待船长验收**

**船长原话照抄**：

- 「添加新的中槽装备，无人机护盾投射仪，效果是增加无人机的护盾值，只有 MK2 和 MK3，效果值为 +70% +100%。」
- 「MK3蓝图放奇货」
- 「MK3 成品留在普通稀有单。其他没问题」
- 过程确认：新建 `drone-shield` 槽位家族（归中槽）· MK2 cpu 20 / 45 万、MK3 cpu 45 / 200 万 · 多件**线性相加** · 不设上限 · 市场有卖也有蓝图。

**范围**：新槽位家族与两件装备、两张蓝图、市场两行成品 + 两行蓝图、护盾层接线、界面短行与信息行、契约与用例。
**不做**：不给既有装备补蓝图（20 件无蓝图清单见 §七）；不改 BM_MK3 抽取闸内清单（先例：中继天线 MK3 亦不在内）。

## 一、两件装备

| 项 | MK2 | MK3 |
|---|---|---|
| id | `mod-drone-shield-2` | `mod-drone-shield-3` |
| 名称 | 无人机护盾投射仪 MK2 | 无人机护盾投射仪 MK3 |
| 槽位家族 / 归槽 | `drone-shield` / **中槽** | 同左 |
| 效果字段 | `droneShieldHpBonusPct: 0.7` | `1.0` |
| CPU | 20 | 45 |
| 成品市场单 | rare · 450,000 | rare · 2,000,000 |
| 蓝图 | `bp-drone-shield-2` rare · **1,125,000** | `bp-drone-shield-3` **exotic（奇货）· 8,000,000** |
| 制造工时 | 900 秒 | 2,000 秒 |
| 料单 | 钛钢 10,900 · 银纹 3,400 · 晶态 2,300 · 重钨 320（料/价 45.1%） | 钛钢 47,200 · 银纹 15,000 · 晶态 9,000 · 重钨 1,810（45.0%） |
| 稀有度档 | 2 | 3 |

MK3 蓝图书价 = **产物现货价 ×4**（奇货档；`blueprints.ts` 的 `blueprintTierCoefOf` 规则，同 `bp-pd-e-3` 先例）。

## 二、效果口径

- 只加**放飞无人机的护盾层**（`DronePoolEntry.s`）——装甲层与结构层**一个数都不动**；
- 与「无人机耐久学」+4%/级、「无人机强化学」+6%/级**乘算**（三层血同链）；
- 只对**我方放飞**的无人机生效，敌方机群不受影响；
- 多件**线性相加、不设上限**（与 G 族「鱿蜂结构层」同款）；
- 接线与既有结构层加成完全对称：`createPlayerSpec` 求和一行 + 建池时乘进护盾项一行。

**实测读数**（王鲭级、两件同装、无技能档）：

| 机型 | 基础护盾 | 一件 MK2（+70%） | MK2+MK3（+170%） |
|---|---|---|---|
| 猎鹰攻坚 | 60 | 102 | 162 |
| 雷鸥哨戒 | 16 | 27 | 43 |

装甲 / 结构在上述三档里分别为 44/90（猎鹰）与 10/20（哨戒）——**逐档不变**。

## 三、新槽位家族 `drone-shield`

- 核心：`ModuleSlot` 加 `'drone-shield'`；`MODULE_SLOTS` 排在 `drone-relay` 之后（装配页与装备库分组顺序）；`SLOT_LABELS` 加「无人机护盾投射仪」；`rackOf()` 归**中槽**。
- 界面：槽位标签 l10n `ui.labelsText.071`（无人机护盾 / Drone Shield）+ `SLOT_ID` 映射；装备图标（方框徽 + 盾面，与三支既有无人机装置同语言）；装备卡短行（`moduleShortEffect`）与舰船信息行（`ui.shipInfo.205/206`）。
- 色调：**复用护盾族色调**（`toneVar('shield')`）——与「舰船插件复用 target-lock 色调」同款口径，不新造 CSS 变量、不动七套主题；船长若要独立色相，改 `tones.ts` 一行 + 补主题变量即可。
- 契约：`content-check` 的无人机装置契约新增 `drone-shield` 一支（`droneShieldHpBonusPct ∈ (0, 2]`）；市场卡与蓝图另补了稀有度表两处。

## 四、改了哪些文件

`packages/core/src/types.ts`（`ModuleSlot` + `ModuleDef.droneShieldHpBonusPct`）· `packages/core/src/labels.ts`（`MODULE_SLOTS` / `SLOT_LABELS` / `rackOf`）· `packages/core/src/combat.ts`（`UnitSpec.droneShieldBonusPct` + 求和 + 护盾层乘入）· `packages/core/src/equipment.ts`（`stackingOf` 新分支＝`flat`/`drone-shield`）· `packages/data/src/modules.ts`（两件装备）· `packages/data/src/blueprints.ts`（两张蓝图）· `packages/data/src/l10n.ts`（`EN_MODULES` 两条 + `EN_BLUEPRINTS` 两条）· `packages/data/src/marketCatalog.ts`（成品两行 + 蓝图两行）· `packages/data/src/rarityTier.ts`（四条档位）· `packages/data/src/l10n/table.ts`（槽位标签 + 信息行两条）· `apps/desktop/src/renderer/src/ui/labelsText.ts` · `Glyphs.tsx` · `tones.ts` · `shipInfo.tsx`（短行 + 信息行 + 汇总行）· `tools/content-check.ts`（新家族契约）· `packages/core/tests/drone-shield-projector-20260927.test.ts`（新增 7 用例）· `packages/core/tests/market.test.ts`（**市场相位第五次平移**，见 §六）。

## 五、文案台账

本批**只新增**玩家可见文案（两件装备的中英说明、两张蓝图的中英说明、槽位标签、舰船信息两行），**没有改动既有文案** ⇒ 无需 `⟪文案调整⟫` 记号与台账条目。

## 六、验证

- `npm run typecheck` 全绿 · `npm run content:check` 通过 · `npm run l10n:check` 通过 · `npm run ui:rot-check` 通过 · `npm run mod:order` 契约通过 · `npm run save:roundtrip-audit` 通过。
- 新增用例 7 个全绿（数据/槽位/收敛分组/市场与蓝图/中英说明/**护盾层读数与"只动护盾层"**）。
- **市场相位第五次平移**（记进 `market.test.ts` 用例注释）：新增 4 条市场行会让开盘铺簿的随机相位整体平移，原 seed 1 的读数从 22,001 掉到 800 ⇒ 逐种子重探（1~30），改用 **seed 17**（50,000，整单当窗吃掉，余量最大）。
- 全量：**257 文件 / 2751 用例，1 处失败** —— `wormhole-attend-invariant.test.ts` 的「v25→v30 迁移」用例，**既有偶发红**（主树单独跑同样红过），与本批无关。

## 七、读数与取舍

1. **中槽多一个竞赛者**：中槽从此要同时装护盾 / 推进 / 支援件 / 护盾投射仪；梭鱼 3 中、王鲭 5 中、势力两艘调槽后各 2 中。
2. **护盾层本就薄**（12~60）：+70%/+100% 是"翻倍但仍薄"，属抗点防、抗溅射的补强；不设上限意味着两件 MK3 = +200%。
3. **无蓝图装备清单（共 20 件，本批未补，按船长口径留待点名开批）**：异星原型采集器/货舱/激光炮 3 件 · 协处理器 MK3 · 深层机库 · 以及势力专属件 15 件（劫掠者转管炮、掠袭导弹巢、赃物强化舱、生体甲壳板、生体损管腔、酸液喷吐器、陵墓护盾阵列、守墓者长炮、陵寝装甲层、巨构残骸炮、巨构骨架、鱿蜂群导控、流亡中继桅、墨潮电子舱、墨潮捕获网）。
4. **BM_MK3 抽取闸内清单未收新件**：该清单收「MK3 战斗件 + 蓝图书」，但同为无人机装置的「中继天线 MK3」当年也未收 ⇒ 沿用同款先例；若船长要把两件护盾投射仪纳入闸内，加两行即可。
