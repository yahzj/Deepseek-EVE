import type { GameState } from './state'
import type { SimContext } from './types'
import { addWare, cargoCapacityM3Of, cargoHoldForbidden } from './inventory'
import { cpuOverloadText, droneBayTotalM3, droneLoadM3 } from './equipment'
import { fleetDefOf } from './instances'
import { wormholeAdmission, wormholeEnter, wormholeEntryBlockReason, WORMHOLE_SLOT_M3 } from './wormhole'
import type { WormholeStartResult } from './wormhole'
import { wormholeIsShapedItem } from './wormholeHold'
import { createPlayerSpec } from './playerSpec'
import { ammoLoadTotals, wormholeAmmoIdsForSpec, weaponNominalAmmoForMs } from './combatAmmo'
import type { DamageType } from './types'
import { wormholePatrolLayerReset } from './wormholePatrol'
import { wormholeFreezeEvents } from './wormholeExpedition'
import { wormholeSalvagersInFleet } from './wormholeSalvage'

export type WormholePreparedResult = WormholeStartResult & { code?: 'invalid-plan' | 'stale-plan' | 'stock-missing' | 'entry-blocked' }

export interface WormholePreparationRequest {
  /** 总携入目标，包含所选舰船已有货物。 */
  targets: Record<string, number>
  /** 明确卸港的舰载物品id；未列出的已有货物默认携入。 */
  unload: readonly string[]
}

export interface WormholePreparationPlan {
  request: WormholePreparationRequest
  fingerprint: string
  items: Record<string, number>
  fromWarehouse: Record<string, number>
  shortage: Record<string, number>
  invalid: string[]
  deployedDrones: Record<string, number>
  cells: number
  capacity: number
  ok: boolean
  rows: Array<{ itemId: string; target: number; onboard: number; warehouse: number; needed: number; available: number; missing: number }>
  warnings: Array<{ code: 'ammo-empty' | 'no-salvager' | 'no-output'; shipId?: string; itemId?: string }>
}

function validCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
}

/** 预览不生成地图、不扣货；确认时以同一算法重验。 */
export function wormholePreparationPlan(
  state: GameState,
  ctx: SimContext,
  fleet: readonly string[],
  request: WormholePreparationRequest,
): WormholePreparationPlan {
  const onboard: Record<string, number> = {}
  const invalid: string[] = []
  const unloading = new Set(request.unload)
  const items: Record<string, number> = {}
  const fromWarehouse: Record<string, number> = {}
  const shortage: Record<string, number> = {}
  const rows: WormholePreparationPlan['rows'] = []
  const warnings: WormholePreparationPlan['warnings'] = []
  const deployedDrones: Record<string, number> = {}
  if (new Set(fleet).size !== fleet.length) invalid.push('duplicate-fleet')
  for (const uid of new Set(fleet)) {
    const ship = state.fleet[uid]
    if (!ship) { invalid.push(uid); continue }
    const def = fleetDefOf(state, ctx, uid)
    if (cpuOverloadText(state, ctx, uid) || droneLoadM3(ship.droneLoad, ctx) > droneBayTotalM3(def, ship.fitted, ctx)) {
      invalid.push(uid)
    }
    for (const [id, n] of Object.entries(ship.droneLoad ?? {})) {
      if (ctx.items.get(id)?.kind === 'drone' && validCount(n) && n > 0) deployedDrones[id] = (deployedDrones[id] ?? 0) + n
    }
    for (const [id, n] of Object.entries(ship.cargo)) {
      if (!validCount(n)) { invalid.push(id); continue }
      if (!unloading.has(id)) onboard[id] = (onboard[id] ?? 0) + n
    }
  }
  for (const id of new Set([...Object.keys(onboard), ...Object.keys(request.targets)])) {
    const held = onboard[id] ?? 0
    const target = request.targets[id] ?? held
    if (target === 0 && held === 0 && unloading.has(id)) continue
    const def = ctx.items.get(id)
    if (!validCount(target) || target < held || !def || !(def.unitM3 > 0) || cargoHoldForbidden(ctx, id) || wormholeIsShapedItem(id)) {
      invalid.push(id)
      continue
    }
    if (target > 0) items[id] = target
    const need = target - held
    const stock = state.warehouse.items[id] ?? 0
    const available = validCount(stock) ? stock : 0
    rows.push({ itemId: id, target, onboard: held, warehouse: available, needed: need, available: Math.min(need, available), missing: Math.max(0, need - available) })
    if (need > 0) {
      fromWarehouse[id] = need
      const available = state.warehouse.items[id] ?? 0
      const missing = Math.max(0, need - (validCount(available) ? available : 0))
      if (missing > 0) shortage[id] = missing
    }
  }
  const cells = Object.entries(items).reduce((n, [id, units]) => n + Math.ceil(units * ctx.items.get(id)!.unitM3 / WORMHOLE_SLOT_M3), 0)
  const capacity = Math.floor(fleet.reduce((n, uid) => n + cargoCapacityM3Of(state, ctx, uid), 0) / WORMHOLE_SLOT_M3)
  if (wormholeSalvagersInFleet(state, ctx, fleet) === 0) warnings.push({ code: 'no-salvager' })
  for (const uid of fleet) {
    const spec = createPlayerSpec(state, ctx, uid)
    if (!spec) continue
    const totals = ammoLoadTotals(spec, ctx.balance.battle, state)
    for (const type of Object.keys(totals)) {
      if (Object.entries(items).some(([id, n]) => id.startsWith(`ammo-${type}-`) && n > 0)) continue
      warnings.push({ code: 'ammo-empty', shipId: uid, itemId: state.fleet[uid]?.ammoPref?.[type as keyof typeof totals] ?? `ammo-${type}-l` })
    }
    if (!spec.weapons.some((w) => w.src !== 'base')) warnings.push({ code: 'no-output', shipId: uid })
  }
  const fingerprint = JSON.stringify({
    fleet: fleet.map((uid) => [uid, state.fleet[uid]]),
    shipId: state.shipId,
    warehouse: state.warehouse.items,
    skills: state.skills.trained,
    stock: state.wormholeStock,
    // 主控停机和归还舰载货都会使准备预览失效。
    mining: state.mining, salvaging: state.salvaging, hauling: state.hauling,
    request,
  })
  return {
    request: { targets: { ...request.targets }, unload: [...request.unload] }, fingerprint,
    items, fromWarehouse, shortage, invalid, deployedDrones, cells, capacity, rows, warnings,
    ok: invalid.length === 0 && Object.keys(shortage).length === 0 && cells <= capacity && wormholeAdmission(ctx, fleet).ok,
  }
}

/** 2026-10-05船长确认：未设目标的现役机型补一套备用，明确目标与卸港选择不改。 */
export function wormholePreparationFillPlan(
  state: GameState, ctx: SimContext, fleet: readonly string[], request: WormholePreparationRequest,
): WormholePreparationPlan {
  const current = wormholePreparationPlan(state, ctx, fleet, request)
  const targets = { ...request.targets }
  const unloading = new Set(request.unload)
  for (const [id, n] of Object.entries(current.deployedDrones)) {
    if (Object.prototype.hasOwnProperty.call(targets, id) || unloading.has(id)) continue
    const onboard = current.rows.find((row) => row.itemId === id)?.onboard ?? 0
    targets[id] = Math.max(n, onboard)
  }
  return wormholePreparationPlan(state, ctx, fleet, { targets, unload: [...request.unload] })
}

/** 首次整备锁定一包上限，按真实武器周期计算，不借用四分钟战斗预载。 */
export function wormholeSupplyPackageOf(
  state: GameState, ctx: SimContext, fleet: readonly string[], plan: WormholePreparationPlan,
): Record<string, number> {
  const nominal: Record<string, number> = {}
  for (const uid of fleet) {
    const spec = createPlayerSpec(state, ctx, uid)
    if (!spec) continue
    const ids = wormholeAmmoIdsForSpec(state, ctx, uid, spec, plan.items)
    for (const w of spec?.weapons ?? []) {
      const type: DamageType | undefined = w.kind === 'beam' ? 'plasma' : w.kind === 'gun' ? Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined : undefined
      if (!type) continue
      const count = weaponNominalAmmoForMs(w, 60_000)
      const id = ids[type]
      if (!id) continue
      nominal[id] = (nominal[id] ?? 0) + count
    }
  }
  const pack: Record<string, number> = {}
  for (const [id, count] of Object.entries(nominal)) {
    const n = Math.min(Math.floor((plan.items[id] ?? 0) * 0.25), count)
    if (n > 0) pack[id] = n
  }
  for (const [id, count] of Object.entries(plan.deployedDrones)) {
    const n = Math.floor(count * 0.25)
    if (n > 0) pack[id] = n
  }
  pack['repairkit-mil'] = 20
  pack['repairkit-dc'] = 1
  return pack
}

/** 本阶段只供显式测试调用；缺省保留第一批有限补给旧探索。 */
export function wormholeEnterPrepared(
  state: GameState,
  ctx: SimContext,
  fleet: readonly string[],
  seed: number,
  plan: WormholePreparationPlan,
  stockId?: string,
  opts?: { expeditionRules?: 2; goal?: 'deep' | 'ruins' | 'survey' },
): WormholePreparedResult {
  const current = wormholePreparationPlan(state, ctx, fleet, plan.request)
  if (!current.ok) return { ok: false, code: 'invalid-plan' }
  if (current.fingerprint !== plan.fingerprint) return { ok: false, code: 'stale-plan' }
  if (state.wormhole.run || wormholeEntryBlockReason(state, ctx, fleet)) return { ok: false, code: 'entry-blocked' }
  const staged = structuredClone(state)
  const stock = stockId === undefined ? undefined : staged.wormholeStock?.find((s) => s.id === stockId)
  if (stockId !== undefined && !stock) return { ok: false, code: 'stock-missing' }
  const started = wormholeEnter(staged, ctx, fleet, seed, { ...stock, ...(opts?.expeditionRules === 2 ? { expeditionRules: 2 } : {}) })
  if (!started.ok || !started.run) return started
  const afterStop = wormholePreparationPlan(staged, ctx, fleet, plan.request)
  if (!afterStop.ok || JSON.stringify(afterStop.items) !== JSON.stringify(current.items)) {
    return { ok: false, code: 'stale-plan' }
  }
  const unload = new Set(plan.request.unload)
  for (const uid of fleet) {
    const cargo = staged.fleet[uid]!.cargo
    for (const [id, n] of Object.entries(cargo)) {
      if (unload.has(id)) {
        if (ctx.modules.has(id)) staged.moduleBay[id] = (staged.moduleBay[id] ?? 0) + n
        else addWare(staged, id, n)
      }
      delete cargo[id]
    }
  }
  for (const [id, n] of Object.entries(afterStop.fromWarehouse)) {
    const left = (staged.warehouse.items[id] ?? 0) - n
    if (left > 0) staged.warehouse.items[id] = left
    else delete staged.warehouse.items[id]
  }
  started.run.supplyVersion = 1
  started.run.supplies = { items: { ...afterStop.items }, carried: { ...afterStop.items }, consumed: {}, deployed: {}, recovered: {}, leftBehind: {}, found: {} }
  if (opts?.expeditionRules === 2) {
    started.run.expeditionSupplyPackage = wormholeSupplyPackageOf(staged, ctx, fleet, afterStop)
    started.run.supplyPackagesTaken = 0
    started.run.expeditionGoal = opts.goal ?? 'deep'
    started.run.expeditionProgress = { peakDepth: started.run.depth, guards: 0, ruins: 0, events: 0, revealed: 0, clues: 0, elites: 0 }
    wormholePatrolLayerReset(started.run)
    wormholeFreezeEvents(staged, ctx)
  }
  if (stockId !== undefined) staged.wormholeStock = staged.wormholeStock?.filter((s) => s.id !== stockId)
  Object.assign(state, staged)
  return { ok: true, run: state.wormhole.run! }
}
