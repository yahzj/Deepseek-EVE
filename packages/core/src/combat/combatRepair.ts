import { ceilFinalQuantity } from '../quantity'
import type { GameState } from '../state'
import type { ModuleDef, SimContext } from '../types'
import { isAlive, healArmorHp } from './combatMath'
import { allFittedModules, pulseStreamOf, stackWeight, equipmentCycleMsOf } from '../equipment'
import { fleetDefOf } from '../instances'
import { moduleAllowedOnShip } from '../shipFitting'
import { addWare, cargoOfShip, countWare, removeCargoOfShip, removeWare } from '../inventory'
import { quickRepairFactor, repairCapacityMulOf } from '../repair'
import { pushBattleFx } from './combatFx'
import { createPlayerSpec } from './player/create'
import type { UnitSpec } from './model'
import { takeWormholeSupply, wormholeSupplyForBattle } from '../wormholeSupplies'
import { syncPlayerCrisis } from './gravekeeperGear'

export const REPAIR_PULSE_MS = 5_000

export const SHIELD_FIELD_COST_PCT = 0.1
export const SHIELD_FIELD_MAX_TARGETS = 2

export function pulseRepairDroneFor(state: GameState, b: import('../state').BattleState, myUnits: readonly UnitSpec[], owner: UnitSpec, repair: NonNullable<import('./model').WeaponSpec['repairDrone']>, drone?: { artId?: string; index: number }): void {
  if (b.ended || !isAlive(b, owner.tag) || repair.armor + repair.hull <= 0) return
  let target: { spec: UnitSpec; rt: NonNullable<typeof b.units[string]> } | undefined
  let best = Number.POSITIVE_INFINITY
  for (const spec of myUnits) {
    if (spec.tag === owner.tag || !isAlive(b, spec.tag)) continue
    const rt = b.units[spec.tag]
    if (!rt) continue
    const max = rt.hpMax ?? spec.hp
    if (rt.hp.a >= max.a && rt.hp.h >= max.h) continue
    const ratio = (rt.hp.a + rt.hp.h) / Math.max(1, max.a + max.h)
    if (ratio < best) { best = ratio; target = { spec, rt } }
  }
  if (!target) return
  const max = target.rt.hpMax ?? target.spec.hp
  const amp = target.spec.repairCapacityMul ?? { a: 1, h: 1 }
  const armor = Math.min(Math.max(0, max.a - target.rt.hp.a), ceilFinalQuantity(repair.armor * amp.a))
  const hull = Math.min(Math.max(0, max.h - target.rt.hp.h), ceilFinalQuantity(repair.hull * amp.h))
  if (armor + hull <= 0) return
  const kit = repair.kitId
  const supply = wormholeSupplyForBattle(state, b)
  const available = supply ? takeWormholeSupply(supply, kit, 1) === 1 : state.resupplyFromWarehouse !== false ? countWare(state, kit) > 0 && (removeWare(state, kit, 1), true) : removeCargoOfShip(state, owner.shipId ?? state.shipId, kit, 1) > 0
  if (!available) return
  healArmorHp(target.rt.hp, armor)
  target.rt.hp.h += hull
  const books = b.repairDroneBy ??= {}
  const ledger = books[owner.tag] ??= { pulses: 0, kitsUsed: 0, kitsUsedByType: {} }
  ledger.pulses += 1
  ledger.kitsUsed += 1
  ledger.kitsUsedByType[kit] = (ledger.kitsUsedByType[kit] ?? 0) + 1
  if (drone) pushBattleFx(b, { atMs: b.lastTickGameMs, side: 'me', tag: owner.tag, to: target.spec.tag,
    type: 'kinetic', hit: true, src: 'drone', artId: drone.artId,
    repair: { armor, hull, droneIndex: drone.index }, speedX: b.speedX ?? 1 })
}


function layerAmpOf(state: GameState, ctx: SimContext, shipId: string): { a: number; h: number } {
  const spec = createPlayerSpec(state, ctx, shipId)
  const def = fleetDefOf(state, ctx, shipId)
  if (!spec || !def) return { a: 1, h: 1 }
  return repairCapacityMulOf(spec.hp, def)
}

function repairOutputMulOf(state: GameState, ctx: SimContext, shipId: string): number {
  return 1 + Math.max(0, fleetDefOf(state, ctx, shipId)?.repairOutputBonusPct ?? 0)
}

export function fittedRepairModules(state: GameState, ctx: SimContext, shipId: string): ModuleDef[] {
  const ship = state.fleet[shipId]
  if (!ship) return []
  return allFittedModules(ship.fitted, ctx).filter((d) => (d.repairArmorHp ?? 0) > 0 || (d.repairHullHp ?? 0) > 0)
}

function perPulseRepairUnits(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { moduleId: string; kitId: string; free: boolean; armorPerPulse: number; hullPerPulse: number }[] {
  const defs = fittedRepairModules(state, ctx, shipId)
  if (defs.length === 0) return []
  const amp = layerAmpOf(state, ctx, shipId)
  const quickRepair = quickRepairFactor(state, ctx)
  const parts = fittedPulseParts(state, ctx, shipId, 'repair').filter((p) => pulsePartLive('repair', p))
  return defs.map((d, i) => {
    const isFree = d.repairFree === true
    const p = parts[i]
    const w = stackWeight(i + 1)
    const decayA = (p?.armorHp ?? d.repairArmorHp ?? 0) * w
    const decayH = (p?.hullHp ?? d.repairHullHp ?? 0) * w
    const flat = d.repairIgnoresCapacityAmp === true
    const skill = isFree ? 1 : quickRepair
    return {
      moduleId: d.id,
      kitId: isFree ? '' : (d.repairKit ?? 'repairkit-civ'),
      free: isFree,
      armorPerPulse: Math.max(0, ceilFinalQuantity(decayA * skill * (flat ? 1 : amp.a) * repairOutputMulOf(state, ctx, shipId))),
      hullPerPulse: Math.max(0, ceilFinalQuantity(decayH * skill * (flat ? 1 : amp.h) * repairOutputMulOf(state, ctx, shipId))),
    }
  })
}

export function repairStatsFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { units: { moduleId: string; armorPerPulse: number; hullPerPulse: number; free: boolean }[]; intervalMs: number } | null {
  const units = perPulseRepairUnits(state, ctx, shipId)
  if (units.length === 0) return null
  return {
    units: units.map(({ moduleId, armorPerPulse, hullPerPulse, free }) => ({ moduleId, armorPerPulse, hullPerPulse, free })),
    intervalMs: equipmentCycleMsOf(state, ctx, shipId, REPAIR_PULSE_MS),
  }
}

export function preloadRepairFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  maxBattleMs: number,
): import('../state').BattleState['repair'] | null {
  const defs = fittedRepairModules(state, ctx, shipId)
  if (defs.length === 0) return null
  const units: import('../state').BattleRepairUnit[] = []
  const need = new Map<string, number>()
  const perUnit = Math.max(1, Math.ceil(maxBattleMs / REPAIR_PULSE_MS)) + 1
  for (const u of perPulseRepairUnits(state, ctx, shipId)) {
    if (!u.free) need.set(u.kitId, (need.get(u.kitId) ?? 0) + perUnit)
    units.push({
      moduleId: u.moduleId,
      kitId: u.kitId,
      free: u.free,
      armorPerPulse: u.armorPerPulse,
      hullPerPulse: u.hullPerPulse,
      stopped: false,
    })
  }
  void need
  void perUnit
  return { units, kits: {}, nextPulseAtMs: undefined, pulses: 0, kitsUsed: 0 }
}

export function repairKitAvailableOf(state: GameState, shipId: string, kitId: string): number {
  const run = state.wormhole.run
  if (run?.supplyVersion === 1 && run.fleet.includes(shipId)) return run.supplies?.items[kitId] ?? 0
  return state.resupplyFromWarehouse !== false
    ? countWare(state, kitId)
    : Math.floor(cargoOfShip(state, shipId)[kitId] ?? 0)
}

export function refundRepairKits(
  state: GameState,
  repair: import('../state').BattleRepairLedger | null | undefined,
): void {
  if (!repair || !repair.kits || Object.isFrozen(repair.kits)) return
  for (const [id, n] of Object.entries(repair.kits)) {
    if (n > 0) addWare(state, id, Math.floor(n))
  }
  repair.kits = {}
}

export function repairLedgersOf(
  battle:
    | { repair?: import('../state').BattleRepairLedger; repairBy?: Record<string, import('../state').BattleRepairLedger> }
    | null
    | undefined,
): Array<{ tag: string; ledger: import('../state').BattleRepairLedger }> {
  if (!battle) return []
  if (battle.repairBy) return Object.entries(battle.repairBy).map(([tag, ledger]) => ({ tag, ledger }))
  return battle.repair ? [{ tag: 'player', ledger: battle.repair }] : []
}

export function shieldChargeLedgersOf(
  battle:
    | {
        shieldCharge?: import('../state').BattleShieldChargeLedger
        shieldChargeBy?: Record<string, import('../state').BattleShieldChargeLedger>
      }
    | null
    | undefined,
): Array<{ tag: string; ledger: import('../state').BattleShieldChargeLedger }> {
  if (!battle) return []
  if (battle.shieldChargeBy) return Object.entries(battle.shieldChargeBy).map(([tag, ledger]) => ({ tag, ledger }))
  return battle.shieldCharge ? [{ tag: 'player', ledger: battle.shieldCharge }] : []
}

export function refundRepairKitsAll(
  state: GameState,
  battle:
    | { repair?: import('../state').BattleRepairLedger; repairBy?: Record<string, import('../state').BattleRepairLedger> }
    | null
    | undefined,
): void {
  for (const { ledger } of repairLedgersOf(battle)) refundRepairKits(state, ledger)
}

export function repairUsageText(
  battle:
    | { repair?: import('../state').BattleRepairLedger; repairBy?: Record<string, import('../state').BattleRepairLedger>; repairDroneBy?: import('../state').BattleState['repairDroneBy'] }
    | null
    | undefined,
  ctx: SimContext,
): string {
  let total = 0
  const byType: Record<string, number> = {}
  for (const { ledger: r } of repairLedgersOf(battle)) {
    total += Math.max(0, Math.floor(r.kitsUsed ?? 0))
    for (const [id, n] of Object.entries(r.kitsUsedByType ?? {})) {
      if (n > 0) byType[id] = (byType[id] ?? 0) + n
    }
  }
  for (const ledger of Object.values(battle?.repairDroneBy ?? {})) {
    total += ledger.kitsUsed
    for (const [id, n] of Object.entries(ledger.kitsUsedByType)) byType[id] = (byType[id] ?? 0) + n
  }
  if (total <= 0) return ''
  const parts = Object.entries(byType)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${ctx.items.get(id)?.name ?? id} ×${n.toLocaleString('zh-CN')}`)
  if (parts.length === 0) return `消耗修理组件 ×${total.toLocaleString('zh-CN')}`
  return `消耗 ${parts.join('、')}`
}

export const SHIELD_PULSE_MS = 15_000

export const SHIELD_REGEN_FLOOR_PCT = 0.006

function fittedPulseParts(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  kind: 'shield-field' | 'shield-charge' | 'repair',
): Array<{ modelId: string; pct: number; ms: number; armorHp: number; hullHp: number }> {
  const ship = state.fleet[shipId]
  if (!ship) return []
  const out: Array<{ modelId: string; pct: number; ms: number; armorHp: number; hullHp: number }> = []
  for (const d of allFittedModules(ship.fitted, ctx)) {
    if (!moduleAllowedOnShip(fleetDefOf(state, ctx, shipId), d)) continue
    const st = pulseStreamOf(d)
    if (!st || st.kind !== kind) continue
    if (kind === 'shield-field') {
      out.push({
        modelId: d.id,
        pct: d.shieldFieldPct ?? 0,
        ms: equipmentCycleMsOf(state, ctx, shipId, d.shieldFieldMs ?? SHIELD_PULSE_MS),
        armorHp: 0,
        hullHp: 0,
      })
    } else if (kind === 'shield-charge') {
      out.push({ modelId: d.id, pct: d.shieldPulsePct ?? 0, ms: equipmentCycleMsOf(state, ctx, shipId, SHIELD_PULSE_MS), armorHp: 0, hullHp: 0 })
    } else {
      out.push({
        modelId: d.id,
        pct: 0,
        ms: equipmentCycleMsOf(state, ctx, shipId, REPAIR_PULSE_MS),
        armorHp: d.repairArmorHp ?? 0,
        hullHp: d.repairHullHp ?? 0,
      })
    }
  }
  return out
}

function pulsePartLive(kind: 'shield-field' | 'shield-charge' | 'repair', p: { pct: number; armorHp: number; hullHp: number }): boolean {
  return kind === 'repair' ? p.armorHp > 0 || p.hullHp > 0 : p.pct > 0
}

function pulseStreamsOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  kind: 'shield-field' | 'shield-charge' | 'repair',
): Array<{ modelId: string; pct: number; ms: number; armorHp: number; hullHp: number }> {
  const parts = fittedPulseParts(state, ctx, shipId, kind).filter((p) => pulsePartLive(kind, p))
  const byModel = new Map<string, { modelId: string; pct: number; ms: number; armorHp: number; hullHp: number }>()
  parts.forEach((p, i) => {
    const w = stackWeight(i + 1)
    const hit = byModel.get(p.modelId)
    if (hit) {
      hit.pct += p.pct * w
      hit.armorHp += p.armorHp * w
      hit.hullHp += p.hullHp * w
    } else {
      byModel.set(p.modelId, {
        modelId: p.modelId,
        pct: p.pct * w,
        ms: p.ms,
        armorHp: p.armorHp * w,
        hullHp: p.hullHp * w,
      })
    }
  })
  return [...byModel.values()]
}

export function repairStreamsOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): Array<{ modelId: string; ms: number; armorHp: number; hullHp: number }> {
  return pulseStreamsOf(state, ctx, shipId, 'repair')
}

export function shieldPulsePctOf(state: GameState, ctx: SimContext, shipId: string): number {
  return shieldChargeStreamsOf(state, ctx, shipId).reduce((n, s) => n + s.pct, 0)
}

export function shieldChargeStreamsOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): Array<{ modelId: string; pct: number; ms: number }> {
  return pulseStreamsOf(state, ctx, shipId, 'shield-charge')
}

export function preloadShieldChargeFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): import('../state').BattleState['shieldCharge'] | null {
  const streams = shieldChargeStreamsOf(state, ctx, shipId)
  if (streams.length === 0) return null
  return { streams: streams.map((s) => ({ modelId: s.modelId, pct: s.pct, ms: s.ms })), pulses: 0 }
}

export function shieldFieldOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { pct: number; ms: number } {
  const streams = shieldFieldStreamsOf(state, ctx, shipId)
  if (streams.length === 0) return { pct: 0, ms: 0 }
  return {
    pct: streams.reduce((n, s) => n + s.pct, 0),
    ms: Math.min(...streams.map((s) => s.ms)),
  }
}

export function shieldFieldStreamsOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): Array<{ modelId: string; pct: number; ms: number }> {
  return pulseStreamsOf(state, ctx, shipId, 'shield-field')
}

export function preloadShieldFieldFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): import('../state').BattleShieldFieldLedger | null {
  const streams = shieldFieldStreamsOf(state, ctx, shipId)
  if (streams.length === 0) return null
  return { streams: streams.map((s) => ({ modelId: s.modelId, pct: s.pct, ms: s.ms })), pulses: 0 }
}

export function pulseShieldFieldFor(
  b: import('../state').BattleState,
  myUnits: readonly UnitSpec[],
  stream: { pct: number },
  caster: UnitSpec,
): void {
  const gain = Math.max(0, stream.pct)
  if (!Number.isFinite(gain) || gain <= 0 || b.ended !== null || !isAlive(b, caster.tag)) return
  const casterRt = b.units[caster.tag]
  const casterCapS = Math.max(0, casterRt?.hpMax?.s ?? caster.hp.s)
  const amount = ceilFinalQuantity(casterCapS * gain * (1 + Math.max(0, caster.repairOutputBonusPct ?? 0)))
  const cost = ceilFinalQuantity(casterCapS * SHIELD_FIELD_COST_PCT)
  if (!casterRt || !Number.isFinite(amount) || amount <= 0 || casterRt.hp.s < cost) return
  const targets: Array<{ rt: (typeof b.units)[string]; capS: number }> = []
  for (const u of myUnits) {
    if (u.tag === caster.tag) continue
    const rt = b.units[u.tag]
    if (!rt || !isAlive(b, u.tag)) continue
    const capS = Math.max(0, rt.hpMax?.s ?? u.hp.s)
    if (capS <= 0 || rt.hp.s >= capS) continue
    targets.push({ rt, capS })
  }
  if (targets.length === 0) return
  targets.sort((a, b) => a.rt.hp.s / a.capS - b.rt.hp.s / b.capS)
  casterRt.hp.s = Math.max(0, casterRt.hp.s - cost)
  syncPlayerCrisis(b, [caster])
  for (const { rt, capS } of targets.slice(0, SHIELD_FIELD_MAX_TARGETS)) {
    rt.hp.s = Math.min(capS, rt.hp.s + amount)
  }
}

export function pulseShieldChargeFor(
  b: import('../state').BattleState,
  spec: UnitSpec,
  sc: import('../state').BattleShieldChargeLedger,
  stream?: { pct: number },
): void {
  const rt = b.units[spec.tag]
  if (!rt) return
  if (!isAlive(b, spec.tag)) return
  const capS = Math.max(0, rt.hpMax?.s ?? spec.hp.s)
  if (capS <= 0) return
  const pct = stream ? stream.pct : sc.streams.reduce((n, s) => n + s.pct, 0)
  const gain = ceilFinalQuantity(capS * Math.max(0, pct) * (1 + Math.max(0, spec.repairOutputBonusPct ?? 0)))
  if (gain > 0) rt.hp.s = Math.min(capS, rt.hp.s + gain)
}


export function pulseRepairsFor(
  state: GameState,
  ctx: SimContext,
  b: import('../state').BattleState,
  spec: UnitSpec,
  r: import('../state').BattleRepairLedger,
  allySpecs?: ReadonlyMap<string, UnitSpec>,
  only?: import('../state').BattleRepairUnit,
): boolean {
  const meRt = b.units[spec.tag]
  if (!meRt) return false
  if (!isAlive(b, spec.tag)) {
    r.nextPulseAtMs = undefined
    for (const u of r.units) u.nextPulseAtMs = undefined
    return false
  }
  let targetSpec: UnitSpec = spec
  let targetRt = meRt
  const capA = Math.max(0, targetRt.hpMax?.a ?? targetSpec.hp.a)
  const capH = Math.max(0, targetRt.hpMax?.h ?? targetSpec.hp.h)
  const hp = targetRt.hp
  const units = only ? [only] : r.units
  for (const u of units) {
    if (u.stopped) continue
    if (u.free) {
      const da0 = Math.max(0, capA - hp.a)
      const dh0 = Math.max(0, capH - hp.h)
      let ag0 = Math.min(u.armorPerPulse, da0)
      let hg0 = Math.min(u.hullPerPulse, dh0)
      if (ag0 < u.armorPerPulse && hg0 < dh0) hg0 += Math.min(u.armorPerPulse - ag0, dh0 - hg0)
      if (hg0 < u.hullPerPulse && ag0 < da0) ag0 += Math.min(u.hullPerPulse - hg0, da0 - ag0)
      if (ag0 <= 0 && hg0 <= 0) continue
      healArmorHp(hp, ag0)
      hp.h += hg0
      continue
    }
    const legacyLedger = Object.keys(r.kits).length > 0
    const preloadLeft = r.kits[u.kitId] ?? 0
    if (legacyLedger && preloadLeft <= 0) {
      u.stopped = true
      u.nextPulseAtMs = undefined
      continue
    }
    const da = Math.max(0, capA - hp.a)
    const dh = Math.max(0, capH - hp.h)
    let ag = Math.min(u.armorPerPulse, da)
    let hg = Math.min(u.hullPerPulse, dh)
    if (ag < u.armorPerPulse && hg < dh) hg += Math.min(u.armorPerPulse - ag, dh - hg)
    if (hg < u.hullPerPulse && ag < da) ag += Math.min(u.hullPerPulse - hg, da - ag)
    if (ag <= 0 && hg <= 0) continue
    if (!legacyLedger) {
      const shipUid = b.myFleet?.find((en) => en.tag === spec.tag)?.shipId ?? state.shipId
      const supply = wormholeSupplyForBattle(state, b)
      const ok =
        supply ? takeWormholeSupply(supply, u.kitId, 1) === 1 : state.resupplyFromWarehouse !== false
          ? countWare(state, u.kitId) > 0 && (removeWare(state, u.kitId, 1), true)
          : shipUid !== undefined && removeCargoOfShip(state, shipUid, u.kitId, 1) > 0
      if (!ok) continue
    }
    healArmorHp(hp, ag)
    hp.h += hg
    if (legacyLedger) r.kits[u.kitId] = preloadLeft - 1
    r.kitsUsed += 1
    r.kitsUsedByType = { ...(r.kitsUsedByType ?? {}) }
    r.kitsUsedByType[u.kitId] = (r.kitsUsedByType[u.kitId] ?? 0) + 1
  }
  r.pulses += 1
  const stillActive = r.units.some((u) => !u.stopped)
  if (!stillActive) r.nextPulseAtMs = undefined
  else if (r.nextPulseAtMs !== undefined) {
    const owner = b.myFleet?.find(e => e.tag === spec.tag)?.shipId ?? state.shipId
    r.nextPulseAtMs += equipmentCycleMsOf(state, ctx, owner, REPAIR_PULSE_MS)
  }
  return true
}
