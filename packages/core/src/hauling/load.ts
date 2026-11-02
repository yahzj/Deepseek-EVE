import type { GameState } from '../state'
import type { SimContext } from '../types'
import { freeCargoM3Of } from '../inventory'

export interface HaulFleetLoad {
  capacityM3: number
  loadedM3: number
  byShip: { shipId: string; availableM3: number; loadedM3: number }[]
}

/** 实体货物保留；整数虚拟m³按可用空间比例分配，余量按实例顺序稳定分发。 */
export function haulFleetLoadOf(state: GameState, ctx: SimContext, ids: readonly string[], requestedM3?: number): HaulFleetLoad {
  const byShip = [...new Set(ids)].map(shipId => {
    if (!state.fleet[shipId]) throw new Error(`hauling-load-missing-ship:${shipId}`)
    return { shipId, availableM3: freeCargoM3Of(state, ctx, shipId), loadedM3: 0 }
  })
  const total = byShip.reduce((sum, row) => sum + row.availableM3, 0)
  const capacityM3 = Math.floor(total)
  const loadedM3 = requestedM3 ?? capacityM3
  if (!Number.isSafeInteger(loadedM3) || loadedM3 < 0 || loadedM3 > capacityM3) throw new Error('hauling-load-invalid-volume')
  if (!loadedM3) return { capacityM3, loadedM3, byShip }
  const shares = byShip.map((row, index) => {
    const ideal = loadedM3 * row.availableM3 / total
    row.loadedM3 = Math.floor(ideal)
    return { index, fraction: ideal - row.loadedM3 }
  }).sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  let left = loadedM3 - byShip.reduce((sum, row) => sum + row.loadedM3, 0)
  for (const share of shares) {
    const row = byShip[share.index]!
    const assigned = Math.min(1, left, Math.max(0, row.availableM3 - row.loadedM3))
    row.loadedM3 += assigned
    left -= assigned
  }
  if (left > 1e-7) throw new Error('hauling-load-allocation-failed')
  return { capacityM3, loadedM3, byShip }
}
