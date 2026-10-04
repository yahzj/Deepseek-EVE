import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { advanceSalvageOp, pullOneWreck, salvagerCyclesOf, startSalvageOp, wreckUnitsOf } from '../src/salvaging'
import { injectWeekendWreck, injectWeekendRareWreck, weekendWreckDensityOf, WRECK_FLOOR, advanceWreckDrift, WEEKEND_WRECK_DECAY_MS } from '../src/salvage'
import { addShipToFleet } from '../src/shipyard'
import { assignAiSalvage, advanceAi } from '../src/ai'
import { countItem } from '../src/inventory'

const ctx = buildSimContext()
const galaxy = 'galaxy-hub'
function world(galaxyId: string, amount: number, level = 0, family: 'H' | 'R' = 'H') {
  const state = createInitialState({ nowWallMs: 0, seed: 42 })
  state.skills.trained['salvage-diving'] = level
  if (amount > 0) injectWeekendWreck(state, galaxyId, amount, family)
  return state
}

describe('入侵普通打捞：基准速度与有限库存分离', () => {
  it.each([0,5])('技能Lv%s 全星系普通基线平均吞吐对照', (level) => {
    for (const gal of ctx.galaxies.values()) {
      if (![...ctx.anomalies.values()].some((a) => !a.hidden && a.galaxyId === gal.id)) continue
      const normal = world(gal.id, 0, level)
      const invading = world(gal.id, 1e9, level)
      let total = 0
      const rounds = 3000
      for (let i = 0; i < rounds; i++) {
        // 每次恢复到基础状态，测基线而不是普通场作业中的逐轮耗竭。
        normal.galaxyWrecks = {}
        total += wreckUnitsOf(pullOneWreck(normal, ctx, gal.id, 10_000)!.volumeM3)
      }
      const volume = pullOneWreck(invading, ctx, gal.id, 10_000)!.volumeM3
      const average = total / rounds
      expect(volume / average, gal.name).toBeGreaterThan(0.94)
      expect(volume / average, gal.name).toBeLessThan(1.06)
      if (level === 0 && ['galaxy-hub','galaxy-grave','galaxy-redring'].includes(gal.id)) {
        console.log(`[吞吐] ${gal.name} 单台MK1：普通基线 ${(average * 6).toFixed(1)} / 入侵 ${volume * 6} m³/分钟`)
      }
    }
  })

  it('大小池、入侵族与临时星系密度不改变完整一轮速度', () => {
    const pulls = [1000,10000,100000].flatMap((amount) => (['H','R'] as const).map((family) => {
      const state = world(galaxy, amount, 5, family)
      state.galaxyWrecks[galaxy] = { density: family === 'H' ? 10 : 1e6, rare: 0 }
      const before = JSON.stringify(state.galaxyWrecks)
      const out = pullOneWreck(state, ctx, galaxy, 10_000)!
      expect(JSON.stringify(state.galaxyWrecks)).toBe(before)
      expect(weekendWreckDensityOf(state, galaxy)).toBe(amount - out.volumeM3)
      return out.volumeM3
    }))
    expect(new Set(pulls).size).toBe(1)
  })

  it('大池有限时间见底，整数池入舱量与库存严格相等，末轮不减速', () => {
    const site = 'galaxy-redring'
    const state = world(site, 10000)
    let sum = 0
    const full = pullOneWreck(world(site, 10000), ctx, site, 10_000)!.volumeM3
    let rounds = 0
    while (weekendWreckDensityOf(state, site) > 0 && rounds < 10000) {
      const before = weekendWreckDensityOf(state, site)
      const out = pullOneWreck(state, ctx, site, 10_000)!
      expect(out.volumeM3).toBe(Math.min(full, before))
      sum += wreckUnitsOf(out.volumeM3)
      expect(before - weekendWreckDensityOf(state, site)).toBe(out.volumeM3)
      rounds++
    }
    expect(sum).toBe(10000)
    expect(weekendWreckDensityOf(state, site)).toBe(0)
    expect(rounds).toBe(Math.ceil(10000 / full))
    console.log(`[捞光] 红环10000 m³，${full} m³/轮，${rounds}轮见底`)
    expect(pullOneWreck(state, ctx, site, 10_000)!.itemId).not.toBe('wreck-h-hi')
  })

  it('货仓限制或满仓不超扣，小数尾轮保留兜底', () => {
    const rich = 'galaxy-redring'
    const state = world(rich, 100)
    const out = pullOneWreck(state, ctx, rich, 10_000, 3)!
    expect(out.volumeM3).toBe(3)
    expect(weekendWreckDensityOf(state, rich)).toBe(97)
    pullOneWreck(state, ctx, rich, 10_000, 0)
    expect(weekendWreckDensityOf(state, rich)).toBe(97)
    const tail = world(galaxy, 0.6)
    const last = pullOneWreck(tail, ctx, galaxy, 10_000)!
    expect(last.volumeM3).toBe(0.6)
    expect(wreckUnitsOf(last.volumeM3)).toBe(1)
    expect(weekendWreckDensityOf(tail, galaxy)).toBe(0)
  })

  it('两族混池按来源扣账；稀有轮不扣普通池；闲置衰减和普通保底保留', () => {
    const state = world(galaxy, 1000)
    injectWeekendWreck(state, galaxy, 2000, 'R')
    injectWeekendRareWreck(state, galaxy, 'corona-converge', 1)
    const before = JSON.stringify(state.weekendWrecks?.[galaxy]?.byFamily)
    expect(pullOneWreck(state, ctx, galaxy, 10_000)!.volumeM3).toBe(30)
    expect(weekendWreckDensityOf(state, galaxy)).toBe(3000)
    const out = pullOneWreck(state, ctx, galaxy, 10_000)!
    const family = out.itemId === 'wreck-h-hi' ? 'H' : 'R'
    expect(state.weekendWrecks![galaxy]!.byFamily![family]!.density).toBe((family === 'H' ? 1000 : 2000) - out.volumeM3)
    expect(before).not.toBe(JSON.stringify(state.weekendWrecks?.[galaxy]?.byFamily))
    const idle = world(galaxy, 1000)
    advanceWreckDrift(idle, ctx, WEEKEND_WRECK_DECAY_MS / 2)
    expect(weekendWreckDensityOf(idle, galaxy)).toBe(500)
    const ordinary = world(galaxy, 0)
    ordinary.galaxyWrecks[galaxy] = { density: WRECK_FLOOR, rare: 0 }
    pullOneWreck(ordinary, ctx, galaxy, 10_000)
    expect(ordinary.galaxyWrecks[galaxy]!.density).toBe(WRECK_FLOOR)
  })

  it.each(['mod-salvager-1','mod-salvager-2','mod-salvager-3'])('%s 主控与AI按设备周期/效率取相同单轮量', (rig) => {
    const state = world(galaxy, 1e6)
    state.debugQuick = true
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.skills.trained['ai-expert'] = 5
    const pilot = state.fleet[state.shipId]!
    pilot.fitted.high = [rig,rig]
    const expected = pullOneWreck(world(galaxy, 1e6), ctx, galaxy, 10_000)!.volumeM3
    expect(startSalvageOp(state, galaxy, ctx).ok).toBe(true)
    const cycles = salvagerCyclesOf(state, ctx, state.shipId)
    advanceSalvageOp(state, cycles[0]!, ctx)
    expect(countItem(state, 'wreck-h-hi')).toBe(expected * 2)
    const ai = world(galaxy, 1e6)
    ai.debugQuick = true
    ai.exploredGalaxies = [...ctx.galaxies.keys()]
    ai.skills.trained['ai-expert'] = 5
    ai.aiCores.basic = 1
    const ship = addShipToFleet(ai, pilot.defId!)
    ai.fleet[ship]!.fitted.high = [rig,rig]
    expect(assignAiSalvage(ai, ship, 'basic', galaxy, ctx).ok).toBe(true)
    const assignment = ai.aiAssignments[ship]!
    expect(assignment.task.kind).toBe('salvage')
    if (assignment.task.kind !== 'salvage') return
    assignment.task.phase = 'salvaging'
    advanceAi(ai, cycles[0]! / 0.4, ctx)
    expect(ai.fleet[ship]!.cargo['wreck-h-hi']).toBe(expected * 2)
  })
})
