import type { UnitSpec, WeaponSpec } from './model'
import type { DamageType, SimContext } from '../types'
import { BATTLE_VOLLEY_WINDOW_MS } from './constants'
import { gravekeeperResistsOf, advanceFoeRebirthRepair, activateFoeCapacitor } from './gravekeeperCombat'
import { acidResistsOf } from './alienEquipment'
import { type Hp3, applyDamage, applyDamageExact, finalizeHitDamage } from './combatMath'
import { triggerAcidBurst } from './alienCombat'
import { type GameState, addLog } from '../state'
import { wormholeSupplyForBattle, takeWormholeSupply } from '../wormholeSupplies'
import { countWare, removeWare, removeCargoOfShip } from '../inventory'
import { pushBattleNotice } from './combatFx'

export function standbyShieldActiveOf(
  unit: Pick<UnitSpec, 'foeStandbyShield' | 'foeBlink'>,
  blinkReadyAtMs: number | undefined,
  nowMs: number,
): boolean {
  if (unit.foeStandbyShield === undefined) return false
  if (blinkReadyAtMs === undefined || nowMs >= blinkReadyAtMs) return false
  const cooldown = unit.foeBlink?.cooldownMs
  if (cooldown === undefined) return false
  const triggeredAt = blinkReadyAtMs - cooldown
  return nowMs >= triggeredAt + unit.foeStandbyShield.delayMs
}

export function withStandbyShield(
  resists: UnitSpec['resists'],
  resistPct: number,
): UnitSpec['resists'] {
  const merge = (t: DamageType): number => 1 - (1 - (resists.shield?.[t] ?? 0)) * (1 - resistPct)
  return {
    ...resists,
    shield: { kinetic: merge('kinetic'), explosive: merge('explosive'), plasma: merge('plasma') },
  }
}

export function foeStandbyReadyOf(
  b: {
    startedAtGameMs?: number
    lastTickGameMs?: number
    foeBlinks?: Record<string, number>
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
  },
  foe: Pick<UnitSpec, 'tag' | 'foeStandbyShield' | 'foeBlink'>,
): boolean {
  if (foe.foeStandbyShield === undefined) return false
  const now = b.lastTickGameMs ?? 0
  const anchor = b.startedAtGameMs ?? 0
  const windowAt = anchor + Math.floor((now - anchor) / BATTLE_VOLLEY_WINDOW_MS) * BATTLE_VOLLEY_WINDOW_MS
  const reg = b.foeStandbyTick ?? (b.foeStandbyTick = {})
  const hit = reg[foe.tag]
  if (hit !== undefined && hit.atMs === windowAt) return hit.ready
  const ready = standbyShieldActiveOf(foe, b.foeBlinks?.[foe.tag], now)
  reg[foe.tag] = { atMs: windowAt, ready }
  return ready
}

export function foeResistsNow(
  b: {
    lastTickGameMs?: number
    foeAcidLayers?: import('../state').BattleState['foeAcidLayers']
    foeBlinks?: Record<string, number>
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
    foeCoatingLayers?: import('../state').BattleState['foeCoatingLayers']
  },
  foe: {
    tag: string
    resists?: UnitSpec['resists']
    foeCoatingArmor?: UnitSpec['foeCoatingArmor']
    foeStandbyShield?: UnitSpec['foeStandbyShield']
    foeBlink?: UnitSpec['foeBlink']
  },
): UnitSpec['resists'] {
  const base = foe.foeStandbyShield !== undefined && foeStandbyReadyOf(b, foe)
    ? withStandbyShield(foe.resists ?? {}, foe.foeStandbyShield.resistPct)
    : (foe.resists ?? {})
  const coated = gravekeeperResistsOf(b, foe, base, b.lastTickGameMs ?? 0)
  return b.foeAcidLayers ? acidResistsOf(b, foe.tag, coated) : coated
}

export function snapshotFoeStandby(b: import('../state').BattleState, foes: readonly UnitSpec[]): void {
  for (const f of foes) foeStandbyReadyOf(b, f)
}

export function applyFoeUnitDamage(
  b: {
    distanceM?: number
    alienCorrosion?: number
    acidBursts?: import('../state').BattleState['acidBursts']
    foeAcidLayers?: import('../state').BattleState['foeAcidLayers']
    units: Record<string, { hp: Hp3; hpMax?: Hp3; foeShipId?: string; downAtMs?: number }>
    foeOverride?: { bossShipId?: string }
    lastTickGameMs?: number
    bossDownAtMs?: number
    foeBlinks?: Record<string, number>
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
    foeCoatingLayers?: import('../state').BattleState['foeCoatingLayers']
    foeRebirths?: import('../state').BattleState['foeRebirths']
    foeShieldCapacitorActive?: import('../state').BattleState['foeShieldCapacitorActive']
  },
  foe: {
    tag: string
    hp?: Hp3
    acidBurst?: UnitSpec['acidBurst']
    resists?: UnitSpec['resists']
    foeStandbyShield?: UnitSpec['foeStandbyShield']
    foeBlink?: UnitSpec['foeBlink']
    foeRebirthProtocol?: UnitSpec['foeRebirthProtocol']
    foeCoatingArmor?: UnitSpec['foeCoatingArmor']
    foeShieldCapacitor?: UnitSpec['foeShieldCapacitor']
  },
  dmg: number,
  type: DamageType,
  atMsOverride?: number,
  secondary?: { dmg: number; type: DamageType },
): { dealt: number; killedNow: boolean; resistsUsed?: UnitSpec['resists'] } {
  const rt = b.units[foe.tag]
  if (!rt || rt.hp.s + rt.hp.a + rt.hp.h <= 0) return { dealt: 0, killedNow: false }
  const atMs = b.lastTickGameMs ?? atMsOverride ?? 0
  if (foe.foeRebirthProtocol && foe.hp) advanceFoeRebirthRepair(b, { ...foe, hp: foe.hp }, atMs)
  const wasAlive = rt.hp.s + rt.hp.a + rt.hp.h > 0
  const beforeHp = { ...rt.hp }
  const resists = foeResistsNow(b, foe)
  const apply = (raw: number): Hp3 => {
    const main = applyDamageExact(rt.hp, resists, raw, type).hp
    const after = secondary && secondary.dmg > 0 && dmg > 0
      ? applyDamageExact(main, resists, secondary.dmg * raw / dmg, secondary.type).hp : main
    return finalizeHitDamage(rt.hp, after).hp
  }
  const state = b.foeRebirths?.[foe.tag]
  const inRebirthLock = state?.lockUntilMs !== undefined && state.lockUntilMs > atMs
  const lethal = foe.foeRebirthProtocol !== undefined && dmg > 0 && apply(dmg).h <= 0
  let appliedDmg = dmg
  if (foe.foeRebirthProtocol !== undefined && inRebirthLock) {
    appliedDmg = clampRawLeavingHull(apply, dmg)
  } else if (foe.foeRebirthProtocol !== undefined && lethal && state === undefined) {
    const protocol = foe.foeRebirthProtocol
    const rebirths = b.foeRebirths ?? (b.foeRebirths = {})
    rebirths[foe.tag] = {
      lockUntilMs: atMs + DC_LOCK_MS,
      startedAtMs: atMs,
      repairUntilMs: atMs + protocol.repairMs,
      lastRepairAtMs: atMs,
      armorHealed: 0,
      hullHealed: 0,
    }
    appliedDmg = clampRawLeavingHull(apply, dmg)
  }
  const afterHit = apply(appliedDmg)
  const r = finalizeHitDamage(rt.hp, afterHit)
  rt.hp = r.hp
  if (foe.foeShieldCapacitor !== undefined && beforeHp.s > 0 && rt.hp.s <= 0) {
    activateFoeCapacitor(b, foe.tag)
  }
  if (foe.foeCoatingArmor !== undefined && beforeHp.a > r.hp.a) {
    const layers = b.foeCoatingLayers ?? (b.foeCoatingLayers = {})
    const active = (layers[foe.tag] ?? []).filter((x) => x.untilMs > atMs)
    active.push({ untilMs: atMs + foe.foeCoatingArmor.durationMs })
    layers[foe.tag] = active
  }
  let killedNow = false
  if (rt.hp.s + rt.hp.a + rt.hp.h <= 0) {
    const downAtMs = atMsOverride ?? atMs
    if (rt.downAtMs === undefined) rt.downAtMs = downAtMs
    killedNow = wasAlive
    if (killedNow) triggerAcidBurst(b, foe, 'killed', downAtMs)
    const bossId = b.foeOverride?.bossShipId
    if (killedNow && bossId !== undefined && rt.foeShipId === bossId) {
      b.bossDownAtMs ??= downAtMs
    }
  }
  return { dealt: r.dealt, killedNow, resistsUsed: resists }
}

export function rawDamageToKill(hp: Hp3, resists: UnitSpec['resists'], type: DamageType): number {
  const total = hp.s + hp.a + hp.h
  if (total <= 0) return 0
  let lo = 0
  let hi = total * 12 + 8
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (applyDamageExact(hp, resists, mid, type).dealt >= total - 1e-9) hi = mid
    else lo = mid
  }
  return hi
}

export function carryVolleyOverflow(
  b: {
    foeAcidLayers?: import('../state').BattleState['foeAcidLayers']
    distanceM?: number
    alienCorrosion?: number
    acidBursts?: import('../state').BattleState['acidBursts']
    units: Record<string, { hp: Hp3; foeShipId?: string; downAtMs?: number }>
    stats: { meDmg: number }
    foeOverride?: { bossShipId?: string }
    lastTickGameMs?: number
    foeBlinks?: Record<string, number>
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
  },
  foes: readonly UnitSpec[],
  killedTag: string,
  type: DamageType,
  rawDamage: number,
  hpBefore: Hp3,
  maxChain = 3,
  resistsBefore?: UnitSpec['resists'],
): { total: number; hits: number; lastTag: string | null } {
  let raw = rawDamage
  let prevHp = hpBefore
  let prevTag = killedTag
  let total = 0
  let hits = 0
  let lastTag: string | null = null
  let previousResists = resistsBefore
  for (let n = 0; n < maxChain; n++) {
    const prevFoe = foes.find((f) => f.tag === prevTag)
    const prevRes = previousResists ?? (prevFoe ? foeResistsNow(b, prevFoe) : {})
    const excess = raw - rawDamageToKill(prevHp, prevRes, type)
    if (excess <= 0.5) break
    const next = foes.find((f) => {
      if (f.tag === prevTag) return false
      const rt = b.units[f.tag]
      return !!rt && rt.hp.s + rt.hp.a + rt.hp.h > 0
    })
    if (!next) break
    const rt = b.units[next.tag]!
    const before = { ...rt.hp }
    const r = applyFoeUnitDamage(b, next, excess, type)
    previousResists = r.resistsUsed
    b.stats.meDmg += r.dealt
    total += r.dealt
    hits += 1
    lastTag = next.tag
    raw = excess
    prevHp = before
    prevTag = next.tag
    if (rt.hp.s + rt.hp.a + rt.hp.h > 0) break
  }
  return { total, hits, lastTag }
}

export const PLAYER_VOLLEY_DMG_CAP_SHARE = 0.8

export function playerVolleyDamageRoomOf(b: import('../state').BattleState, tag: string, spec: UnitSpec): number {
  const max = b.units[tag]?.hpMax ?? spec.hp
  const full = max.s + max.a + max.h
  return full > 0 ? Math.max(0, full * PLAYER_VOLLEY_DMG_CAP_SHARE - (b.meVolleyDmg?.[tag] ?? 0)) : Infinity
}

export function cappedFoeDamage(
  b: import('../state').BattleState,
  tag: string,
  spec: UnitSpec,
  dmg: number,
): number {
  if (dmg <= 0) return dmg
  const used = b.meVolleyDmg?.[tag] ?? 0
  const room = playerVolleyDamageRoomOf(b, tag, spec)
  const out = Math.min(dmg, Number.isFinite(room) ? Math.floor(room) : room)
  b.meVolleyDmg = { ...(b.meVolleyDmg ?? {}), [tag]: used + out }
  return out
}

export function applyPlayerUnitDamage(
  state: GameState,
  b: import('../state').BattleState,
  tag: string,
  spec: UnitSpec,
  raw: number,
  type: DamageType,
  applyRaw?: (r: number) => Hp3,
): number {
  const rt = b.units[tag]
  if (!rt || raw <= 0) return 0
  const before = rt.hp
  const hit = applyRaw ? finalizeHitDamage(before, applyRaw(raw)) : applyDamage(before, spec.resists, raw, type)
  const after = hit.hp
  const loss = { s: Math.max(0, before.s - after.s), a: Math.max(0, before.a - after.a), h: Math.max(0, before.h - after.h) }
  const total = hit.dealt
  const room = playerVolleyDamageRoomOf(b, tag, spec)
  const amount = Math.min(total, Number.isFinite(room) ? Math.floor(room) : room)
  const apply = (damage: number): Hp3 => {
    if (damage >= total) return after
    const hp = { ...before, ...(before.coating ? { coating: { ...before.coating } } : {}) }
    for (const key of ['s', 'a', 'h'] as const) {
      const take = Math.min(loss[key], damage)
      hp[key] -= take
      damage -= take
    }
    if (hp.coating) hp.coating.armor = Math.min(hp.coating.armor, hp.a)
    return hp
  }
  const guarded = applyDcGuard(state, b, tag, spec, before, amount, type, apply)
  let finalAmount = guarded
  if (guarded < amount) {
    const candidate = Math.min(amount, Math.floor(guarded) + 1)
    finalAmount = apply(candidate).h >= 1 ? candidate : Math.floor(guarded)
  }
  rt.hp = finalAmount === total ? after : apply(finalAmount)
  return cappedFoeDamage(b, tag, spec, finalAmount)
}

export const DC_LOCK_MS = 1_000

export function applyDcGuard(
  state: GameState,
  b: import('../state').BattleState,
  tag: string,
  spec: UnitSpec,
  hpNow: Hp3,
  raw: number,
  type: DamageType | undefined,
  applyRaw?: (r: number) => Hp3,
): number {
  if (raw <= 0 || spec.hullSaveKit === undefined) return raw
  const apply = (r: number): Hp3 => (applyRaw ? applyRaw(r) : applyDamage(hpNow, spec.resists, r, type ?? 'kinetic').hp)
  const st = b.dc?.[tag]
  const inWindow = st?.lockUntilMs !== undefined && st.lockUntilMs > b.lastTickGameMs
  const belowFloor = apply(raw).h < 1
  if (inWindow) {
    return belowFloor ? clampRawLeavingHull(apply, raw) : raw
  }
  if (!belowFloor) return raw
  if (st?.used === true) return raw
  const kitId = spec.hullSaveKit
  const shipId = spec.shipId ?? state.shipId
  const supply = wormholeSupplyForBattle(state, b)
  const took = supply ? takeWormholeSupply(supply, kitId, 1) === 1 : state.resupplyFromWarehouse !== false
    ? countWare(state, kitId) > 0 && (removeWare(state, kitId, 1), true)
    : removeCargoOfShip(state, shipId, kitId, 1) > 0
  if (!took) {
    addLog(state, 'warn', '损伤管制装置未能启动：损管修理组件不足。', 'core.combat.003')
    return raw
  }
  b.dcKitsUsed = Math.max(0, Math.floor(b.dcKitsUsed ?? 0)) + 1
  b.dc = { ...(b.dc ?? {}), [tag]: { lockUntilMs: b.lastTickGameMs + DC_LOCK_MS, used: true } }
  if (spec.rebirthRepair) {
    const book = b.meRebirths ??= {}
    book[tag] = { repairUntilMs: b.lastTickGameMs + spec.rebirthRepair.repairMs,
      lastRepairAtMs: b.lastTickGameMs, armorHealed: 0, hullHealed: 0 }
  }
  addLog(state, 'combat', '✦ 损伤管制装置启动：结构锁定在 1 点、持续 1 秒（消耗损管修理组件 ×1）。', 'core.combat.002')
  pushBattleNotice(b, '损伤管制装置启动：结构锁定 1')
  return clampRawLeavingHull(apply, raw)
}

export function clampRawLeavingHull(apply: (r: number) => Hp3, raw: number): number {
  if (apply(0).h < 1) return 0
  if (apply(raw).h >= 1) return raw
  let lo = 0
  let hi = raw
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    if (apply(mid).h >= 1) lo = mid
    else hi = mid
  }
  return lo
}

export function dcUsageText(
  battle: { dcKitsUsed?: number } | null | undefined,
  ctx: SimContext,
): string {
  const n = Math.max(0, Math.floor(battle?.dcKitsUsed ?? 0))
  if (n <= 0) return ''
  const kitName = ctx.items.get('repairkit-dc')?.name ?? '损管修理组件'
  return `损伤管制装置启动 ×${n.toLocaleString('zh-CN')}（消耗${kitName} ×${n.toLocaleString('zh-CN')}）`
}

export function applyFoeShot(
  hp: Hp3,
  resists: UnitSpec['resists'],
  weapon: WeaponSpec,
  totalDmg: number,
  mainType: DamageType,
): Hp3 {  const shots = weapon.shotsByType
  const entries = shots ? Object.entries(shots).filter(([, v]) => (v ?? 0) > 0) : []
  if (entries.length <= 1) return applyDamage(hp, resists, totalDmg, mainType).hp
  const sum = entries.reduce((s, [, v]) => s + (v ?? 0), 0)
  if (sum <= 0) return applyDamage(hp, resists, totalDmg, mainType).hp
  let next = hp
  let left = totalDmg
  entries.forEach(([t, v], i) => {
    const share = (totalDmg * (v ?? 0)) / sum
    const dmg = i === entries.length - 1 ? left : share
    const take = Math.max(0, Math.min(left, dmg))
    if (take <= 0) return
    next = applyDamageExact(next, resists, take, t as DamageType).hp
    left -= take
  })
  return finalizeHitDamage(hp, next).hp
}
