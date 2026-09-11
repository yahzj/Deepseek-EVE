/**
 * **敌舰配置表（舰级表）**——2026-09-11 船长定案（A 族试点）。
 *
 * 船长原话：「建议给敌人单独一套**敌舰的配置表**，敌舰属性按照配置表再根据实际悬赏等进行修正，
 * 这样**不会出现动一艘船，其他跟着动**」；同日裁决：「**舰级给绝对值**」「卡上用修正」
 * 「**允许混编**」「先试点」。
 *
 * ## 口径
 * - 本表每行 = **一个舰级**，属性一律**绝对值**（血 / 速度 / 单发 / 装填 / 命中 / 射程带 /
 *   远端衰减 / 血层分布 / 伤害构成），**不再从"威胁"推导**。
 * - 悬赏卡只写**编成**（引用哪个舰级、几艘、第几波）与**修正**（倍率 / 覆写），
 *   见 `AnomalyDef.ships` 与 `FoeShipSlot`。
 * - 好处：**改一艘船的影响面一眼可见，且只限引用它的卡**；旧口径下改任一全局常量都是全表联动
 *   （本仓已真实发生三次：推进器提档废掉全表标定 / 战术缺省值静默改掉 5 张卡 / 敌速两种口径
 *   混用无人察觉）。
 *
 * ## A 族四档（船长 2026-09-11：「按四级」；四级 = 头目档）
 * | 档 | 舰级 | 战术 | 血型 | 服务现有卡 |
 * |---|---|---|---|---|
 * | 一 | 海盗快艇 | brawl 贴脸 | 装甲型 | 边境海盗前哨 12、碎晶带劫匪通缉 20 |
 * | 二 | 劫掠护卫舰 | orbit 环绕 | 均衡型 | 信标猎手悬赏 22 |
 * | 三 | 劫掠狙击舰 | kite 拉距 | 护盾型 | 灰霾伏击团清剿令 28、赤潮劫掠舰队 34、蜃影导航劫持令 48 |
 * | 四 | 海盗头目舰 | brawl 贴脸（精锐） | 装甲型 | **暂未使用**——留给"头目强大带一堆杂鱼"的编成 |
 *
 * ## 试点纪律：**零难度变化**
 * 每档基准取该档**威胁最低那张卡的现状值**，同档内其余卡用**精确倍率**（如 `377/351`）复现原值，
 * 因此改造前后逐单位建档值必须**逐字一致**（以 `tools/_probe-foe-units.ts` 的两份导出比对为准）。
 * A 族特色调整（数量弥补 / 头目带杂鱼 / 全族提速）**不在本批**，等这批结构验收后再动。
 */

import type { FoeShipDef } from '@whale/core'

/** A 族 · 一档「海盗快艇」——brawl 贴脸杂鱼。基准 = 边境海盗前哨 12 的现状建档值 */
export const FOE_SHIP_PIRATE_SKIFF: FoeShipDef = {
  id: 'foe-pirate-skiff',
  name: '海盗快艇',
  family: 'A',
  hp: 150,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  speedMps: 351,
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

/** A 族 · 二档「劫掠护卫舰」——orbit 环绕。基准 = 信标猎手悬赏 22 的现状建档值 */
export const FOE_SHIP_PIRATE_CORVETTE: FoeShipDef = {
  id: 'foe-pirate-corvette',
  name: '劫掠护卫舰',
  family: 'A',
  hp: 365,
  split: { s: 0.34, a: 0.33, h: 0.33 },
  speedMps: 291,
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

/** A 族 · 三档「劫掠狙击舰」——kite 拉距。基准 = 灰霾伏击团清剿令 28 的现状建档值 */
export const FOE_SHIP_PIRATE_SNIPER: FoeShipDef = {
  id: 'foe-pirate-sniper',
  name: '劫掠狙击舰',
  family: 'A',
  hp: 268.75,
  split: { s: 0.5, a: 0.25, h: 0.25 },
  speedMps: 201,
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
 */
export const FOE_SHIP_PIRATE_WARLORD: FoeShipDef = {
  id: 'foe-pirate-warlord',
  name: '海盗头目舰',
  family: 'A',
  hp: 360,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  speedMps: 377,
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
