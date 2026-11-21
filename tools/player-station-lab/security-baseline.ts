import { buildSimContext } from '../../packages/data/src/context'
import { createInitialState } from '../../packages/core/src/state'
import { addShipToFleet } from '../../packages/core/src/fleetBook'
import { addModule, fitModule, adjustDroneLoad } from '../../packages/core/src/equipment'
import { startFleetBattleFor, advanceBattleFor, waveGapTotalMs, repairLedgersOf } from '../../packages/core/src/combat'
import { STATION_SECURITY_SOURCES, STATION_SECURITY_ESCORT_BILL,
  type StationSecurityResult } from '../../packages/core/src/playerStation/security'

const context = buildSimContext()
/** 合成单舰作战预算；护航固定账单仍单独使用 core 的 ESCORT_BILL。 */
export const SECURITY_SUPPLIES = Object.freeze({ ...STATION_SECURITY_ESCORT_BILL, 'repairkit-mil': 4 })
export const SECURITY_LOADOUTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'sh-falconet': Object.freeze(['mod-turret-kin-1', 'mod-shield-kin-1', 'mod-armor-plate-1']),
  'sh-mako': Object.freeze(['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-shield-kin-1', 'mod-armor-plate-1']),
  'sh-hammerhead': Object.freeze(['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-shield-kin-1', 'mod-hullrep-1', 'mod-armor-plate-1']),
})
export const SECURITY_DRONES: Readonly<Record<string, Readonly<Record<string, number>>>> = Object.freeze({
  'sh-hammerhead': Object.freeze({ 'drone-scout': 1 }),
})
export const SECURITY_SHIPS = Object.freeze(['sh-falconet', 'sh-mako', 'sh-hammerhead'].map((defId, index) => {
  const ship = context.ships.get(defId)!
  const modules = SECURITY_LOADOUTS[defId]!.map(id => context.modules.get(id)!)
  const tags = ['fire-control', ...(modules.some(module => module.repairKit) ? ['damage-control'] : []),
    ...(Object.values(SECURITY_DRONES[defId] ?? {}).some(n => n > 0) ? ['drones'] : [])]
  return Object.freeze({ id: defId, name: ship.name, tier: (index + 1) as 1 | 2 | 3,
    trainingTags: Object.freeze(tags), defId })
}))
export function securitySourceName(id: string): string { return context.anomalies.get(id)?.name ?? id }
export interface SecurityBattleBonus { damagePct: number; defensePct: number }

/** 只创建隔离主控；每船货仓最多 60 发，原引擎负责装弹、命中、耗弹及终局。 */
export function resolveSecurityBattle(shipIds: readonly string[], sourceId: string,
  bonuses: Readonly<Record<string, SecurityBattleBonus>> = {}): StationSecurityResult {
  if (shipIds.length < 1 || shipIds.length > 4 || new Set(shipIds).size !== shipIds.length
    || shipIds.some(id => !SECURITY_SHIPS.some(ship => ship.id === id))
    || !STATION_SECURITY_SOURCES.some(source => source.id === sourceId)) throw new Error('Invalid security battle deployment')
  if (Object.keys(bonuses).some(id => !shipIds.includes(id))) throw new Error('Invalid security battle bonus owner')
  const ships = new Map(context.ships)
  for (const id of shipIds) {
    const bonus = bonuses[id] ?? { damagePct: 0, defensePct: 0 }
    if (![bonus.damagePct, bonus.defensePct].every(n => Number.isFinite(n) && n >= 0 && n <= 10)) throw new Error('Invalid security battle bonus')
    const base = context.ships.get(id)!
    // 在隔离船体表上施加增量，建档与逐拍重建规格读取同一张表。
    ships.set(id, { ...base, powerBonus: (1 + (base.powerBonus ?? 0)) * (1 + bonus.damagePct) - 1,
      shieldHp: Math.ceil((base.shieldHp ?? 0) * (1 + bonus.defensePct)),
      armorHp: Math.ceil((base.armorHp ?? 0) * (1 + bonus.defensePct)),
      hullHp: Math.ceil((base.hullHp ?? 0) * (1 + bonus.defensePct)) })
  }
  const ctx = { ...context, ships }
  const state = createInitialState({ nowWallMs: 0, seed: 20261121 })
  state.resupplyFromWarehouse = false
  state.fleet = {}
  state.warehouse.items = {}
  const fleetIds = shipIds.map(id => {
    const uid = addShipToFleet(state, id)
    const ship = state.fleet[uid]!
    for (const moduleId of SECURITY_LOADOUTS[id]!) {
      addModule(state, moduleId, 1)
      const result = fitModule(state, moduleId, ctx, { shipId: uid })
      if (!result.ok) throw new Error(`Invalid security baseline fitting: ${result.error}`)
    }
    for (const [droneId, count] of Object.entries(SECURITY_DRONES[id] ?? {})) {
      state.warehouse.items[droneId] = count
      const result = adjustDroneLoad(state, ctx, droneId, count, uid)
      if (!result.ok) throw new Error(`Invalid security baseline drone load: ${result.error}`)
    }
    ship.cargo = { 'ammo-kinetic-l': SECURITY_SUPPLIES['ammo-kinetic-l'],
      ...(SECURITY_LOADOUTS[id]!.includes('mod-hullrep-1') ? { 'repairkit-mil': SECURITY_SUPPLIES['repairkit-mil'] } : {}) }
    return uid
  })
  state.shipId = fleetIds[0]!
  const battle = startFleetBattleFor(state, ctx, fleetIds, sourceId, 0)
  if (!battle) throw new Error('Security combat engine could not start')
  const loaded = battle.ammoLoaded?.kin ?? 0
  const budget = shipIds.length * SECURITY_SUPPLIES['ammo-kinetic-l']
  if (loaded > budget || battle.ammo.exp !== 0 || battle.ammo.pla !== 0) throw new Error('Security combat supply budget exceeded')
  const cap = ctx.balance.battle.maxBattleMs + waveGapTotalMs(ctx.anomalies.get(sourceId), ctx.balance.battle) + 60_000
  for (let elapsed = 1000; elapsed <= cap && !battle.ended; elapsed += 1000) {
    state.gameMs = elapsed
    advanceBattleFor(state, ctx, battle, state.shipId, sourceId)
  }
  if (!battle.ended) throw new Error('Security combat engine did not reach a verdict')
  const used = loaded - battle.ammo.kin
  if (!Number.isSafeInteger(used) || used < 0 || used > budget) throw new Error('Security combat supply budget exceeded')
  const victory = battle.ended === 'me'
  const ammoUsed: Record<string, number> = used ? { 'ammo-kinetic-l': used } : {}
  for (const { ledger } of repairLedgersOf(battle)) {
    for (const [id, count] of Object.entries(ledger.kitsUsedByType ?? {})) ammoUsed[id] = (ammoUsed[id] ?? 0) + count
  }
  if ((ammoUsed['repairkit-mil'] ?? 0) > shipIds.length * SECURITY_SUPPLIES['repairkit-mil']) throw new Error('Security repair supply budget exceeded')
  return { outcome: victory ? 'victory' : 'defeat', durationMs: Math.max(1, battle.lastTickGameMs - battle.startedAtGameMs),
    ammoUsed, reward: victory ? { 'part-circuit': 20 } : {} }
}
