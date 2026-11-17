import type { UnitSpec } from '../model'
import { syncCoronaFleetFocus } from '../coronaFocus'
import { pushBattleNotice, BATTLE_ARRIVAL_FLY_MS } from '../combatFx'
import { foeFamilyHpMulOf } from '../foePower'
import { ceilFinalQuantity } from '../../quantity'
import { clamp } from '../combatMath'
import { enemyFleetRoom } from './capacity'


export function createBattleState(
  me: UnitSpec,
  foes: UnitSpec[],
  nowMs: number,
  myDesireM: number,
  myAllies: readonly UnitSpec[] = [],
): import('../../state').BattleState {
  const units: Record<string, import('../../state').BattleState['units'][string]> = {}
  const foeMounts: string[] = []
  const foeMountPairs: Array<readonly [string, string]> = []
  for (const spec of [me, ...myAllies, ...foes]) {
    if (spec.foeReinforceAt) continue
    if (spec.side === 'foe' && enemyFleetRoom({ units } as import('../../state').BattleState) <= 0) continue
    if (spec.side === 'foe') {
      const names = spec.foeMountNames ?? []
      const pairs = spec.foeMountNamePairs ?? []
      for (let i = 0; i < names.length; i++) {
        const n = names[i]!
        if (foeMounts.includes(n)) continue
        foeMounts.push(n)
        foeMountPairs.push(pairs[i] ?? [n, n])
      }
    }
    units[spec.tag] = {
      tag: spec.tag,
      side: spec.side,
      name: spec.name,
      hp: { ...spec.hp },
      hpMax: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
      ...(spec.foeShipId !== undefined ? { foeShipId: spec.foeShipId } : {}),
      weapons: spec.weapons.map(w => spec.side === 'me' ? Math.max(1, w.reloadMs) : 0),
      ...(spec.stealthMs !== undefined && spec.stealthMs > 0
        ? { stealthUntilMs: nowMs + spec.stealthMs }
        : {}),
    }
  }
  const battle: import('../../state').BattleState = {
    startedAtGameMs: nowMs,
    lastTickGameMs: nowMs,
    distanceM: 0,
    myDesireM,
    units,
    ...(foeMounts.length > 0 ? { foeMounts } : {}),
    ...(foeMountPairs.length > 0 ? { foeMountNamePairs: foeMountPairs } : {}),
    ammo: { kin: 0, exp: 0, pla: 0 },
    stats: { meShots: 0, meHits: 0, meDmg: 0, foeShots: 0, foeHits: 0 },
    fx: [],
    fxSeq: 0,
    ended: null,
    droneHitAtMeBy: {},
    mePdFocusBy: {},
  }
  syncCoronaFleetFocus(battle, foes)
  return battle
}

export function announceStealthStart(b: import('../../state').BattleState): void {
  for (const u of Object.values(b.units)) {
    if (u.side !== 'me' || u.stealthUntilMs === undefined) continue
    const sec = Math.max(0, Math.round((u.stealthUntilMs - b.lastTickGameMs) / 1000))
    pushBattleNotice(b, `隐秘行动：${u.name} 进入隐身（${sec} 秒内不被锁定、不被攻击）`)
  }
}

export function announceSupportCallStart(
  b: import('../../state').BattleState,
  foes: readonly UnitSpec[],
): void {
  const caller = foes.find((f) => f.foeSupportCall !== undefined)
  if (caller === undefined || caller.foeSupportCall === undefined) return
  const sec = Math.max(0, Math.round(caller.foeSupportCall.delaySec))
  pushBattleNotice(b, `敌方呼叫增援：${sec} 秒后抵达`)
}

export function seedUnit(
  b: import('../../state').BattleState,
  spec: UnitSpec,
  opts: { enterReload?: boolean; arrivedAtMs?: number; foePhaseMs?: number } = {},
): void {
  if (b.units[spec.tag]) return
  if (spec.side === 'foe' && enemyFleetRoom(b) <= 0) return
  if (spec.side === 'foe' && spec.foeMountNames && spec.foeMountNames.length > 0) {
    const set = new Set(b.foeMounts ?? [])
    const pairs = new Map<string, readonly [string, string]>()
    const oldNames = b.foeMounts ?? []
    const oldPairs = b.foeMountNamePairs ?? []
    for (let i = 0; i < oldNames.length; i++) pairs.set(oldNames[i]!, oldPairs[i] ?? [oldNames[i]!, oldNames[i]!])
    const specPairs = spec.foeMountNamePairs ?? []
    for (let i = 0; i < spec.foeMountNames.length; i++) {
      const n = spec.foeMountNames[i]!
      set.add(n)
      if (!pairs.has(n)) pairs.set(n, specPairs[i] ?? [n, n])
    }
    const merged = [...set]
    b.foeMounts = merged
    b.foeMountNamePairs = merged.map((n) => pairs.get(n) ?? [n, n])
  }
  const windowMs = opts.arrivedAtMs !== undefined ? BATTLE_ARRIVAL_FLY_MS : 0
  const phase = opts.foePhaseMs ?? 0
  b.units[spec.tag] = {
    tag: spec.tag,
    side: spec.side,
    name: spec.name,
    hp: { ...spec.hp },
    hpMax: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
    ...(spec.foeShipId !== undefined ? { foeShipId: spec.foeShipId } : {}),
    weapons: opts.enterReload
      ? spec.weapons.map((w) => Math.max(1, w.reloadMs, windowMs) + phase)
      : spec.weapons.map(() => phase),
    ...(opts.arrivedAtMs !== undefined ? { enteredAtMs: opts.arrivedAtMs } : {}),
  }
}

export function initFoeDronePools(
  b: import('../../state').BattleState,
  foes: readonly UnitSpec[],
): void {
  const pools: Record<string, import('../../state').DronePoolEntry[]> = {}
  for (const f of foes) {
    if (!b.units[f.tag] || b.foeDronePools?.[f.tag]) continue
    const slots = f.foeDrones
    if (!slots || slots.length === 0) continue
    const list: import('../../state').DronePoolEntry[] = []
    const mk = (
      drone: (typeof slots)[number]['drone'],
      artId: string,
      inHangar: boolean,
    ): import('../../state').DronePoolEntry => {
      const d = drone.defense
      const hpMul = foeFamilyHpMulOf(drone.family)
      const resists = {
        ...(d.shieldResist ? { shield: d.shieldResist } : {}),
        ...(d.armorResist ? { armor: d.armorResist } : {}),
        ...(d.hullResist ? { hull: d.hullResist } : {}),
      }
      const hpOf = (value: number): number => Math.max(1, ceilFinalQuantity(value * hpMul))
      const s = hpOf(d.shieldHp)
      const a = hpOf(d.armorHp)
      const h = hpOf(d.hullHp)
      return {
        s,
        a,
        h,
        alive: true,
        artId,
        evasion: clamp(0, 0.9, d.evasion ?? 0),
        ...(Object.keys(resists).length > 0 ? { resists } : {}),
        maxS: s,
        maxA: a,
        maxH: h,
        ...(inHangar ? { inHangar: true } : {}),
      }
    }
    for (const ds of slots)
      for (let k = 0; k < Math.max(0, Math.round(ds.count)); k++)
        list.push(mk(ds.drone, ds.drone.id, false))
    const reserve = f.foeDroneReserve
    const reserveModel = slots[0]?.drone
    if (reserve && reserveModel)
      for (let k = 0; k < Math.max(0, Math.round(reserve.count)); k++)
        list.push(mk(reserveModel, reserveModel.id, true))
    if (list.length > 0) pools[f.tag] = list
  }
  if (Object.keys(pools).length > 0) b.foeDronePools = { ...b.foeDronePools, ...pools }
}

export function initFoeRepairPulses(
  b: import('../../state').BattleState,
  foes: readonly UnitSpec[],
): void {
  const need = foes.filter((f) => f.foeRepairPulse !== undefined)
  if (need.length === 0) return
  const ledgers = b.foeRepairPulses ?? {}
  let added = false
  for (const f of need) {
    if (!b.units[f.tag]) continue
    if (ledgers[f.tag]) continue
    ledgers[f.tag] = {
      nextPulseAtMs: (b.units[f.tag]!.enteredAtMs ?? b.startedAtGameMs) + Math.max(1, Math.round(f.foeRepairPulse!.everyMs)),
      pulses: 0,
      healed: 0,
    }
    added = true
  }
  if (added) b.foeRepairPulses = ledgers
}
