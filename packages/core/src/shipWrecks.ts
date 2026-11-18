import type { GameState, ShipWreckRecord, WreckLogEntry } from './state'
import type { FittedModules, SimContext } from './types'
import { nextInt, nextRandom } from './rng'
import { cleanShipDamage, rollShipDamage, type ShipDamageKind } from './shipDamage'

export const SHIP_WRECK_DECAY_MS = 48 * 3_600_000

export const WRECK_LOG_MAX = 30

export function noteWreckLog(state: GameState, entry: WreckLogEntry): void {
  const rest = (state.wreckLog ?? []).filter((e) => e.seq !== entry.seq)
  state.wreckLog = [entry, ...rest].slice(0, WRECK_LOG_MAX)
}

export interface WreckLogRow {
  entry: WreckLogEntry
  wreck: 'salvageable' | 'recovered' | 'expired' | 'none'
  leftMs?: number
}

export function wreckLogRowsOf(state: GameState, ctx: SimContext): WreckLogRow[] {
  const list = state.wreckLog ?? []
  const out: WreckLogRow[] = []
  for (const entry of list) {
    const rec = entry.wreckGalaxyId !== undefined ? state.shipWrecks?.[entry.shipId] : undefined
    if (rec !== undefined) {
      const leftMs = Math.max(0, SHIP_WRECK_DECAY_MS - rec.decayAccMs)
      out.push({ entry, wreck: 'salvageable', leftMs })
    } else if (entry.wreckGalaxyId === undefined) {
      out.push({ entry, wreck: 'none' })
    } else if (entry.recovered === true) {
      out.push({ entry, wreck: 'recovered' })
    } else {
      out.push({ entry, wreck: 'expired' })
    }
  }
  void ctx
  return out
}

export function markWreckRecovered(state: GameState, shipId: string): void {
  const list = state.wreckLog
  if (!list || list.length === 0) return
  let hit = false
  const next = list.map((e) => {
    if (e.shipId !== shipId || e.recovered === true) return e
    hit = true
    return { ...e, recovered: true }
  })
  if (hit) state.wreckLog = next
}
export const WRECK_PLUG_BLACKBOX_ITEM_ID = 'blackbox-h'
const SHIP_WRECK_SNAP = 0.05
export const SHIP_WRECK_WEIGHT = 30
export const HULL_RECOVERY_MAX = 0.9
const LEGACY_HULL_RECOVERY_MAX = 0.6
export const WRECK_RECOVERY_SKILL = {
  hullBase: 0.25,
  hullSkillId: 'hull-salvage-engineering',
  hullPerLevel: 0.05,
  advancedHullSkillId: 'advanced-hull-salvage-engineering',
  advancedHullPerLevel: 0.04,
  equipmentBase: 0.8,
  equipmentSkillId: 'wreck-equipment-preservation',
  equipmentPerLevel: 0.04,
} as const
export const RECOVERED_SHIP_CONDITION = 0.2
export const RECOVERED_HULL_DURABILITY_PCT = 0.3
export const RECOVERED_HULL_ARMOR_PCT = 0.5

export const WRECK_RECOVERY_RATE = {
  weapon: 0.6,
  hull: 0.4,
  drone: 0.25,
  other: 0.4,
} as const

export function recoveryRateOfSlot(slot: string | undefined): number {
  switch (slot) {
    case 'turret':
    case 'missile':
    case 'laser':
    case 'drone-tac':
    case 'drone-relay':
      return WRECK_RECOVERY_RATE.weapon
    case 'drone-rack':
    case 'drone-deck':
      return WRECK_RECOVERY_RATE.drone
    case 'armor':
    case 'shield':
    case 'cargo':
      return WRECK_RECOVERY_RATE.hull
    default:
      return WRECK_RECOVERY_RATE.other
  }
}

export interface WreckLootRow {
  itemId: string
  units: number
  isModule: boolean
  rate: number
}

function moduleRateOf(id: string, ctx: SimContext): number {
  return recoveryRateOfSlot(ctx.modules.get(id)?.slot)
}

export function wreckLootRowsOf(rec: ShipWreckRecord, ctx: SimContext): WreckLootRow[] {
  const rows: WreckLootRow[] = []
  for (const slot of ['high', 'mid', 'low'] as const) {
    for (const id of rec.fitted?.[slot] ?? []) {
      if (typeof id === 'string' && id.length > 0) rows.push({ itemId: id, units: 1, isModule: true, rate: moduleRateOf(id, ctx) })
    }
  }
  for (const [id, n] of Object.entries(rec.droneLoad ?? {})) {
    if (id.length > 0 && Number.isFinite(n) && n > 0 && ctx.items.has(id)) {
      rows.push({ itemId: id, units: Math.floor(n), isModule: false, rate: WRECK_RECOVERY_RATE.drone })
    }
  }
  return rows
}

export function shipWreckValueOf(rec: ShipWreckRecord): number {
  const left = 1 - Math.max(0, rec.decayAccMs) / SHIP_WRECK_DECAY_MS
  return left <= 0 ? 0 : Math.max(0, rec.density) * left
}

export function hullRecoveryChanceOf(rec: ShipWreckRecord, state?: Pick<GameState, 'skills'>): number {
  const reinforce = Number.isFinite(rec.reinforceChance) ? Math.max(0, rec.reinforceChance ?? 0) : 0
  if (rec.recoveryRules !== 2) return Math.min(LEGACY_HULL_RECOVERY_MAX, reinforce)
  const skill = WRECK_RECOVERY_SKILL
  return Math.min(HULL_RECOVERY_MAX, skill.hullBase + reinforce +
    skill.hullPerLevel * recoverySkillLevel(state, skill.hullSkillId) +
    skill.advancedHullPerLevel * recoverySkillLevel(state, skill.advancedHullSkillId))
}

function recoverySkillLevel(state: Pick<GameState, 'skills'> | undefined, id: string): number {
  const level = state?.skills.trained[id] ?? 0
  return Number.isFinite(level) ? Math.max(0, Math.min(5, Math.floor(level))) : 0
}

export function wreckEquipmentRecoveryChanceOf(state: Pick<GameState, 'skills'>): number {
  const skill = WRECK_RECOVERY_SKILL
  return Math.min(1, skill.equipmentBase + skill.equipmentPerLevel * recoverySkillLevel(state, skill.equipmentSkillId))
}

export function shipWrecksOf(state: GameState, galaxyId: string): ShipWreckRecord[] {
  const out: ShipWreckRecord[] = []
  for (const rec of Object.values(state.shipWrecks ?? {})) {
    if (rec.galaxyId !== galaxyId) continue
    if (shipWreckValueOf(rec) <= SHIP_WRECK_SNAP) continue
    out.push(rec)
  }
  return out.sort((a, b) => b.seq - a.seq)
}

export function shipWreckFor(state: GameState, galaxyId: string): ShipWreckRecord | undefined {
  return shipWrecksOf(state, galaxyId)[0]
}

export function hasSalvageableShipWreck(state: GameState, galaxyId: string): boolean {
  return shipWrecksOf(state, galaxyId).some(
    (rec) => (rec.recoveryRules === 2 && !rec.hullRolled) || rec.fitted !== undefined || rec.droneLoad !== undefined || (rec.plugs?.length ?? 0) > 0,
  )
}

export function reinforceChanceOfFitted(
  fitted: FittedModules | undefined,
  ctx: SimContext,
  plugIds?: readonly string[],
): number {
  let sum = 0
  for (const slot of ['high', 'mid', 'low'] as const) {
    for (const id of fitted?.[slot] ?? []) {
      if (typeof id !== 'string') continue
      const v = ctx.modules.get(id)?.hullRecoveryChance
      if (v !== undefined && Number.isFinite(v) && v > 0) sum += v
    }
  }
  for (const id of plugIds ?? []) {
    const v = ctx.modules.get(id)?.hullRecoveryChance
    if (v !== undefined && Number.isFinite(v) && v > 0) sum += v
  }
  return Math.min(HULL_RECOVERY_MAX, sum)
}

export function noteShipWreck(
  state: GameState,
  args: {
    galaxyId: string
    shipId: string
    shipName: string
    defId?: string
    customName?: string | null
    damagePlugs?: readonly ShipDamageKind[]
    durability?: number
    armorPct?: number
    fitted?: FittedModules
    droneLoad?: Record<string, number>
    plugs?: readonly string[]
    reinforceChance?: number
    createdAtWallMs?: number
  },
): ShipWreckRecord {
  const map = (state.shipWrecks ??= {})
  const seq = (state.shipWreckSeq ?? 0) + 1
  state.shipWreckSeq = seq
  const hasDrones = args.droneLoad !== undefined && Object.keys(args.droneLoad).length > 0
  const plugs = (args.plugs ?? []).filter((id) => typeof id === 'string' && id.length > 0)
  const rec: ShipWreckRecord = {
    seq,
    galaxyId: args.galaxyId,
    shipId: args.shipId,
    name: `${args.shipName}的残骸`,
    recoveryRules: 2,
    ...(args.customName !== undefined ? { customName: args.customName } : {}),
    ...(cleanShipDamage(args.damagePlugs) ? { damagePlugs: cleanShipDamage(args.damagePlugs) } : {}),
    ...(args.defId !== undefined ? { defId: args.defId } : {}),
    ...(args.fitted !== undefined ? { fitted: args.fitted } : {}),
    ...(hasDrones ? { droneLoad: args.droneLoad } : {}),
    ...(plugs.length > 0 ? { plugs: [...plugs] } : {}),
    ...(args.durability !== undefined ? { durability: args.durability } : {}),
    ...(args.armorPct !== undefined ? { armorPct: args.armorPct } : {}),
    ...(args.reinforceChance !== undefined && args.reinforceChance > 0
      ? { reinforceChance: Math.min(HULL_RECOVERY_MAX, args.reinforceChance) }
      : {}),
    density: SHIP_WRECK_WEIGHT,
    decayAccMs: 0,
    createdAtWallMs: Number.isFinite(args.createdAtWallMs) ? (args.createdAtWallMs as number) : 0,
  }
  map[rec.shipId] = rec
  return rec
}

export function advanceShipWreckDecay(state: GameState, dtMs: number, salvagingGalaxyId: string | null = null): void {
  const map = state.shipWrecks
  if (!map) return
  for (const rec of Object.values(map)) {
    if (rec.galaxyId === salvagingGalaxyId) continue
    const acc = Math.max(0, rec.decayAccMs) + dtMs
    if (acc >= SHIP_WRECK_DECAY_MS || shipWreckValueOf({ ...rec, decayAccMs: acc }) <= SHIP_WRECK_SNAP) {
      delete map[rec.shipId]
      continue
    }
    map[rec.shipId] = { ...rec, decayAccMs: acc }
  }
}

function removedLootFrom(rec: ShipWreckRecord, row: WreckLootRow): ShipWreckRecord {
  if (!row.isModule) {
    const droneLoad = { ...(rec.droneLoad ?? {}) }
    delete droneLoad[row.itemId]
    return { ...rec, droneLoad }
  }
  const fitted: FittedModules = {
    high: [...(rec.fitted?.high ?? [])],
    mid: [...(rec.fitted?.mid ?? [])],
    low: [...(rec.fitted?.low ?? [])],
  }
  for (const slot of ['high', 'mid', 'low'] as const) {
    const i = fitted[slot].indexOf(row.itemId)
    if (i >= 0) {
      if (rec.recoveryRules === 2) fitted[slot][i] = null
      else fitted[slot].splice(i, 1)
      break
    }
  }
  return { ...rec, fitted }
}

export type PlayerWreckSalvage =
  | { kind: 'none' }
  | { kind: 'item'; itemId: string; units: number; isModule: boolean }
  | { kind: 'plugs'; blackBoxes: number }
  | { kind: 'ship'; wreckName: string; defId?: string; durability?: number; armorPct?: number; plugs?: string[];
      customName?: string | null; recoveryRules?: 2; fitted?: FittedModules; droneLoad?: Record<string, number>;
      damagePlugs?: ShipDamageKind[]; keptModules?: number; lostModules?: number }

function rollWreckEquipment(state: GameState, rec: ShipWreckRecord, ctx: SimContext, shipRecovered: boolean): FittedModules {
  const source = rec.fitted ?? { high: [], mid: [], low: [] }
  const rate = shipRecovered ? wreckEquipmentRecoveryChanceOf(state) : undefined
  const fitted = { high: [...source.high], mid: [...source.mid], low: [...source.low] }
  const candidates: Array<{ rack: keyof FittedModules; at: number; id: string }> = []
  let kept = 0
  for (const rack of ['high', 'mid', 'low'] as const) {
    for (let at = 0; at < fitted[rack].length; at++) {
      const id = fitted[rack][at]
      if (!id) continue
      candidates.push({ rack, at, id })
      if (nextRandom(state.rng) < (rate ?? moduleRateOf(id, ctx))) kept++
      else fitted[rack][at] = null
    }
  }
  if (!shipRecovered && kept === 0 && candidates.length > 0) {
    const pick = candidates[nextInt(state.rng, candidates.length)]!
    fitted[pick.rack][pick.at] = pick.id
  }
  return fitted
}

export function trySalvagePlayerWreckOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
): PlayerWreckSalvage {
  const map = state.shipWrecks
  let rec = shipWreckFor(state, galaxyId)
  if (!map || !rec) return { kind: 'none' }

  if (rec.hullRolled !== true) {
    const canRecover = rec.recoveryRules !== 2 || !!rec.defId && ctx.ships.has(rec.defId)
    const chance = canRecover ? hullRecoveryChanceOf(rec, state) : 0
    if (chance <= 0) {
      rec = { ...rec, hullRolled: true }
      map[rec.shipId] = rec
    } else if (nextRandom(state.rng) < chance) {
      delete map[rec.shipId]
      markWreckRecovered(state, rec.shipId)
      const fitted = rec.recoveryRules === 2 ? rollWreckEquipment(state, rec, ctx, true) : undefined
      const droneLoad = rec.recoveryRules === 2 ? Object.fromEntries(Object.entries(rec.droneLoad ?? {})
        .filter(([id, n]) => ctx.items.has(id) && n > 0 && nextRandom(state.rng) < WRECK_RECOVERY_RATE.drone)) : undefined
      const count = (fit: FittedModules | undefined): number => fit ? [...fit.high, ...fit.mid, ...fit.low].filter(Boolean).length : 0
      const damageImmune = rec.plugs?.some(id => ctx.modules.get(id)?.slot === 'plug' && ctx.modules.get(id)?.recoveryDamageImmune)
      const damagePlugs = rec.recoveryRules === 2 && !damageImmune ? rollShipDamage(state, rec.damagePlugs) : cleanShipDamage(rec.damagePlugs)
      return {
        kind: 'ship',
        wreckName: rec.name,
        ...(rec.defId !== undefined ? { defId: rec.defId } : {}),
        ...(rec.durability !== undefined ? { durability: rec.durability } : {}),
        ...(rec.armorPct !== undefined ? { armorPct: rec.armorPct } : {}),
        ...(rec.customName !== undefined ? { customName: rec.customName } : {}),
        ...(rec.recoveryRules === 2 ? { recoveryRules: 2 as const, fitted, droneLoad,
          keptModules: count(fitted), lostModules: count(rec.fitted) - count(fitted) } : {}),
        ...(damagePlugs?.length ? { damagePlugs } : {}),
        ...((rec.plugs?.length ?? 0) > 0 ? { plugs: [...(rec.plugs ?? [])] } : {}),
      }
    } else {
      rec = { ...rec, hullRolled: true }
      map[rec.shipId] = rec
    }
  }

  if (rec.recoveryRules === 2 && rec.equipmentRolled !== true) {
    rec = { ...rec, fitted: rollWreckEquipment(state, rec, ctx, false), equipmentRolled: true }
    map[rec.shipId] = rec
  }
  const rows = wreckLootRowsOf(rec, ctx)
  const plugIds = rec.plugs ?? []
  if (plugIds.length > 0) {
    const blackBoxes = plugIds.filter((id) => typeof id === 'string' && id.length > 0).length
    if (rows.length === 0) {
      delete map[rec.shipId]
      markWreckRecovered(state, rec.shipId)
    } else map[rec.shipId] = { ...rec, plugs: [], hullRolled: true }
    return { kind: 'plugs', blackBoxes }
  }

  if (rows.length === 0) {
    delete map[rec.shipId]
    markWreckRecovered(state, rec.shipId)
    return { kind: 'none' }
  }
  let row = rows.find((r) => (rec!.recoveryRules === 2 && r.isModule) || nextRandom(state.rng) < r.rate)
  const usedPity = row === undefined
  if (!row && rec.pityUsed !== true) row = rows[nextInt(state.rng, rows.length)]
  if (!row) return { kind: 'none' }

  const after = removedLootFrom(rec, row)
  const left = wreckLootRowsOf(after, ctx)
  if (left.length === 0) {
    delete map[rec.shipId]
    markWreckRecovered(state, rec.shipId)
  } else {
    map[rec.shipId] = { ...after, hullRolled: true, ...(usedPity ? { pityUsed: true } : {}) }
  }
  return { kind: 'item', itemId: row.itemId, units: row.units, isModule: row.isModule }
}
