/**
 * E 族「泰坦巨构」专属装备·第一件修订（2026-09-10 船长定：先修订 E1、数值按「略高于 MK3」）：
 * **巨构残骸炮** = 十秒一发的巨构重锤——装填拉到 10 秒（船长指定），
 * 名义 DPS 保持 **攻坚炮台 MK3 的 109.5%**（1.91/秒），故单发倍率拉到 **19.1**（= MK3 单发的 3.72 倍）；
 * 远端衰减 **0.1**（越远越打不中，射程带尽头几近失的）、基础命中 0.70、CPU 只剩 **22**。
 * 定位 = 便宜、慢、单发极重的爆炸系换血炮；与 D 族「守墓者长炮」（12 km 必中、总输出 MK3 的 90%）分工互不重叠。
 * 注：E2/E3 两件尚未过审，本轮不动。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { createPlayerSpec } from '../src/combat'
import { FOE_LAIR_GEAR } from '../src/lairs'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const SHIP = 'sh-mako' // 灰鲭鲨：高 4 / 中 3 / 低 2，CPU 195

function makeState(high: string[] = [], mid: string[] = [], low: string[] = []): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 9 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  state.fleet[uid]!.fitted = {
    high: [...high, null, null, null, null].slice(0, 4) as (string | null)[],
    mid: [...mid, null, null, null].slice(0, 3) as (string | null)[],
    low: [...low, null, null].slice(0, 2) as (string | null)[],
  }
  return state
}

const dps = (m: { dmgMult?: number; reloadMs?: number }): number => (m.dmgMult ?? 0) / (m.reloadMs ?? 1)

describe('E 族巨构残骸炮修订（2026-09-10 船长：装填 10 秒 / 保住 DPS / 衰减 0.1 / CPU 22）', () => {
  it('E 族池仍是单件（E2/E3 未过审，本轮不动）', () => {
    expect(FOE_LAIR_GEAR.E).toEqual(['mod-lair-turret-e'])
  })

  it('装填拉长到 10 秒，单发同比抬高——名义 DPS = 攻坚炮台 MK3 的 109.5%', () => {
    const e1 = ctx.modules.get('mod-lair-turret-e')!
    const mk3 = ctx.modules.get('mod-turret-kin-3')!
    expect(e1.reloadMs).toBe(10_000)
    expect(e1.dmgMult).toBe(19.1)
    // 单发 = MK3 的 3.72 倍
    expect(e1.dmgMult! / mk3.dmgMult!).toBeCloseTo(3.723, 2)
    // 装填 = MK3 的 3.40 倍
    expect(e1.reloadMs! / mk3.reloadMs!).toBeCloseTo(3.401, 2)
    // 总输出：略高于 MK3（+9.5%）
    const ratio = dps(e1) / dps(mk3)
    expect(ratio).toBeCloseTo(1.0946, 3)
    expect(ratio).toBeGreaterThan(1.05)
    expect(ratio).toBeLessThan(1.15)
  })

  it('远端衰减 0.1（越远越打不中）、基础命中 0.70、CPU 22', () => {
    const e1 = ctx.modules.get('mod-lair-turret-e')!
    expect(e1.falloff).toBe(0.1)
    expect(e1.hitRate).toBe(0.7)
    expect(e1.cpuUse).toBe(22)
    // 便宜得离谱：比 MK3 的一半还低
    expect(ctx.modules.get('mod-turret-kin-3')!.cpuUse!).toBeGreaterThan(22 * 2)
    // 与 D 族守墓者长炮的分工：E 射程更近、命中更低、衰减更差，但名义输出更高
    const d2 = ctx.modules.get('mod-lair-turret-d')!
    expect(e1.maxRangeM!).toBeLessThan(d2.maxRangeM!)
    expect(e1.hitRate!).toBeLessThan(d2.hitRate!)
    expect(e1.falloff!).toBeLessThan(d2.falloff!)
    expect(dps(e1)).toBeGreaterThan(dps(d2))
  })

  it('进战斗：射程带 / 命中 / 衰减 / 装填原样落地，弹种仍为爆炸系', () => {
    const state = makeState(['mod-lair-turret-e'])
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const w = spec.weapons.find((x) => x.src === 'turret')!
    expect(w.label).toBe('巨构残骸炮')
    expect(w.kind).toBe('gun')
    expect(w.hitRate).toBeCloseTo(0.7, 6)
    expect(w.falloff).toBeCloseTo(0.1, 6)
    expect(w.maxRangeM).toBe(9600)
    expect(w.minRangeM).toBe(900)
    expect(w.reloadMs).toBe(10_000)
    expect(Object.keys(w.shotsByType ?? {})).toEqual(['explosive'])
    expect(w.shotsByType!.explosive).toBeGreaterThan(0)
  })

  it('装填技术学缩短 10 秒长装填（−4%/级，与其它炮台同链）', () => {
    const state = makeState(['mod-lair-turret-e'])
    state.skills.trained['reload-drills'] = 5
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const w = spec.weapons.find((x) => x.src === 'turret')!
    expect(w.reloadMs).toBe(Math.max(100, Math.round(10_000 * 0.8)))
  })
})
