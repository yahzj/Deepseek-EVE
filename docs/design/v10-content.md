# V10 设计：深空市场大扩容（占位导入）

> 状态：**已确认**（用户 2026-09 确认；路线=占位导入先行，结构一次就位、机制后置启用）。
> 原则：加内容 = 加数据；本轮唯一的存档结构变化是**槽位模型扩展（v9→v10）**，
> 之后战斗/舰船细分系统落地时直接启用已就位字段，不再迁移。

## 一、已确认决策（用户拍板记录）

1. **路线**：占位导入先行——战斗/舰船细分机制本轮不做；内容大规模导入为可交易占位项，
   数据结构按未来机制设计就位（将来零迁移直接启用）。
2. **命名**：延续自创风味名（沙猫级/鲸吞级风格；四船线：鲸盟工业 / 掠食者武装 / 甲壳重装 / 蜃楼航运）。
3. **覆盖面**：尽量全覆盖——矿石/矿物/气体/冰/弹药/无人机/舰船/装备/蓝图/市场目录全扩。
4. **战斗相关规模**：保持原规模——武装舰 ~5 艘、炮台等生效家族扩档、护盾/装甲/推进占位家族、
   弹药 6 / 无人机 4；**不细分武器家族、不加阵营势力货**。
5. **市场卡规模（修正）**：核算后 ~180 张会靠"纯数值档位"凑数，改为 **31 → 约 95~110 张**，
   每条都有真实用途或明确占位，质量优先；战斗版本（武器/弹药族翻倍）再自然上量。
6. **槽位模型（本轮定死）**：`miner/cargo/turret`（生效）+ `shield/armor/propulsion`（占位，
   可装配无效果，UI 明示"战斗系统开放后生效"）。改装件（rig）家族不引入槽位，待战斗系统按真实规则设计时再定。
7. **新增小机制（实现期补充，随本版确认）**：
   - `BeltDef.standingReq?` 矿带声望门槛（防"新手直接挖最高档矿带"破坏经济曲线；与市场门槛同思路）；
   - `MarketGoodDef.standingReq?` 部分高端商品需协会声望才可买入（声望新用途）。

## 二、数值设计原则

- **资源价值曲线**：单件资源（1 m³/单位）收购基价严格递进——
  矿石 12→490（10 档）、气体 85~345、冰 150~360；新矿带全部挂声望门槛（1~11），旧 4 矿带保持 0；
- **精炼经济**：每资源精炼配方按"100% 收率价值 ≈ 收购价 ×1.15~1.35"配平（延续旧表精神：
  精炼学练满赚、初始 50% 亏），产物只指向矿物（气体/冰不出新物品种类）；
- **矿物阶梯**：旧 4 种（8/12/20/90）不动，新增 4 种高端矿物 45/220/780/1800，
  只由新资源产出 → 不稀释旧矿物价值；新蓝图用料把新矿物排在高端段；
- **市场池参数**：越贵的商品池越小、稳态流量越低（防高价商品天量刷钱）；
- **舰船占位数值**：所有新增船可驾驶可挖矿，参数用现有公式体系做差异化——
  工业线（产量/货舱递进）、武装线（动力高→弃船率低，AI 远征座驾更安全；产量弱）、
  重装线（货舱大、动力差）、航运线（货舱特大、航程折衷）；火力/结构字段就位但引擎不读；
- **装备加成上限**：生效家族（miner/cargo/turret）档位加成封顶 ≈ 现有 MK2 之上再一档（MK3），
  不无限拉高曲线；原型机（exotic）为市场专供的"超档收藏"，无蓝图。

## 三、数据清单（最终规模）

### 3.1 物品（items.ts）

**矿物（8）**（kind=mineral，0.01 m³/单位）

| id | 名称 | 基价 |
|---|---|---|
| min-tritanium | 三钛合金（旧） | 8 |
| min-pyerite | 类银超金属（旧） | 12 |
| min-mexallon | 类晶体胶体（旧） | 20 |
| min-nocxium | 超噬矿（旧） | 90 |
| min-isotope | 同位聚晶 | 45 |
| min-starcore | 星髓晶 | 220 |
| min-darkiron | 冥铁合金 | 780 |
| min-voidcrystal | 虚空晶 | 1800 |

**矿石（10）**（kind=ore，1 m³/单位；旧 4 种数值不动）

| id | 名称 | 基价 | 精炼配方（perOre） | 100%价值/价比 |
|---|---|---|---|---|
| ore-veldspar | 富凡晶石（旧） | 12 | trit 2.0, pyer 0.6 | 1.93 |
| ore-scorched | 灼烧岩（旧） | 18 | pyer 1.6, mex 0.5 | 1.62 |
| ore-kernite | 克洛基石（旧） | 30 | mex 1.2, noc 0.15 | 1.25 |
| ore-hemorphite | 希莫非特（旧） | 55 | noc 0.45, trit 1.5 | 0.95* |
| ore-glowstone | 辉云岩 | 80 | iso 1.7, trit 2.2 | 1.18 |
| ore-sunshard | 曦棱晶 | 115 | iso 2.7, pyer 1.0 | 1.16 |
| ore-fluxite | 熔辉石 | 165 | iso 1.5, star 0.5, mex 1.1 | 1.21 |
| ore-crimsonite | 赤曜石 | 235 | star 1.0, mex 1.8, iso 0.5 | 1.19 |
| ore-voidshard | 玄晶 | 340 | star 1.3, dark 0.12, noc 0.3 | 1.20 |
| ore-nebulite | 星幽矿 | 490 | dark 0.55, star 0.8 | 1.23 |

\* 希莫非特为历史数据（100% 收率略亏），不动，避免破坏旧档经济记忆。

**气体（4）**（kind=gas，1 m³/单位，可采集可精炼）

| id | 名称 | 基价 | 精炼配方 | 比值 |
|---|---|---|---|---|
| gas-neon | 氖云气 | 85 | iso 2.2, trit 1.2 | 1.28 |
| gas-phosphor | 磷光霾 | 140 | iso 1.8, star 0.35, mex 0.7 | 1.23 |
| gas-ionstorm | 离子风暴云 | 230 | star 0.85, dark 0.08, iso 0.4 | 1.16 |
| gas-aurora | 极光云 | 330 | star 0.7, dark 0.28 | 1.13 |

**冰矿（3）**（kind=ice，1 m³/单位，可采集可精炼）

| id | 名称 | 基价 | 精炼配方 | 比值 |
|---|---|---|---|---|
| ice-frost | 蓝霜冰 | 150 | iso 3.6, mex 1.0 | 1.21 |
| ice-marrow | 寒髓冰 | 230 | star 0.85, iso 1.5, mex 0.5 | 1.15 |
| ice-darkstar | 暗星冰 | 360 | dark 0.32, star 0.6, iso 1.0 | 1.19 |

**弹药（6，占位消耗品）**（kind=ammo，0.02 m³/单位；文案"战斗系统开放后使用"；
V10.5 已更名与补战斗契约，见 v10b-combat-data.md）

轻型/重型动能弹（原名"穿甲弹"，V10.5 更名）6 / 14、
轻型/重型高爆弹 7 / 16、轻型/重型等离子弹 8 / 18
（id：ammo-kinetic-l/h、ammo-explosive-l/h、ammo-plasma-l/h）

**无人机（4，占位）**（kind=drone，单位体积按型号 1.5/3/6/10 m³；文案同上）

蜂鸟侦察无人机 900 / 赤鸢战斗无人机 2200 / 猎鹰攻坚无人机 5000 / 雷鸥哨戒无人机 9500
（id：drone-scout/assault/heavy/sentry；ISK/架）

### 3.2 矿带/采集点（belts.ts，13 新增 + 旧 4 条）

新带全部带 `standingReq`（1~11），出产与门槛：

| belt id | 名称 | 资源 | 门槛 |
|---|---|---|---|
| belt-glowstone | 辉云矿带 | glowstone | 1 |
| belt-sunshard | 曦晶带 | sunshard | 2 |
| belt-gas-neon | 氖云气田 | gas-neon | 2 |
| belt-fluxite | 熔辉裂谷 | fluxite | 3 |
| belt-ice-frost | 蓝霜冰环 | ice-frost | 3 |
| belt-gas-phosphor | 磷光霾场 | gas-phosphor | 4 |
| belt-crimsonite | 赤曜矿区 | crimsonite | 5 |
| belt-ice-marrow | 寒髓冰环 | ice-marrow | 6 |
| belt-gas-ionstorm | 离子风暴云场 | gas-ionstorm | 6 |
| belt-voidshard | 玄晶深带 | voidshard | 7 |
| belt-gas-aurora | 极光云场 | gas-aurora | 8 |
| belt-nebulite | 星幽矿脉 | nebulite | 9 |
| belt-ice-darkstar | 暗星冰环 | ice-darkstar | 10 |

### 3.3 舰船（ships.ts：5 旧 + 14 新 = 19 艘）

参数 = 货舱 m³ / 循环秒 / 每循环单位 / 动力，价格 ISK（新船全部可驾驶、可市场买卖或制造）：

- **鲸盟工业线（+3）**：座头鲸级矿舰 9000/10/40/0.30·1.35M（可造+稀有现货）、
  弓头鲸级货舰 17000/12/32/0.28·1.9M（稀有）、巨灵鲸级旗舰货舰 26000/11/44/0.22（蓝图制造 + exotic 现货）
- **掠食者武装线（+5）**：隼枭级武装艇 650/16/6/0.80·42k、伯劳级武装护卫舰 1050/15/8/0.74·110k、
  虎鲨级武装护卫舰 1500/14/11/0.68·240k、灰鲭鲨级驱逐舰 2300/13/15/0.62·480k（稀有）、
  大白鲨级炮舰 3200/13/18/0.56·1.1M（exotic，声望 7）
- **甲壳重装线（+3）**：陆龟级重装艇 7000/13/24/0.50·330k、玳瑁级重装巡舰 12000/13/22/0.46·760k、
  玄武级重装旗舰 19000/14/26/0.40·2.2M（exotic，声望 9）
- **蜃楼航运线（+3）**：飞鱼级快运舰 5000/11/20/0.62·210k、旗鱼级高速货舰 8500/11/18/0.56·480k、
  剑鱼级大型货舰 14000/12/16/0.50·1.25M（exotic，声望 8）

ShipDef 新增占位字段（引擎本轮不读）：`role: 'industrial'|'armed'|'armored'|'hauler'`（必填，旧 5 艘=industrial）、
`powerBonus?`（武装舰 0.15~0.6 占位）。
（V10.5 补注：占位 `hull` 字段已被 `hullHp`（结构层血量）取代，详见 v10b-combat-data.md。）

### 3.4 装备（modules.ts：6 旧 → 24）

- **生效家族**（miner/cargo/turret 各 4 档）：民用 / MK1（旧）/ MK2（旧）/ MK3（新，无蓝图仅市场稀有）
  - 采集器 +10/20/50/80%；货舱 +15/30/80/140%；炮台 +12/25/60/100%（MK3 为攻坚级）
  - 新 id：mod-miner-civ、mod-cargo-civ、mod-turret-civ、mod-miner-3、mod-cargo-3、mod-turret-3
- **占位家族**（shield/armor/propulsion 各 3 档 MK1/MK2/MK3，效果随战斗系统开放）：
  护盾增强器（0.15/0.35/0.5）、装甲增厚板（0.2/0.5/0.8）、矢量推进器（0.1/0.25/0.4）
- **原型机（exotic 市场专供，声望 10，无蓝图）**：异星原型采集器（+1.1）、异星原型货舱（+1.8）、异星原型炮台（+1.5）

### 3.5 蓝图（blueprints.ts 6→12 张模块 + shipBlueprints.ts 2→4 张船）

- 新增民用蓝图 ×3（常驻平价，旧矿物料）；MK3 蓝图 ×3（稀有、用星髓晶/冥铁，制造 5~8 小时）；
- 新增船蓝图：座头鲸级（稀有）、巨灵鲸级（exotic，重料含虚空晶）。

### 3.6 市场目录（marketCatalog.ts：31 → ~97 张）

| 分区 | 数量 | 说明 |
|---|---|---|
| 池商品（kind=item） | 35 | 矿石10+矿物8+气体4+冰3（玩家产出主渠）+ 弹药6+无人机4（NPC 补给池，可回卖亏 6% 无套利） |
| 模块单件 | 24 | 常驻 9（民用/MK1/占位 MK1）+ 稀有 12（MK2/MK3/占位 MK2/MK3）+ exotic 3（原型机，声望 10） |
| 蓝图单件 | 16 | 模块蓝图 12 + 船蓝图 4（含声望门槛：MK3 蓝图 4、巨灵鲸蓝图 11） |
| 舰船单件 | 18 | 常驻 1（掘洞）+ 稀有 12 + exotic 5（白鲨 7 / 剑鱼 8 / 玄武 9 / 巨灵鲸 11 / 鲸王 0） |
| AI 核心 | 4 | 原 4 档不变 |

池商品参数原则：basePrice=基价；收购平价、供应微溢 6%；poolTarget/supplyFlow 随价格递减（见 3.1 表格价，具体池参在代码表注释）。

## 四、引擎与存档改动清单（最小启用集）

1. **types.ts**：`ItemKind` 扩为 ore/mineral/gas/ice/ammo/drone；`ModuleSlot` 扩六槽；
   `ShipDef` 增 role/powerBonus?/hull?；`BeltDef` 增 `standingReq?`；`MarketGoodDef` 增 `standingReq?`；
   `FittedModules` 改为按槽 Record（形状进 v10 存档）。
2. **存档 v10**：`CURRENT_STATE_VERSION=10`；迁移 v9→v10 给每艘船的 fitted 补
   `shield/armor/propulsion: null`；normalizeState 同步默认六键（历史先例 v4→v5 补炮台槽）。
3. **槽位常量化**：新增 `core/src/labels.ts`（`MODULE_SLOTS`、`slotLabel`、`ITEM_KIND_LABELS`、
   `emptyFitted()`），替换 equipment.ts 的 MODULE_SLOTS/slotLabel 与 state/shipyard/save 等处手写三键字面量；
   `fittedBonuses` 重构为按槽循环返回 `Record<ModuleSlot, number>`（行为不变）。
4. **资源通用化**：mining.ts:71 与 ai.ts:128 的 `kind==='ore'` 校验放宽为"可采集资源
   （ore/gas/ice，有 unitM3）"；industry.ts:56 精炼入口校验放宽为"带精炼配方即可"（产物仍须 mineral）；
   文案把"矿石"改"资源"处同步；途中事件 `mineral` 效果补 item 存在性防御（expedition.ts）。
5. **矿带声望门槛**：startMining / AI 指派校验 `belt.standingReq`（缺省 0），拒绝并提示；
   UI 矿带列表锁标。
6. **市场声望门槛**：buyAtMarket/挂买单处校验 `good.standingReq`（卖不受限）；
   UI 行显示锁标与所需声望。
7. **日志/引导文案**：createInitialState 欢迎日志升级到 V10 一句话。

## 五、UI 改动清单

- ItemsPage / CargoPage：物品分组从"ore/mineral 两栏"改为按 `ITEM_KIND_LABELS` 六类数据驱动分栏（空类不显示）；
- IndustryPage 精炼台：列出"仓库+货仓里全部带精炼配方的资源"（不再只 ore）；
- FitPage：槽位区自动随 MODULE_SLOTS 渲染；shield/armor/propulsion 效果文案 = "战斗系统开放后生效"；
- ShipPage：船卡加船型徽标（工业/武装/重装/航运），spec 行保留原三属性；
- MapPage：矿带列表显示声望门槛锁与实时市场收购价（替换半废弃的 baseSellPriceIsk 静态价）；
- MarketPage：standingReq 商品行显示"声望 X 解锁"锁标，不可买。

## 六、明确不做的边界

战斗公式与舰船火力/结构参与、护盾装甲推进实际效果、弹药消耗、无人机作战、武器家族细分、
阵营势力货、改装件槽位、AI 自动购货、新 MarketGoodKind、新 AI 核心类型、新星系/星图/异常点、
新技能——均不在本轮。

## 七、测试与验证计划

- **目录完整性测试**（新）：所有船/蓝图/矿带/装备 id 引用可解析；每种物品必有市场卡（防死物品）；
  新矿带 oreId 必须是可采集资源；全部市场卡 refId 按 kind 能解析；配方产物都是矿物；
- **save.test**：v9→v10 迁移（旧档六槽补默认/坏档容错）；
- **新行为测试**：气体/冰采集与精炼闭环、矿带声望门槛（主控+AI）、市场声望门槛、原型机购买门槛、
  新槽位装配/卸下（无效果但状态正确）；
- 验证闭环：typecheck → vitest 全绿 → `npm run balance`（基线 8 个 id 未动，输出与旧基线同量级）→
  build → Electron 冒烟 + 真实 v9 档迁移 v10。

## 八、实现顺序

数据层结构（types/labels/state/save）→ 引擎通用化与门槛 → 数据表（items/belts/ships/modules/blueprints/
shipBlueprints/marketCatalog）→ UI → 测试 → 文档同步（architecture v10、README 补 V9+V10）。
