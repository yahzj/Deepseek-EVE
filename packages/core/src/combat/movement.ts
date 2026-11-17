import type { BattleBalance } from '../types'
import type { UnitSpec } from './model'
import { isAlive, inRange } from './combatMath'
import { battleSpeedBonusOf } from './alienEquipment'

export function combatSpeed(maxSpeedMps: number, agility: number, bal: BattleBalance): number {
  return Math.max(20, maxSpeedMps * bal.speedFactor * (1 + (agility - 0.5) * 2 * bal.agilitySpeedBonus))
}

export function effectiveHitMul(spec: Pick<UnitSpec, 'hitMul'>, boosting: boolean): number {
  return boosting ? (spec.hitMul ?? 1) : 1
}

export function thrusterPhase(
  battle: Pick<import('../state').BattleState, 'lastTickGameMs' | 'startedAtGameMs'>,
  bal: BattleBalance,
  cycle?: { boostMs?: number; cooldownMs?: number },
): { boosting: boolean; remainMs: number; cycleMs: number; posMs: number } {
  const boostMs = cycle?.boostMs ?? bal.thrusterBoostMs
  const cooldownMs = cycle?.cooldownMs ?? bal.thrusterCooldownMs
  const cycleMs = Math.max(1, boostMs + cooldownMs)
  const elapsed = Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs)
  const posMs = elapsed % cycleMs
  const boosting = posMs < boostMs
  return { boosting, posMs, cycleMs, remainMs: boosting ? boostMs - posMs : cycleMs - posMs }
}

export function unitThrusterCycle(
  u: Pick<UnitSpec, 'thrusterBoostMs' | 'thrusterCooldownMs'>,
  bal: BattleBalance,
): { boostMs: number; cooldownMs: number } {
  return {
    boostMs: u.thrusterBoostMs ?? bal.thrusterBoostMs,
    cooldownMs: u.thrusterCooldownMs ?? bal.thrusterCooldownMs,
  }
}

export function updateFoeCharge(
  b: import('../state').BattleState,
  foes: UnitSpec[],
  bal: BattleBalance,
  nowMs: number,
  desireM: number,
): void {
  const margin = bal.foeChargeTriggerMarginM ?? 1_000
  const arrived = b.distanceM <= desireM
  for (const f of foes) {
    if (f.foeCanCharge !== true) continue
    const rt = b.foeCharges?.[f.tag]
    if (!isAlive(b, f.tag)) {
      if (rt && b.foeCharges) delete b.foeCharges[f.tag]
      continue
    }
    const w = f.weapons[0]
    const inOwnRange = w ? inRange(b.distanceM, w) : false
    const wantCharge = !inOwnRange || b.distanceM > desireM + margin
    if (rt?.on === true) {
      if (arrived) {
        rt.on = false
        rt.cdUntilMs = nowMs + (f.foeChargeCooldownMs ?? bal.foeChargeCooldownMs)
      }
      continue
    }
    if (nowMs >= (rt?.cdUntilMs ?? 0) && wantCharge) {
      if (!b.foeCharges) b.foeCharges = {}
      b.foeCharges[f.tag] = { ...(rt ?? {}), on: true }
    }
  }
}

export function releaseFoeChargeOnHit(
  b: import('../state').BattleState,
  tag: string,
  bal: BattleBalance,
  cdMs?: number,
): void {
  const rt = b.foeCharges?.[tag]
  if (rt?.on !== true) return
  rt.on = false
  rt.cdUntilMs = b.lastTickGameMs + (cdMs ?? bal.foeChargeCooldownMs)
}

export function unitSpeedMulOf(
  u: UnitSpec,
  b: import('../state').BattleState,
  bal: BattleBalance,
  side: 'me' | 'foe',
): number {
  if (side === 'me') {
    const boosting = thrusterPhase(b, bal, unitThrusterCycle(u, bal)).boosting
    return 1 + battleSpeedBonusOf(u, b, boosting)
  }
  if (b.foeCharges?.[u.tag]?.on !== true) return 1
  return u.foeChargeMul ?? bal.foeChargeMul
}

export function foeChargeCount(
  b: Pick<import('../state').BattleState, 'foeCharges' | 'units'>,
): number {
  let n = 0
  for (const [tag, rt] of Object.entries(b.foeCharges ?? {})) {
    if (rt?.on !== true) continue
    const u = b.units[tag]
    if (!u || !(u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0)) continue
    n += 1
  }
  return n
}

export function steerStep(cur: number, desire: number, speedMps: number, dtSec: number): number {
  const gap = desire - cur
  if (Math.abs(gap) < 0.5) return 0
  const cap = Math.max(5 * dtSec, speedMps * dtSec)
  const step = Math.min(Math.abs(gap), cap)
  return gap > 0 ? step : -step
}
