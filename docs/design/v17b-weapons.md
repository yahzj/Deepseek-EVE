# V17.2 设计：武器改造（口径适配 · 炮型绑定弹种 · 分系炮族）

> 状态：实现中。船长拍板（2026）：命中模型维持现有简单计算（**C 撤销**——
> min→max 单段线性衰减与 falloff 端值不变）；口径制 = 本轮先做 light/heavy
> 两档船体适配（三档小/中/大留 V18 槽制）；**炮型绑定弹种**（EVE 式：每门炮固定
> 伤害类型，换炮 = 换弹种，取代"任意炮三系通吃 + 按库存自动混合"）；
> 家族细分部分做（轻速射/重远程定位强化）；导弹架/无人机挂架留 V18+。

## 一、为什么改

旧模型（V10.5 契约遗留）：任意炮台可吃三系弹药、出发预载按库存比例混装、
开火按"剩余最多弹型"动态切换。玩家的最优策略 = 全系弹各备一份让系统自动打
克制——**弹种选择失去意义，且与敌方伤害构成（dmgMix 单型）的对抗全靠敌方**
不是靠玩家配装。EVE 中弹种 = 炮族属性（Autocannon=动能弹 / Artillery=高爆弹 /
Laser=能量弹）。本轮把弹种决策收回给玩家：装哪门炮，你就打哪种伤害。

## 二、炮台 = 炮族（口径 × 弹种 × 档位），11 件

轻口径（light 弹）带 = 速射近程；重口径（heavy 弹）带 = 慢射远程。
同一口径同 MK 的不同弹种款**性能相同，仅弹种不同**（玩家按敌方血型/抗性换族，
克制表：动能打盾 ×1.5 / 高爆打甲 ×1.5 / 能量打盾 ×0.75 通用）。

| id | 名称 | 口径 | 弹种 | 射程带 | 装填 | dmgMult | 命中 | CPU | 渠道 |
|---|---|---|---|---|---|---|---|---|---|
| mod-turret-civ | 民用舰炮 | light | 动能 | 250m–4.2km | 2.4s | ×1.0 | 0.80 | 6 | 平价/蓝图 |
| mod-turret-kin-1 | 轻型炮台 MK1·动能型 | light | 动能 | 250–4.6km | 2.2s | ×1.25 | 0.80 | 10 | 平价/蓝图 |
| mod-turret-exp-1 | 轻型炮台 MK1·高爆型 | light | 高爆 | 同上 | | | | 10 | 平价（市场专供） |
| mod-turret-pla-1 | 轻型炮台 MK1·能量型 | light | 能量 | 同上 | | | | 10 | 平价（市场专供） |
| mod-turret-kin-2 | 重型炮台 MK2·动能型 | heavy | 动能 | 700m–8.2km | 3.4s | ×1.6 | 0.78 | 28 | 稀有/蓝图 |
| mod-turret-exp-2 | 重型炮台 MK2·高爆型 | heavy | 高爆 | 同上 | | | | 28 | 稀有（市场专供） |
| mod-turret-pla-2 | 重型炮台 MK2·能量型 | heavy | 能量 | 同上 | | | | 28 | 稀有（市场专供） |
| mod-turret-kin-3 | 攻坚炮台 MK3·动能型 | heavy | 动能 | 1.2–10.5km | 4.2s | ×2.2 | 0.78 | 52 | 稀有/蓝图 |
| mod-turret-exp-3 | 攻坚炮台 MK3·高爆型 | heavy | 高爆 | 同上 | | | | 52 | 稀有（市场专供） |
| mod-turret-pla-3 | 攻坚炮台 MK3·能量型 | heavy | 能量 | 同上 | | | | 52 | 稀有（市场专供） |
| mod-turret-proto | 异星原型炮台（能量） | heavy | 能量 | 1.6–13km | 4.8s | ×2.8 | 0.78 | 70 | 奇货/声望10 |

- 每档蓝图 = 动能款（bp-turret-civ/1/2/3 产物改指动能型——"协会制式动能炮"叙事），
  高爆/能量款市场专供（无蓝图）→ 制造流玩家也有渠道差异；
- 消耗弹药 = 对应 口径+弹种（轻动能弹…重能量弹——items.ts 弹药表不变，市场照旧）；
- 旧 id（mod-turret-1/2/3）下架：迁移表并入动能款（mod-turret-kin-1/2/3）；
  mod-turret-civ/proto 保留（civ = 轻动能入门；proto = 异星能量重炮）。

## 三、口径适配（船体限制 = 装配资源之外的第二个分层维度）

- `ShipDef.maxWeaponSize?: WeaponSize`（缺省按 role 推导：armed/armored = heavy，
  industrial/hauler = light）；**sh-whale-king / sh-colossal 显式 heavy**（顶级工业重装）；
- 装配校验（fitModule，与 CPU 同一拒绝路径）：炮台 weaponSize > 船适配 → 拒绝并提示
  （"该船只适配轻型炮——重型炮台需要武装舰/装甲舰或重装工业船"）；
- 引擎 helper `shipMaxWeaponSize(def)` 导出，装配 UI/悬浮与校验同源；
- 存档修复：repair 迁移后若超口径（旧档重炮在小船上）→ 自动卸下退回装备库（不丢资产），
  日志说明。

## 四、战斗语义变更（最小 diff 原则）

- 保留 battle.ammo {kin,exp,pla} 三键计数结构与 nextAmmoType/refundAmmo 接口——
  装载改为**只装炮台弹种的那一型**（loadAmmo 增参 type），其余键恒 0；
  开火 nextAmmoType(battle.ammo) 与 UI dominant 自然只剩该型（无弹 = 全 0 = 不发射，
  基础舰炮兜底照旧）；
- createPlayerSpec：gun shotsByType 只填弹种单键；
- battleArcsFor / 弹药预载总量 ammoLoadTotal 逻辑不变；
- winPreview（胜率预估）：gun 由"三型均价"改为**按炮台弹种 × 敌方血型克制**精确计算
  （对盾型敌人动能炮的预估会明显高于高爆炮——预估与配装决策同源）。

## 五、不改的部分（边界）

- 命中公式/距离衰减（C 撤销）；弹药伤害基数与克制表（D 的数值待校准轮）；
- 敌方武器/战术、无人机武器；弹药 items 与市场；安防遭遇（B1，并行开发中）。

## 六、涉及模块与验证

types/combat/equipment（迁移+校验）/index、data（modules/ships 2 行/blueprints 3 行
moduleId/marketCatalog）、UI（配弹与口径展示）、content-check（炮台必 damageType、
蓝图产物口径一致可选）、helpers+combat/v17 tests、docs/roadmap。
验证 = typecheck ×4 / core tests / content:check / desktop+web build / 校准矩阵复跑。
