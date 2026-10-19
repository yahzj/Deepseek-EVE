import { afterEach, describe, expect, it, vi } from 'vitest'
import * as grids from '../src/wormholeGrid'
import { wormholeAutoDescend } from '../src/wormholeAutoSim'
import { WORMHOLE_PILE_UNITS_BASE } from '../src/wormhole'

const makeGrid = grids.wormholeMakeGrid
function run(place: 'vein' | 'graveyard', rigs: number, holdM3 = 1e9) {
  vi.spyOn(grids, 'wormholeMakeGrid').mockImplementation((...args) => {
    const grid = makeGrid(...args)
    for (const cell of grid.cells) cell.place = 'empty'
    const target = grid.cells.find(cell => !grids.isExitCell(grid, cell)
      && grids.hexDistance(grid.start, cell) === 1)!
    target.place = place
    return grid
  })
  return wormholeAutoDescend({ seed: 71, startDepth: 9, totalMass: 0, holdM3,
    miners: rigs, salvagers: rigs, scanRadius: 100, power: { dps: 1, ehp: 1 },
    guardPowerOf: () => ({ dps: 1e12, ehp: 1e12 }), tech: { ore: 1, wreck: 1 } })
}
afterEach(() => vi.restoreAllMocks())
describe('自动探索深层堆数与真实批量', () => {
  it.each(['vein', 'graveyard'] as const)('%s每动作按设备数收堆，末批不补满、同点收益与台数无关', place => {
    const one = run(place, 1)
    const many = run(place, 100)
    expect(many.oreUnits).toBe(one.oreUnits)
    expect(many.wreckM3).toBe(one.wreckM3)
    const units = place === 'vein' ? many.oreUnits : many.wreckM3
    const base = place === 'vein' ? WORMHOLE_PILE_UNITS_BASE : 200
    const min = place === 'vein' ? 9 : 11
    const max = place === 'vein' ? 11 : 18
    expect(units).toBeGreaterThanOrEqual(Math.floor(min * base * 1.08 ** 8 * .8 * .8))
    expect(units).toBeLessThanOrEqual(Math.ceil(max * (base * 1.08 ** 8 * 1.2 + 1) * .8))
    expect(many.depthReached).toBe(9)
  })
  it.each(['vein', 'graveyard'] as const)('%s深层大批次仍受实际货舱约束', place => {
    const result = run(place, 100, 10)
    expect(result.holdFull).toBe(true)
    expect(result.oreUnits * .5 + result.wreckM3).toBeLessThanOrEqual(10)
  })
})
