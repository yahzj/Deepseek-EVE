/** 战前只读弹药预览：复用实战规格与装载，不反向引入到combat。 */
import type { GameState } from './state'
import type { DamageType, SimContext } from './types'
import { applyMatterPlayerBuffs } from './combat'
import { createPlayerSpec } from './playerSpec'
import { ammoLoadTotals, loadAmmoTier, resolveAmmoTier, wormholeAmmoIdsForSpec } from './combatAmmo'
import { wormholeMatterBuffs } from './wormholeMatter'
import { matterTechWhBuffs } from './matterTech'

export interface BattleAmmoPreloadRow {
  shipId: string
  type: DamageType
  itemId: string
  need: number
  can: number
  missing: number
}
export interface BattleAmmoPreloadPlan {
  source: 'warehouse' | 'cargo' | 'expedition'
  rows: BattleAmmoPreloadRow[]
}

/** 有限趟同一库存快照选档；普通场次按主控优先逐船装载，不能多算共享库存。 */
export function battleAmmoPreloadPlan(
  state: GameState, ctx: SimContext, shipIds: readonly string[],
  supplies?: Readonly<Record<string, number>>, inWormhole = false,
): BattleAmmoPreloadPlan {
  const snapshot = structuredClone(state)
  const pool = supplies ? { ...supplies } : undefined
  const rows: BattleAmmoPreloadRow[] = []
  const ordered = [...new Set(shipIds)]
  const leader = ordered.indexOf(state.shipId)
  if (leader > 0) ordered.unshift(...ordered.splice(leader, 1))
  for (const shipId of ordered) {
    let spec = createPlayerSpec(snapshot, ctx, shipId)
    if (!spec) continue
    if (supplies) spec = createPlayerSpec(snapshot, ctx, shipId, wormholeAmmoIdsForSpec(snapshot, ctx, shipId, spec, supplies))!
    if (inWormhole) applyMatterPlayerBuffs(spec, wormholeMatterBuffs(snapshot.wormhole.run?.hold, matterTechWhBuffs(snapshot, ctx)), 'kinetic')
    const totals = ammoLoadTotals(spec, ctx.balance.battle, snapshot)
    for (const [typeRaw, needRaw] of Object.entries(totals)) {
      const type = typeRaw as DamageType
      const need = needRaw ?? 0
      const selected = pool ? resolveAmmoTier(snapshot, ctx, shipId, type, need, supplies) : undefined
      const actual = pool && selected
        ? { loaded: Math.min(Math.floor(pool[selected.id] ?? 0), need), id: selected.id }
        : loadAmmoTier(snapshot, ctx, shipId, type, need)
      if (pool) pool[actual.id] = Math.max(0, (pool[actual.id] ?? 0) - actual.loaded)
      rows.push({ shipId, type, itemId: actual.id, need, can: actual.loaded, missing: Math.max(0, need - actual.loaded) })
    }
  }
  return { source: supplies ? 'expedition' : state.resupplyFromWarehouse !== false ? 'warehouse' : 'cargo', rows }
}
