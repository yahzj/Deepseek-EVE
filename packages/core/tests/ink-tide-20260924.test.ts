/**
 * **H 族「墨潮帮」逐条细化批**（船长 2026-09-24 晚 · 五档壳体 ＋ 四张入侵卡）——本文件钉四件事：
 *
 * 1. **干扰舰的射程压制与我方电子舰对冲**（船长原话：「降低效果为降低50%射程，可以和我方电子舰的
 *    效果相互抵消（**假设为我方为1艘电子舰，对方1搜墨潮干扰舰，那么最终效果是我方射程-35%**）」）：
 *    - 单艘：净削减 0.50 ⇒ 我方射程 ×0.50；
 *    - **船长给的验算**：我方 1 艘电子舰（15%）＋ 敌方 1 艘干扰舰（50%）⇒ 净 **0.35** ⇒ **×0.65**；
 *    - 两艘干扰舰**乘法合成**（1 − 0.5² = 0.75）。
 * 2. **突击舰带 A 族电子舰同款"网子 + 冲锋"**（船长：「添加A族洞内电子舰同款网子和冲锋」）。
 * 3. **四张入侵卡的波表**（船长逐条给定编成）＋ **旗舰卡自带波表不被覆写**（`FoeOverride.keepCardWaves`）。
 * 4. **战巡 1 架 / 母舰 2 架高属性重袭机**（船长：「拥有1架攻坚无人机…属性极高」/「拥有2架…」）。
 */
import { describe, expect, it } from 'vitest'
import { FOE_DRONES, FOE_SHIPS, buildSimContext } from '@whale/data'
import { resolveFoeMounts } from '../src/index'
import type { AnomalyDef } from '../src/index'
import {
  applyFoeOverride,
  createBattleState,
  createFoeSpecs,
  foeJammerCountOf,
  foeRangeDebuffOf,
  foeRangeNetDebuffOf,
  meRangeMulOf,
} from '../src/combat'

const ctx = buildSimContext()
/** 敌舰目录（FOE_SHIPS 在 data 包导出，不是 ctx 的字段） */
const shipOf = (id: string) => FOE_SHIPS.find((s) => s.id === id)!
const droneOf = (id: string) => FOE_DRONES.find((d) => d.id === id)!
const bal = ctx.balance.battle

/** 取一张入侵卡（它们在 `ANOMALIES` 目录里、`hidden: true`） */
const card = (id: string): AnomalyDef => ctx.anomalies.get(id)!

/** 用一张空壳卡包住给定舰级，拿它的单位规格（`foeRangeDebuffPct` 等运行时字段都在这份上） */
function specsOf(shipId: string) {
  const ship = shipOf(shipId)!
  const shell: AnomalyDef = {
    ...card('ink-harass'),
    id: 'probe-shell',
    ships: [{ ship, count: 1 }],
    waves: undefined,
  }
  return createFoeSpecs(shell, bal)
}

describe('H 族 · 墨潮干扰舰（射程压制 50% · 与我方电子舰对冲）', () => {
  it('舰级字段：`foeRangeDebuffPct = 0.5`，并原样带进单位规格', () => {
    expect(shipOf('foe-h-ink-jammer')!.foeRangeDebuffPct).toBe(0.5)
    expect(specsOf('foe-h-ink-jammer')[0]!.foeRangeDebuffPct).toBe(0.5)
    // 对照：没有该字段的舰级写不出这个运行时值（零行为变化口径）
    expect(specsOf('foe-h-ink-corvette')[0]!.foeRangeDebuffPct).toBeUndefined()
  })

  it('合成削减率：1 艘 = 0.50 · **2 艘 = 0.75（乘法合成）** · 无干扰舰 = 0', () => {
    const one = specsOf('foe-h-ink-jammer')
    const two = [...one, ...one.map((s) => ({ ...s, tag: `${s.tag}-b` }))]
    expect(foeJammerCountOf(one)).toBe(1)
    expect(foeRangeDebuffOf(one)).toBeCloseTo(0.5, 10)
    expect(foeJammerCountOf(two)).toBe(2)
    expect(foeRangeDebuffOf(two)).toBeCloseTo(0.75, 10) // 1 − 0.5²
    expect(foeRangeDebuffOf(specsOf('foe-h-ink-corvette'))).toBe(0)
  })

  /**
   * **船长给的验算（口径说明，别读反）**：我方 1 艘电子舰（15%）＋ 敌方 1 艘干扰舰（50%）
   * ⇒ **敌方那侧的净削减 = 50% − 15% = 35%**（我方电子舰的 15% 被它抵掉）——
   * 船长的「最终效果是**我方射程-35%**」是这么算出来的。
   *
   * ⚠ **但"我方射程倍率"本身仍由 50% 决定**（×0.50）：攻击者的射程削减只作用于**被攻击方**，
   * 不是"互相给对方打折"。两条一起看才是完整口径：
   * ① 我方射程 = 基础 ×(1 − 敌方 50%)；
   * ② 敌方射程 = 基础 ×(1 + 增程 − (我方 15% − 敌方 50%)) ——即"敌方削减我方射程时，
   *    同时把它自己吃到的我方削减抵消掉 50 个百分点"。
   */
  it('**船长给的验算**：我方 1 艘电子舰（15%）＋ 敌方 1 艘干扰舰（50%）⇒ 我方射程 ×0.50 · 敌方净削减 = 35%', () => {
    const foes = specsOf('foe-h-ink-jammer')
    const battle = createBattleState(specsOf('foe-h-ink-corvette')[0]!, foes, 0, 5_000)
    // 我方电子舰的削减率写进运行态（引擎每拍重算；本例直接落那一格）
    battle.meFoeRangeDebuff = 0.15
    // ① 我方射程倍率：只被敌方干扰舰压制
    expect(meRangeMulOf(battle, foes)).toBeCloseTo(0.5, 10)
    // 只有敌方（无电子舰）⇒ 同样 ×0.50（敌方那侧没人抵消它）
    delete battle.meFoeRangeDebuff
    expect(meRangeMulOf(battle, foes)).toBeCloseTo(0.5, 10)
    // 只有我方电子舰（无干扰舰）⇒ 我方射程不受影响（×1）
    expect(meRangeMulOf(battle, specsOf('foe-h-ink-corvette'))).toBe(1)
    // ② 敌方那侧的净削减 = 敌方 50% − 我方 15% = **35%**（船长原话的落点）
    battle.meFoeRangeDebuff = 0.15
    expect(foeRangeNetDebuffOf(battle.meFoeRangeDebuff ?? 0, foes)).toBeCloseTo(0.35, 10)
  })
})

describe('H 族 · 墨潮突击舰（挂 A 族洞内电子舰同款两件）', () => {
  it('舰级挂载 = 劫掠冲锋推进器（×1.6 / 30 秒）＋ 劫掠捕获网', () => {
    const r = resolveFoeMounts(shipOf('foe-h-ink-corvette')!.mounts)
    expect(r.foeCanCharge).toBe(true)
    expect(r.foeChargeMul).toBe(1.6)
    expect(r.foeChargeCooldownMs).toBe(30_000)
    expect(r.foeCaptureWeb).toEqual({ slowMul: 0.1, noThruster: true, noEvasion: true, rangeDownM: 500 })
    // 战斗单位上也带着（四张入侵卡都会吃到）
    const u = specsOf('foe-h-ink-corvette')[0]!
    expect(u.foeCanCharge).toBe(true)
    expect(u.foeCaptureWeb).toBeDefined()
  })
})

describe('H 族 · 四张入侵卡（船长逐条给定编成）', () => {
  it('1 骚扰舰队：突击舰 ×4（单波）', () => {
    const c = card('ink-harass')
    expect(c.name).toBe('墨潮帮骚扰舰队')
    expect(c.ships!.map((s) => [s.ship.name, s.count])).toEqual([['墨潮突击舰', 4]])
    expect(c.waves).toBeUndefined()
  })

  it('2 袭击舰队：2 波 —— 突击舰 ×2；鱼雷舰 ×3', () => {
    const c = card('ink-raid')
    expect(c.name).toBe('墨潮帮袭击舰队')
    expect(c.waves!.map((w) => w.units)).toEqual([2, 3])
    expect(c.ships!.filter((s) => s.wave === 0).map((s) => [s.ship.name, s.count])).toEqual([['墨潮突击舰', 2]])
    expect(c.ships!.filter((s) => s.wave === 1).map((s) => [s.ship.name, s.count])).toEqual([['墨潮鱼雷舰', 3]])
  })

  it('3 主力舰队：2 波 —— 突击舰 ×3；干扰舰 ＋ 战列巡洋舰 ＋ 鱼雷舰 ×2', () => {
    const c = card('ink-main')
    expect(c.name).toBe('墨潮帮主力舰队')
    expect(c.waves!.map((w) => w.units)).toEqual([3, 4])
    expect(c.ships!.filter((s) => s.wave === 0).map((s) => [s.ship.name, s.count])).toEqual([['墨潮突击舰', 3]])
    expect(c.ships!.filter((s) => s.wave === 1).map((s) => [s.ship.name, s.count])).toEqual([
      ['墨潮干扰舰', 1],
      ['墨潮战列巡洋舰', 1],
      ['墨潮鱼雷舰', 2],
    ])
  })

  it('4 旗舰部队：4 波（4 / 4 / 3 / 3）· 最后一波含入侵母舰', () => {
    const c = card('ink-flagship')
    expect(c.name).toBe('墨潮旗舰部队')
    expect(c.waves!.map((w) => w.units)).toEqual([4, 4, 3, 3])
    const w3 = c.ships!.filter((s) => s.wave === 3).map((s) => [s.ship.name, s.count])
    expect(w3).toContainEqual(['墨潮入侵母舰', 1])
    expect(w3).toContainEqual(['墨潮干扰舰', 1])
    expect(w3).toContainEqual(['墨潮战列巡洋舰', 1])
    expect(w3).toContainEqual(['墨潮鱼雷舰', 1])
  })

  it('**旗舰卡自带波表不被覆写**：`keepCardWaves` 真 ⇒ 用卡自己的 4 波；缺省 ⇒ 老行为（覆写）', () => {
    const c = card('ink-flagship')
    const kept = applyFoeOverride(c, { threat: 120, keepCardWaves: true, waves: [{ units: 4, hpShare: 0.25 }] })
    expect(kept.threat).toBe(120)
    expect(kept.waves!.map((w) => w.units)).toEqual([4, 4, 3, 3]) // 卡自己的
    const overwritten = applyFoeOverride(c, { threat: 120, waves: [{ units: 4, hpShare: 0.25 }] })
    expect(overwritten.waves!.map((w) => w.units)).toEqual([4]) // 老行为：被覆写
  })

  it('四张卡都 `hidden` ＋ `region: wh`（不进悬赏目录；地区按入侵口径计）', () => {
    for (const id of ['ink-harass', 'ink-raid', 'ink-main', 'ink-flagship']) {
      expect(card(id).hidden, id).toBe(true)
      expect(card(id).region, id).toBe('wh')
      expect(card(id).foeFamily, id).toBe('H')
    }
  })
})

describe('H 族 · 高属性重袭机（战巡 1 架 / 母舰 2 架）', () => {
  it('机型：三层血 180 · 单发 60 · 射程 7,000 · 命中 0.85（不随距离衰减）', () => {
    const d = droneOf('foe-drone-h-heavy')!
    expect(d.family).toBe('H')
    expect(d.dmg).toBe(60)
    expect(d.maxRangeM).toBe(7000)
    expect(d.hitRate).toBe(0.85)
    expect(d.falloff).toBe(1)
    expect(d.defense.shieldHp + d.defense.armorHp + d.defense.hullHp).toBe(180)
  })

  it('舰级登记：战列巡洋舰 ×1 · 入侵母舰 ×2，且建档后机群条目数对得上', () => {
    expect(shipOf('foe-h-ink-battlecruiser')!.drones!.map((s) => s.count)).toEqual([1])
    expect(shipOf('foe-h-ink-flagship')!.drones!.map((s) => s.count)).toEqual([2])
    const bc = specsOf('foe-h-ink-battlecruiser')[0]!
    const fl = specsOf('foe-h-ink-flagship')[0]!
    expect(bc.weapons.filter((w) => w.src === 'drone')).toHaveLength(1)
    expect(fl.weapons.filter((w) => w.src === 'drone')).toHaveLength(2)
    // 机群单发 = 机型 60 × 舰级 dmgMul（母舰把火力让给机群 ⇒ 本舰单发低于战巡口径的档位值）
    expect(bc.weapons.filter((w) => w.src === 'drone')[0]!.shotDmg).toBe(60)
  })
})
