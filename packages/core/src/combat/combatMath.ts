import type { AnomalyDef, BattleBalance, DamageResists, DamageType } from '../types'
import type { BattleState, GameState } from '../state'
import { ceilFinalQuantity } from '../quantity'

export interface Hp3 {
  coating?: { armor: number; maxArmor: number }
  s: number
  a: number
  h: number
}

export const SHIP_HP_UPLIFT_MUL = 1.5

export function playerWeaponInRange(dist: number, w: { src?: string; minRangeM: number; maxRangeM: number }): boolean {
  return w.src === 'drone' ? inRange(dist, w) : dist >= 0 && dist <= w.maxRangeM
}

export function playerBlindDamageMul(dist: number, w: { src?: string; minRangeM: number }, vsDrone = false): number {
  return !vsDrone && w.src !== 'drone' && dist < w.minRangeM ? 0.3 : 1
}

export function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v))
}

export const RESIST_FLOOR = -0.9

export function typeLayerMult(t: DamageType, layer: 'shield' | 'armor' | 'hull'): number {
  if (t === 'kinetic') return layer === 'shield' ? 1.5 : layer === 'armor' ? 0.75 : 1
  if (t === 'explosive') return layer === 'shield' ? 0.75 : layer === 'armor' ? 1.5 : 1
  return layer === 'shield' ? 1.25 : 1
}


export function distFactor(dist: number, w: { minRangeM: number; maxRangeM: number; falloff: number }): number {
  const { minRangeM: min, maxRangeM: max, falloff } = w
  if (max <= min) return 1
  const t = clamp(0, 1, (dist - min) / (max - min))
  return 1 - t * (1 - falloff)
}

export function inRange(dist: number, w: { minRangeM: number; maxRangeM: number }): boolean {
  return dist >= w.minRangeM && dist <= w.maxRangeM
}

export function hitChance(
  weapon: { hitRate: number; minRangeM: number; maxRangeM: number; falloff: number; eqHitMul?: number },
  attacker: { hitBonus: number; scanResMm?: number; hitMul?: number },
  defender: { evasion: number; signatureM?: number },
  dist: number,
  bal: BattleBalance,
  dfOverride?: number,
): number {
  const df = dfOverride ?? distFactor(dist, weapon)
  const raw = (weapon.hitRate + attacker.hitBonus - defender.evasion) * df
  return clamp(bal.hitMin, bal.hitMax, raw * (weapon.eqHitMul ?? 1) * (attacker.hitMul ?? 1))
}

export function droneHitChance(
  weapon: Parameters<typeof hitChance>[0],
  attacker: Parameters<typeof hitChance>[1] & { droneHitGapPct?: number },
  evasion: number,
  bal: BattleBalance,
): number {
  const gap = clamp(0, 0.9, attacker.droneHitGapPct ?? 0)
  return hitChance(weapon, attacker, { evasion: evasion * (1 - gap) }, 0, bal, 1)
}

export function applyDamage(
  hp: Hp3,
  resists: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists },
  dmg: number,
  type: DamageType,
  shieldDamageMul = 1,
): { hp: Hp3; dealt: number } {
  return finalizeHitDamage(hp, applyDamageExact(hp, resists, dmg, type, shieldDamageMul).hp)
}

export function applyDamageExact(
  hp: Hp3,
  resists: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists },
  dmg: number,
  type: DamageType,
  shieldDamageMul = 1,
): { hp: Hp3; dealt: number } {
  const next: Hp3 = { ...hp, ...(hp.coating ? { coating: { ...hp.coating } } : {}) }
  const rest0 = Math.max(0, dmg)
  const layerKey: Array<'s' | 'a' | 'h'> = ['s', 'a', 'h']
  const layerName: Array<'shield' | 'armor' | 'hull'> = ['shield', 'armor', 'hull']
  const before = hp.s + hp.a + hp.h

  const mulAt = (i: number): number => typeLayerMult(type, layerName[i]!)
  let probe = rest0
  let land = 2
  for (let i = 0; i < 3; i++) {
    if (probe <= 0) {
      land = i
      break
    }
    probe -= next[layerKey[i]!]
    if (probe <= 0) {
      land = i
      break
    }
  }
  const coef = mulAt(land)
  let rest = rest0
  for (let i = 0; i < 3 && rest > 0; i++) {
    const res = resists[layerName[i]!]?.[type] ?? 0
    const layerCoef = coef * (i === 0 ? shieldDamageMul : 1)
    const layerDamage = next[layerKey[i]!] / Math.max(1e-9, layerCoef * (1 - clamp(RESIST_FLOOR, 0.9, res)))
    const absorbedRaw = Math.min(rest, layerDamage)
    next[layerKey[i]!] = absorbedRaw >= layerDamage ? 0
      : next[layerKey[i]!] - Math.min(next[layerKey[i]!], absorbedRaw * layerCoef * (1 - clamp(RESIST_FLOOR, 0.9, res)))
    rest -= absorbedRaw
  }
  const after = next.s + next.a + next.h
  if (next.coating) next.coating.armor = Math.min(next.coating.armor, next.a)
  return { hp: next, dealt: Math.max(0, before - after) }
}

export function finalizeHitDamage(before: Hp3, after: Hp3): { hp: Hp3; dealt: number } {
  const hp = { ...after, ...(after.coating ? { coating: { ...after.coating } } : {}) }
  const total = before.s + before.a + before.h
  const exact = Math.max(0, (before.s - hp.s) + (before.a - hp.a) + (before.h - hp.h))
  const nearest = Math.round(exact)
  const tolerance = Math.min(1e-8, Number.EPSILON * Math.max(1, total) * 4)
  const settled = nearest > 0 && Math.abs(exact - nearest) <= tolerance ? nearest : ceilFinalQuantity(exact)
  const dealt = Math.min(total, settled)
  let extra = Math.max(0, dealt - exact)
  for (const key of ['s', 'a', 'h'] as const) {
    const take = Math.min(hp[key], extra)
    hp[key] -= take
    extra -= take
  }
  if (hp.coating) hp.coating.armor = Math.min(hp.coating.armor, hp.a)
  return { hp, dealt }
}

export function healArmorHp(hp: Hp3, amount: number): void {
  hp.a += amount
  if (hp.coating) hp.coating.armor = Math.min(hp.coating.maxArmor, hp.coating.armor + amount)
}

export function isAlive(b: BattleState, tag: string): boolean {
  const u = b.units[tag]
  return !!u && (u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0)
}

export function waveGapTotalMs(anomaly: Pick<AnomalyDef, 'waves'> | undefined, bal: BattleBalance): number {
  const n = anomaly?.waves?.length ?? 1
  return Math.max(0, n - 1) * Math.max(0, bal.waveEnterGapMs ?? 0)
}

export function battleSpeedOf(battle: BattleState): number {
  const v = battle.speedX
  return typeof v === 'number' && Number.isFinite(v) && v > 1 ? v : 1
}

export function battleShowWindowMs(battle: BattleState, ms: number): number {
  return ms * battleSpeedOf(battle)
}

export function battleClockNowMs(
  state: GameState,
  battle: BattleState,
): number {
  const axis = battle.speedAxis
  if (!axis) return state.gameMs
  const x = battleSpeedOf(battle)
  return Math.max(axis.clock + (state.gameMs - axis.anchor) * x, state.gameMs)
}
