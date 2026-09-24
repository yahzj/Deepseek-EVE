/**
 * **H 族「墨潮帮」逐条细化批**（船长 2026-09-24 晚 · 五档壳体 ＋ 四张入侵卡）——本文件钉四件事：
 *
 * 1. **干扰舰的射程压制**（船长三例定死口径，见下面 `describe` 的照抄）：
 *    ① 敌方 1 干扰 ＋ 我方 1 电子 ⇒ 我方射程 **−0.35** · 敌方**不变**
 *    ② 敌方 1 干扰 ＋ 我方 2 电子 ⇒ 我方射程 **−0.2**（乘法合成 0.2775 ⇒ 净 0.2225）· 敌方不变
 *    ③ 敌方 1 干扰 ＋ 我方 1 电子 ＋ 我方射程 **+60%** ⇒ **−0.35+0.6 = +0.25** · 敌方不变
 * 2. **突击舰带 A 族电子舰同款"网子 + 冲锋"**（船长：「添加A族洞内电子舰同款网子和冲锋」）。
 * 3. **四张入侵卡的波表**（船长逐条给定编成）＋ **旗舰卡自带波表不被覆写**（`FoeOverride.keepCardWaves`）。
 * 4. **战巡 1 架 / 母舰 2 架高属性重袭机**（船长：「拥有1架攻坚无人机…属性极高」/「拥有2架…」）。
 */
import { describe, expect, it } from 'vitest'
import { FOE_DRONES, FOE_SHIPS, buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { resolveFoeMounts } from '../src/index'
import type { AnomalyDef, WeaponSpec } from '../src/index'
import {
  activeFoeSpecsOf,
  advanceBattleFor,
  applyFoeOverride,
  applyMeJammerDebuff,
  battleAnomalyOf,
  battleArcsFor,
  createBattleState,
  createFoeSpecs,
  createPlayerSpec,
  foeJammerCountOf,
  foeRangeDebuffOf,
  foeDroneRangeOf,
  foeGunMaxRangeOf,
  meJammerNetOf,
  meRangeMulOf,
  startBattleFor,
} from '../src/combat'

const ctx = buildSimContext()
/** 一条真船（含装配）——"裸武器落点"用例用它，保证 `createPlayerSpec` 拿得到武器 */
const state0 = createInitialState({ nowWallMs: 0, seed: 24 })
state0.shipId = addShipToFleet(state0, 'sh-whiteshark')
/** 敌舰目录（FOE_SHIPS 在 data 包导出，不是 ctx 的字段） */
const shipOf = (id: string) => FOE_SHIPS.find((s) => s.id === id)!
const droneOf = (id: string) => FOE_DRONES.find((d) => d.id === id)!
const bal = ctx.balance.battle

/** 一张入侵卡（它们在 `ANOMALIES` 目录里、`hidden: true`） */
const card = (id: string): AnomalyDef => ctx.anomalies.get(id)!

/** **敌方某件武器的实战最远射程**（与引擎/视图同源的那两个公开算式：机群走 `foeDroneRangeOf`） */
const foeMaxOf = (
  b: Parameters<typeof foeGunMaxRangeOf>[0],
  unit: Parameters<typeof foeGunMaxRangeOf>[1] & { foeRangeDebuffPct?: number },
  w: WeaponSpec,
): number => (w.src === 'drone' ? foeDroneRangeOf(b, w) : foeGunMaxRangeOf(b, unit, w))

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

describe('H 族 · 墨潮干扰舰（射程压制 · 船长三例定死口径）', () => {
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
   * **船长三例（照抄，口径就按这三条钉死）**：
   * - ①「敌方1艘干扰，我方1艘电子，最终结果是我方射程 **-0.35**，**敌方不变**」
   * - ②「敌方1艘干扰，我方2艘电子，最终结果是我方射程 **-0.2**，敌方不变」
   * - ③「敌方1艘干扰，我方1艘电子，我方有射程增加60%效果，最终结果是我方射程 **-0.35+0.6=+0.25**，敌方不变」
   *
   * 引擎口径 = **先各自乘法合成、再相减取净**：`净 = 1−Π(1−vᵢ)（敌） − 1−Π(1−vᵢ)（我）`，
   * 我方射程倍率 = `1 + 我方射程加成 − 净`；**敌方射程一点不动**。
   */
  it('例①：敌方 1 干扰（50%）＋ 我方 1 电子（15%）⇒ **我方射程 −0.35**（倍率 ×0.65）', () => {
    const foes = specsOf('foe-h-ink-jammer')
    const battle = createBattleState(specsOf('foe-h-ink-corvette')[0]!, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 0.15 // 我方 1 艘电子舰（`meFoeRangeDebuffOf` 的合成本值）
    expect(meJammerNetOf(battle, foes)).toBeCloseTo(0.35, 10)
    expect(meRangeMulOf(battle, foes)).toBeCloseTo(0.65, 10)
  })

  it('例②：敌方 1 干扰 ＋ 我方 2 电子（0.2775）⇒ 净 **0.2225**（船长原句的 "−0.2" 已当场更正为举例错误）', () => {
    /**
     * ⚠ 船长 2026-09-24 当场更正：「**例②是我举例错误**」⇒ 引擎按**乘法合成**算：
     * 电子舰每艘 15% ⇒ 2 艘 = 27.75%（不是 30%），净 = 0.50 − 0.2775 = **0.2225**（倍率 ×0.7775）。
     * 这处差值是"例②本身不成立"，不是引擎偏差（例①③逐字命中）。
     */
    const foes = specsOf('foe-h-ink-jammer')
    const battle = createBattleState(specsOf('foe-h-ink-corvette')[0]!, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 1 - 0.85 * 0.85 // 我方 2 艘电子舰
    expect(battle.meFoeRangeDebuff).toBeCloseTo(0.2775, 10)
    expect(meJammerNetOf(battle, foes)).toBeCloseTo(0.2225, 10)
    expect(meRangeMulOf(battle, foes)).toBeCloseTo(0.7775, 10)
  })

  it('例③：上面①②任一情形 ＋ 我方射程 +60% ⇒ **−0.35+0.6 = +0.25**（倍率 ×1.25）', () => {
    const foes = specsOf('foe-h-ink-jammer')
    const battle = createBattleState(specsOf('foe-h-ink-corvette')[0]!, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 0.15
    /**
     * 引擎侧落点：武器上的 `maxRangeM` **已经乘过** `(1+0.6)`（谜质/模块那条加法链），
     * 所以这里要的是"把它还原成加法"的系数 `(1+0.6−0.35)/(1+0.6) = 0.78125` ⇒ 终值 ×1.6×0.78125 = **×1.25**。
     */
    const mul = meRangeMulOf(battle, foes, 0.6)
    expect(mul).toBeCloseTo(0.78125, 10)
    expect(1.6 * mul).toBeCloseTo(1.25, 10) // = 1 + 0.6 − 0.35 ✓
  })

  it('**敌方射程完全不变**（三例都写"敌方不变"）⇒ 干扰只压我方，`foeGunMaxRangeOf` 那条链一个字节不动', () => {
    const foes = specsOf('foe-h-ink-jammer')
    const before = foes.map((f) => f.weapons.map((w) => w.maxRangeM))
    const battle = createBattleState(specsOf('foe-h-ink-corvette')[0]!, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 0.15
    // 干扰压制**不改任何敌方武器的射程字段**（我方电子舰那条老机制另算：它读 `meFoeRangeDebuff`）
    expect(foes.map((f) => f.weapons.map((w) => w.maxRangeM))).toEqual(before)
    // 且压制只由"敌方干扰舰数 > 我方电子舰数"这一件事决定：我方的电子舰多于干扰舰 ⇒ 不再加射程（夹 0）
    battle.meFoeRangeDebuff = 0.6
    expect(meJammerNetOf(battle, foes)).toBe(0)
    expect(meRangeMulOf(battle, foes)).toBe(1)
    // 没有干扰舰的敌阵 ⇒ 我方射程 ×1（哪怕我方带电子舰）
    expect(meRangeMulOf(battle, specsOf('foe-h-ink-corvette'))).toBe(1)
  })

  it('**裸武器（无射程加成）**：`applyMeJammerDebuff` 的系数就是 `1 − 净`（例①②的落点）', () => {
    const me = createPlayerSpec(state0, ctx, state0.shipId)!
    expect(me.weapons.length).toBeGreaterThan(0)
    const foes = specsOf('foe-h-ink-jammer')
    const battle = createBattleState(me, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 0.15
    const before = me.weapons.map((w) => w.maxRangeM)
    applyMeJammerDebuff(me, meRangeMulOf(battle, foes, 0))
    me.weapons.forEach((w, i) => {
      expect(w.maxRangeM).toBe(Math.max(2, Math.round(before[i]! * 0.65)))
    })
  })

  /**
   * **端到端**（引擎真实路径，不走纯函数）：拿主力舰队卡真打，逐拍看规格。
   * - 第 0 波（突击舰 ×3，无干扰舰）⇒ **我方武器射程一点不变**（净 0 ⇒ ×1）；
   * - 推进到第 1 波（**干扰舰入场**）⇒ 我方武器射程 = `基础 × 0.65`（例①口径，我方 1 艘电子舰）；
   * - 同时**敌方武器射程逐字不变**（"敌方不变"）；换班时必须换了（否则这条用例白测）。
   */
  it('端到端：视图射程弧可读（干扰舰入场前 = 基础、入场后 ×0.65、敌方一直不变）', () => {
    const ws = createInitialState({ nowWallMs: 0, seed: 31 })
    /** 电子舰（`sh-wh-a-frigate` 带 `foeRangeDebuffPct 0.15`：主控是它 ⇒ 编队里 1 艘电子舰） */
    const ew = addShipToFleet(ws, 'sh-wh-a-frigate')
    ws.shipId = ew
    ws.fleet[ew]!.fitted = { high: ['mod-turret-kin-2', 'mod-turret-kin-2'], mid: [], low: [] }
    /**
     * ⚠ 本用例要看的是**射程**、不是输赢：电子舰血薄，第一波就可能被打死（战斗判负 ⇒ 干扰舰那一波永远
     * 进不了场）。这里把场间残伤乘数调成负数 ⇒ 开局血量是满值的十几倍（血量与干扰的射程算式无关）。
     */
    ws.fleet[ew]!.armorPct = -8
    ws.fleet[ew]!.durability = -8
    const b = startBattleFor(ws, ctx, ew, 'ink-main', 0)!
    /**
     * 视图入参 = **引擎用的同一份敌卡**（真实界面也这么传：见 `BattleScreen` 的 `whView.anomaly`）
     * ⚠ 不能直接塞 `card('ink-main')` 那张原卡——引擎逐拍走的是 `battleAnomalyOf(...)`（窝点/派系派生后的卡）。
     */
    const engineCard = battleAnomalyOf(ctx, 'ink-main', ws.expedition.lairTier, ws.expedition.factionActive)!
    const arcsNow = () => battleArcsFor(ws, ctx, { battle: b, anomaly: engineCard, leaderShipId: ew })!
    const base = arcsNow().me.map((m) => m.maxM)
    expect(base.length).toBeGreaterThanOrEqual(2)
    expect(b.meFoeRangeDebuff).toBeCloseTo(0.15, 10) // 主控就是电子舰
    /** **干扰舰那一波**的敌阵规格（与引擎同源：同一张卡的同一波、同一 `hpShare`） */
    const wave1 = activeFoeSpecsOf(engineCard, bal, 1)
    expect(foeJammerCountOf(wave1)).toBe(1)
    expect(meJammerNetOf(b, wave1)).toBeCloseTo(0.35, 10) // 例①：0.50 − 0.15
    expect(foeJammerCountOf(activeFoeSpecsOf(engineCard, bal, 0))).toBe(0) // 第 0 波没有干扰舰

    let sawJammer = false
    for (let i = 0; i < 2000; i++) {
      ws.gameMs += 100
      advanceBattleFor(ws, ctx, b, ew, 'ink-main')
      if ((b.waveIdx ?? 0) >= 1) {
        sawJammer = true
        /** 净 = 0.50 − 0.15 = **0.35**（船长例①）⇒ 每件武器 = 基础 × 0.65（逐件同序） */
        const v = arcsNow()
        expect(v.me.map((m) => m.maxM).length).toBe(base.length)
        v.me.forEach((m, i) => expect(m.maxM).toBe(Math.max(2, Math.round(base[i]! * 0.65))))
        /**
         * **敌方射程一成不变**（三例都写「敌方不变」）——两条分开钉：
         * ① **干扰舰自己没有动敌方的射程**：把战斗态里"我方电子舰那条削减"清掉（`meFoeRangeDebuff = 0`）
         *    ⇒ 干扰舰那门炮的有效射程 = **原值一点没减**；
         * ② 留着电子舰的状态下，视图那条聚合带上界 = 本波敌阵按引擎同一算式算出的最大值
         *    （本场敌方射程缩短**只**来自我方 15% 那条老机制，干扰舰不在其中）。
         */
        const noEw = { ...b, meFoeRangeDebuff: 0 } as typeof b
        const jammer = wave1.find((f) => (f.foeRangeDebuffPct ?? 0) > 0)!
        for (const w of jammer.weapons) expect(foeGunMaxRangeOf(noEw, jammer, w)).toBe(w.maxRangeM)
        expect(v.foe.maxM).toBe(Math.max(...wave1.flatMap((f) => f.weapons.map((w) => foeMaxOf(b, f, w)))))
        break
      }
      if (b.ended) break
    }
    expect(sawJammer, `干扰舰那一波没进到 ⇒ 这条用例白测（ended=${b.ended} waveIdx=${b.waveIdx}）`).toBe(true)
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
