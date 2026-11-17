import { ceilFinalQuantity } from '../../quantity'
import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { addWare, countWare, removeWare } from '../../inventory'
import { DEEP_SPACE_PROBE_BLUEPRINT_ID, probeMaterialFactor } from '../../probeManufacturing'
import type { BuildSpec } from './blueprints'

export function materialFactor(state: GameState): number {
  const lv1 = Math.min(5, state.skills.trained['materials'] ?? 0)
  const lv2 = Math.min(5, state.skills.trained['component-standardization'] ?? 0)
  return Math.max(0.7, (1 - 0.015 * lv1) * (1 - 0.008 * lv2))
}

export function matNeedCount(state: GameState, count: number, blueprintId?: string): number {
  const probeFactor = blueprintId === DEEP_SPACE_PROBE_BLUEPRINT_ID ? probeMaterialFactor(state) : 1
  return Math.max(1, ceilFinalQuantity(count * materialFactor(state) * probeFactor))
}

export function spendMaterialsFor(
  state: GameState,
  materials: readonly { itemId: string; count: number }[],
  spent: { itemId: string; count: number }[],
  blueprintId: string,
): boolean {
  const taken: { itemId: string; count: number }[] = []
  const rollback = (): void => {
    for (const t of taken) addWare(state, t.itemId, t.count)
  }
  for (const need of materials) {
    let left = matNeedCount(state, need.count, blueprintId)
    for (const id of materialGroupIdsOf(need.itemId)) {
      if (left <= 0) break
      const take = Math.min(countWare(state, id), left)
      if (take <= 0) continue
      if (!removeWare(state, id, take)) {
        rollback()
        return false
      }
      taken.push({ itemId: id, count: take })
      left -= take
    }
    if (left > 0) {
      rollback()
      return false
    }
  }
  spent.push(...taken)
  return true
}

export const MATERIAL_GROUPS: readonly (readonly string[])[] = [
  ['blackbox-universal', 'blackbox-h', 'blackbox-r', 'blackbox-c', 'blackbox-d'],
]

export function materialGroupIdsOf(itemId: string): readonly string[] {
  for (const g of MATERIAL_GROUPS) {
    if (g.includes(itemId)) return g
  }
  return [itemId]
}

export function materialDisplayIdOf(state: GameState, itemId: string): string {
  const ids = materialGroupIdsOf(itemId)
  if (ids.length === 1) return itemId
  for (const id of ids) {
    if (countWare(state, id) > 0) return id
  }
  return ids[0]!
}

export function missingMaterials(state: GameState, ctx: SimContext, spec: BuildSpec, blueprintId?: string): string[] {
  const missing: string[] = []
  for (const need of spec.materials) {
    const needCount = matNeedCount(state, need.count, blueprintId)
    const ids = materialGroupIdsOf(need.itemId)
    const have = ids.reduce((sum, id) => sum + countWare(state, id), 0)
    if (have < needCount) {
      const displayId = materialDisplayIdOf(state, need.itemId)
      const name = ctx.items.get(displayId)?.name ?? displayId
      missing.push(`${name} 还差 ${(needCount - have).toLocaleString('zh-CN')} 单位`)
    }
  }
  return missing
}
