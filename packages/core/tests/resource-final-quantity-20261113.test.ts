import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { createCommandReadyState } from './helpers/command-ready'
import { makeTestCtx, ship } from './helpers'
import { finishDeparture } from './helpers/departure-ready'
import { addShipToFleet } from '../src/fleetBook'
import { getMiningParams } from '../src/mining'
import { advanceAiMining } from '../src/ai/mining'
import { aiEfficiency } from '../src/ai/cores'
import { cargoUsedM3Of } from '../src/inventory'
import { signalAutoEstimateOf } from '../src/signalAuto/estimate'
import { cleanSignalAutoEstimate } from '../src/signalAuto/save'
import { wormholeAutoTechFactors } from '../src/wormholeAuto'
import { wormholeEnter } from '../src/wormhole'
import { gridCellAt } from '../src/wormholeGrid'
import { wormholeEnsureSalvagePiles } from '../src/wormholeSalvage'
import { RARE_WRECK_VOLUME_M3 } from '../src/salvage'
import * as tuning from '../src/tuning'
import * as guard from '../src/signalAuto/guard'

const ctx = buildSimContext()
afterEach(() => vi.restoreAllMocks())

function autoWorld() {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const ids = [addShipToFleet(state, 'sh-nautilus')]
  state.fleet[ids[0]!]!.fitted.high = ['mod-miner-1', 'mod-salvager-1']
  vi.spyOn(guard, 'signalAutoGuardBattleOf').mockReturnValue({ cardId: 'guard-test', outcome: 'defeat', durationMs: 1000 })
  const tech = wormholeAutoTechFactors(state, ctx, ids)
  const estimate = (rate: number, hold = 1e9) => signalAutoEstimateOf(state, ctx, ids,
    { seed: 19, depth: 2, family: 'A', archetype: 'balanced' }, rate, tech, hold)
  return { state, estimate }
}

describe('资源最终结算向上取整与容量边界', () => {
  it('自动探索普通资源在最终乘链后向上取整，逐层报告与快照同量', () => {
    const { state, estimate } = autoWorld()
    const before = structuredClone(state)
    // 同一路线与随机流，仅改变末端收成系数，构造精确的两件与不足一件产出。
    const reference = estimate(1)
    const ore = reference.gains.find(row => row.itemId === 'ore-voidmother')!.units
    const nearTwo = estimate(1.1 / ore)
    expect(nearTwo.gains.find(row => row.itemId === 'ore-voidmother')!.units).toBe(2)
    const tiny = estimate(1e-12)
    expect(tiny.gains.find(row => row.itemId === 'ore-voidmother')!.units).toBe(1)
    expect(tiny.gains.find(row => row.itemId === 'wreck-a-wh')!.units).toBe(1)
    for (const result of [nearTwo, tiny]) {
      expect(cleanSignalAutoEstimate(result)).toEqual(result)
      const totals = new Map<string, number>()
      for (const layer of result.report!.layers) for (const gain of layer.gains)
        totals.set(gain.itemId, (totals.get(gain.itemId) ?? 0) + gain.units)
      expect([...totals].sort()).toEqual(result.gains.map(gain => [gain.itemId, gain.units]).sort())
    }
    expect(state).toEqual(before)
  })

  it.each([1, 2, 3, 10, 100])('自动探索货舱 %s m3：件数取整不能突破可装上限', hold => {
    const { estimate } = autoWorld()
    for (const rate of [.8, 1]) {
      const result = estimate(rate, hold)
      const used = result.gains.filter(row => row.itemId === 'ore-voidmother' || row.itemId === 'wreck-a-wh')
        .reduce((sum, row) => sum + row.units * ctx.items.get(row.itemId)!.unitM3, 0)
      expect(used).toBe(result.ordinaryUsedM3)
      expect(used).toBeLessThanOrEqual(hold)
      expect(cleanSignalAutoEstimate(result)).toEqual(result)
      expect(result.gains.every(row => Number.isSafeInteger(row.units) && row.units > 0)).toBe(true)
    }
  })

  it('自动探索的稀有数量倍率逐次产出取整，不改变命中次数或其他奖励', () => {
    const { estimate } = autoWorld()
    const baseline = estimate(10)
    const original = tuning.tuningMul
    vi.spyOn(tuning, 'tuningMul').mockImplementation((state, key) => key === 'rareWreckVolume' ? 1.01 : original(state, key))
    const changed = estimate(10)
    const rare = baseline.gains.find(row => row.itemId.startsWith('wreck-rare-'))!
    expect(rare).toBeDefined()
    expect(changed.gains.find(row => row.itemId === rare.itemId)!.units)
      .toBe(rare.units / RARE_WRECK_VOLUME_M3 * 31)
    expect(changed.gains.filter(row => row.itemId !== rare.itemId)).toEqual(baseline.gains.filter(row => row.itemId !== rare.itemId))
    expect(changed.cores).toEqual(baseline.cores)
    expect(cleanSignalAutoEstimate(changed)).toEqual(changed)
  })

  it.each(['graveyard', 'ruins'] as const)('虫洞 %s 的稀有堆数量已取整，概率与重复到达不变', place => {
    const state = createCommandReadyState({ nowWallMs: 0, seed: 4242 })
    const id = addShipToFleet(state, 'sh-thresher')
    state.shipId = id
    expect(wormholeEnter(state, ctx, [id], 4242).ok).toBe(true)
    finishDeparture(state, ctx)
    const run = state.wormhole.run!
    const cell = gridCellAt(run.grid!, run.grid!.pos)!
    cell.place = place
    cell.piles = []
    run.grid!.activated = run.grid!.activated.filter(key => key !== cell.key)
    delete cell.resourcePilesGenerated
    const baseline = structuredClone(state)
    const baseCell = gridCellAt(baseline.wormhole.run!.grid!, baseline.wormhole.run!.grid!.pos)!
    wormholeEnsureSalvagePiles(baseline, baseCell)
    const original = tuning.tuningMul
    vi.spyOn(tuning, 'tuningMul').mockImplementation((s, key) => key === 'rareWreckVolume' ? 1.01 : original(s, key))
    wormholeEnsureSalvagePiles(state, cell)
    expect(cell.piles).toEqual(baseCell.piles!.map(pile => ({ ...pile,
      units: pile.itemId.startsWith('wreck-rare-') ? 31 : pile.units })))
    const piles = structuredClone(cell.piles)
    wormholeEnsureSalvagePiles(state, cell)
    expect(cell.piles).toEqual(piles)
  })

  it('AI 富矿循环按实际可装整件封顶，统计不超发，拆步推进等价', () => {
    const c = makeTestCtx({ quietEvents: true, marketGoods: [],
      ships: [ship('sandcat', { cargo: 25, perCycle: 10.1 })] })
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    const id = addShipToFleet(state, [...c.ships.keys()][0]!)
    const params = getMiningParams(state, c, { shipId: id, beltId: 'belt-a' })!
    expect(params.unitsPerCycle).toBe(11)
    state.aiAssignments[id] = { coreType: 'basic', startedAtGameMs: 0,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0, rvLeft: 1 } }
    const split = structuredClone(state)
    const cycle = Math.ceil(params.cycleMs / aiEfficiency(state, c, 'basic'))
    advanceAiMining(state, id, state.aiAssignments[id]!, cycle, c)
    advanceAiMining(split, id, split.aiAssignments[id]!, cycle - 1, c)
    expect(split.fleet[id]!.cargo).toEqual({})
    advanceAiMining(split, id, split.aiAssignments[id]!, 1, c)
    expect(cargoUsedM3Of(state, c, id)).toBe(25)
    expect(state.firstStats!.mineUnits).toBe(25)
    expect(state.aiAssignments[id]!.task).toMatchObject({ tripUnits: 25 })
    expect(split.fleet[id]!.cargo).toEqual(state.fleet[id]!.cargo)
    expect(split.aiAssignments[id]).toEqual(state.aiAssignments[id])
    expect(split.rng).toEqual(state.rng)
  })
})
