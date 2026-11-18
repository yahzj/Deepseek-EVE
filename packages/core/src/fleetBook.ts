import type { FittedModules, FleetShipState, GameState } from './state'
import { emptyFitted } from './labels'
import { RECOVERED_HULL_ARMOR_PCT, RECOVERED_HULL_DURABILITY_PCT, RECOVERED_SHIP_CONDITION } from './shipWrecks'
import { cleanShipDamage, type ShipDamageKind } from './shipDamage'

export function addShipToFleet(state: GameState, defId: string): string {
  const uid = allocateShipUid(state, defId)
  state.fleet[uid] = emptyShipState(defId)
  return uid
}

export function allocateShipUid(state: GameState, defId: string): string {
  let max = 0
  const taken = new Set<string>(Object.keys(state.fleet))
  const consider = (uid: string): void => {
    taken.add(uid)
    if (uid === defId) max = Math.max(max, 1)
    else if (uid.startsWith(`${defId}#`)) {
      const n = Number(uid.slice(defId.length + 1))
      if (Number.isInteger(n) && n > 1) max = Math.max(max, n)
    }
  }
  for (const uid of Object.keys(state.fleet)) consider(uid)
  for (const hold of Object.values(state.escrowShips)) consider(hold.shipId)
  for (const wreck of Object.values(state.shipWrecks ?? {})) consider(wreck.shipId)
  for (const entry of state.wreckLog ?? []) if (entry.wreckGalaxyId) consider(entry.shipId)
  return max === 0 ? defId : `${defId}#${max + 1}`
}

function emptyShipState(defId: string): FleetShipState {
  const fitted: FittedModules = emptyFitted()
  return { defId, customName: null, durability: 1, armorPct: 1, cargo: {}, fitted }
}

export function restoreShipFromWreck(
  state: GameState,
  args: {
    defId: string
    customName?: string | null
    recoveryRules?: 2
    damagePlugs?: readonly ShipDamageKind[]
    durability?: number
    armorPct?: number
    fitted?: FittedModules
    droneLoad?: Record<string, number>
    plugs?: readonly string[]
  },
): string {
  const uid = addShipToFleet(state, args.defId)
  const ship = state.fleet[uid]
  if (!ship) return uid
  const baseDur = Number.isFinite(args.durability) ? Math.max(0, args.durability as number) : 1
  const baseArmor = Number.isFinite(args.armorPct) ? Math.max(0, args.armorPct as number) : 1
  ship.durability = args.recoveryRules === 2 ? RECOVERED_SHIP_CONDITION : Math.max(0, Math.min(1, baseDur * RECOVERED_HULL_DURABILITY_PCT))
  ship.armorPct = args.recoveryRules === 2 ? RECOVERED_SHIP_CONDITION : Math.max(0, Math.min(1, baseArmor * RECOVERED_HULL_ARMOR_PCT))
  if (args.customName !== undefined) ship.customName = args.customName
  if (args.fitted !== undefined) ship.fitted = structuredClone(args.fitted)
  if (args.droneLoad !== undefined && Object.keys(args.droneLoad).length > 0) ship.droneLoad = { ...args.droneLoad }
  const damagePlugs = cleanShipDamage(args.damagePlugs)
  if (damagePlugs) ship.damagePlugs = damagePlugs
  const plugs = (args.plugs ?? []).filter((id) => typeof id === 'string' && id.length > 0)
  if (plugs.length > 0) ship.plugs = [...plugs]
  return uid
}

export function isShipLocked(state: GameState, shipId: string): boolean {
  return state.shipLocks[shipId] === true
}

export function shipStoredCount(state: GameState, defId: string): number {
  const n = state.shipStore?.[defId] ?? 0
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
