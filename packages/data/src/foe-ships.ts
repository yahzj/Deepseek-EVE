/**
 * **敌舰配置表（舰级表）**——2026-09-11 船长定案（A 族试点）。
 *
 * 船长原话：「建议给敌人单独一套**敌舰的配置表**，敌舰属性按照配置表再根据实际悬赏等进行修正，
 * 这样**不会出现动一艘船，其他跟着动**」；同日裁决：「**舰级给绝对值**」「卡上用修正」
 * 「**允许混编**」「先试点」。
 *
 * ## 口径
 * - 本表每行 = **一个舰级**，属性一律**绝对值**（血 / 单发 / 装填 / 命中 / 射程带 /
 *   远端衰减 / 血层分布 / 伤害构成），**不再从"威胁"推导**。
 * - **速度例外（2026-09-11 追加裁决：船长「劫掠护卫舰和劫掠狙击舰下落一档，只有头目是巡洋舰」）**：
 *   速度改登记**舰种档 + 倍率**（`hullClassTier` + `speedRatio`）——
 *   **实际速度 = `HULL_CLASS_BASE_SPEED[舰种档] × 倍率`（编成还有 `speedMul` 时再乘）后取整**，
 *   四个舰级与原绝对值**逐字一致**（351 / 291 / 201 / 377，本批零行为变化）。
 * - 悬赏卡只写**编成**（引用哪个舰级、几艘、第几波）与**修正**（倍率 / 覆写），
 *   见 `AnomalyDef.ships` 与 `FoeShipSlot`。
 * - 好处：**改一艘船的影响面一眼可见，且只限引用它的卡**；旧口径下改任一全局常量都是全表联动
 *   （本仓已真实发生三次：推进器提档废掉全表标定 / 战术缺省值静默改掉 5 张卡 / 敌速两种口径
 *   混用无人察觉）。
 *
 * ## A 族四档（船长 2026-09-11：「按四级」；四级 = 头目档）+ 舰种档登记（同日追加裁决）
 * | 舰级档 | 舰级 | 舰种档 | 速度倍率 | 实速 | 战术 | 血型 | 服务现有卡 |
 * |---|---|---|---|---|---|---|---|
 * | 一 | 海盗快艇 | **1 护卫舰** | `351 / 340` | 351 | brawl 贴脸 | 装甲型 | 边境海盗前哨 12、碎晶带劫匪通缉 20 |
 * | 二 | 劫掠护卫舰 | **1 护卫舰** | `291 / 340` | 291 | orbit 环绕 | 均衡型 | 信标猎手悬赏 22 |
 * | 三 | 劫掠狙击舰 | **2 驱逐舰** | `201 / 295` | 201 | kite 拉距 | 护盾型 | 灰霾伏击团清剿令 28、赤潮劫掠舰队 34、蜃影导航劫持令 48 |
 * | 四 | 海盗头目舰 | **3 巡洋舰** | `377 / 258` | 377 | brawl 贴脸（精锐） | 装甲型 | **暂未使用**——留给"头目强大带一堆杂鱼"的编成 |
 *
 * ⚠ **海盗不配战列级**（船长 2026-09-11：「海盗应该是护卫驱逐巡洋构成，**战列级强力+维护成本大，
 * 不适合海盗的背景设定**」）——A 族只登记 **1~3 档**（护卫/驱逐/巡洋），
 * 不登记 4 战列舰 / 5 旗舰；由 `content:check`「舰级契约」与 core 测试双重守卫。
 * 头目舰登记 3 巡洋舰 = 海盗舰队的顶格（「只有头目是巡洋舰」）。
 *
 * ## 试点纪律：**零难度变化**
 * 每档基准取该档**威胁最低那张卡的现状值**，同档内其余卡用**精确倍率**（如 `377/351`）复现原值，
 * 因此改造前后逐单位建档值必须**逐字一致**（以 `tools/_probe-foe-units.ts` 的两份导出比对为准；
 * 速度改造那一批用同类 `_` 探针前后各导一次、20 行导出逐字一致，并已落成**常驻守卫** ——
 * `tests/foe-ship-path.test.ts`「舰种档与速度倍率」三条用例 + `content:check`「舰级契约」⑤）。
 * A 族特色调整（数量弥补 / 头目带杂鱼 / 全族提速）**不在本批**，等这批结构验收后再动。
 */

import type { FoeShipDef } from '@whale/core'

/** A 族 · 一档「海盗快艇」——brawl 贴脸杂鱼。基准 = 边境海盗前哨 12 的现状建档值
 * （速度 = 1 护卫舰基准 340 × `351/340` = **351** m/s，与原绝对值逐字一致） */
export const FOE_SHIP_PIRATE_SKIFF: FoeShipDef = {
  id: 'foe-pirate-skiff',
  name: '海盗快艇',
  family: 'A',
  hullClassTier: 1, // 护卫舰
  speedRatio: 351 / 340,
  hp: 150,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  shotDmg: 28,
  hitRate: 0.85,
  reloadMs: 4000,
  rangeMinM: 1,
  rangeMaxM: 2215,
  falloff: 0.3,
  blindDmgMul: 0.3,
  dmgMix: { explosive: 8, kinetic: 2 },
  tactic: 'brawl',
}

/** A 族 · 二档「劫掠护卫舰」——orbit 环绕。基准 = 信标猎手悬赏 22 的现状建档值
 * （速度 = 1 护卫舰基准 340 × `291/340` = **291** m/s；舰种档与舰级名一致 = 护卫舰） */
export const FOE_SHIP_PIRATE_CORVETTE: FoeShipDef = {
  id: 'foe-pirate-corvette',
  name: '劫掠护卫舰',
  family: 'A',
  hullClassTier: 1, // 护卫舰（2026-09-11 追加裁决：本舰级**下落一档**到护卫舰，名与档一致）
  speedRatio: 291 / 340,
  hp: 365,
  split: { s: 0.34, a: 0.33, h: 0.33 },
  shotDmg: 51,
  hitRate: 0.85,
  reloadMs: 4000,
  rangeMinM: 383,
  rangeMaxM: 5029,
  falloff: 0.3,
  blindDmgMul: 0.3,
  dmgMix: { kinetic: 8, explosive: 2 },
  tactic: 'orbit',
}

/** A 族 · 三档「劫掠狙击舰」——kite 拉距。基准 = 灰霾伏击团清剿令 28 的现状建档值
 * （速度 = 2 驱逐舰基准 295 × `201/295` = **201** m/s） */
export const FOE_SHIP_PIRATE_SNIPER: FoeShipDef = {
  id: 'foe-pirate-sniper',
  name: '劫掠狙击舰',
  family: 'A',
  hullClassTier: 2, // 驱逐舰（2026-09-11 追加裁决：本舰级**下落一档**到驱逐舰）
  speedRatio: 201 / 295,
  hp: 268.75,
  split: { s: 0.5, a: 0.25, h: 0.25 },
  shotDmg: 41,
  hitRate: 0.85,
  reloadMs: 4000,
  rangeMinM: 1476,
  rangeMaxM: 11316,
  falloff: 0.3,
  blindDmgMul: 0.3,
  dmgMix: { explosive: 8, kinetic: 2 },
  tactic: 'kite',
}

/**
 * A 族 · 四档「海盗头目舰」——**头目档**（`elite: true` → 显示名挂「精锐」前缀）。
 * 基准按一档快艇的 **2.4 倍**血与 **2.0 倍**单发预设，为"头目强大带一堆杂鱼"的编成预留；
 * **本批无卡引用**（船长 ⑥「先不改数值」：真正启用要连数量与波次一起调，属 A 族特色批）。
 * 舰种档 = **3 巡洋舰**（2026-09-11 追加裁决「**只有头目是巡洋舰**」= 海盗舰队顶格；
 * 速度 = 258 × `377/258` = **377** m/s）。
 */
export const FOE_SHIP_PIRATE_WARLORD: FoeShipDef = {
  id: 'foe-pirate-warlord',
  name: '海盗头目舰',
  family: 'A',
  hullClassTier: 3, // 巡洋舰（海盗族顶格）
  speedRatio: 377 / 258,
  hp: 360,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  shotDmg: 56,
  hitRate: 0.9,
  reloadMs: 4000,
  rangeMinM: 1,
  rangeMaxM: 2600,
  falloff: 0.3,
  blindDmgMul: 0.3,
  dmgMix: { kinetic: 8, explosive: 2 },
  tactic: 'brawl',
  elite: true,
}

/** 舰级表（按 id 索引；content-check 校验卡上引用的舰级必须在此） */
export const FOE_SHIPS: readonly FoeShipDef[] = [
  FOE_SHIP_PIRATE_SKIFF,
  FOE_SHIP_PIRATE_CORVETTE,
  FOE_SHIP_PIRATE_SNIPER,
  FOE_SHIP_PIRATE_WARLORD,
]
