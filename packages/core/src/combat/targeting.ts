import type { UnitSpec } from './model'
import { isAlive } from './combatMath'
import { nominalWeaponDps } from './foes/tactics'
import type { ShipRole, FoeTargetingMode } from '../types'
import type { GameState } from '../state'
import { pickWeighted, nextRandom, nextInt } from '../rng'
import { isFoeEngageable } from './combatDrones'
import targeting from './targeting.json'

const SHIP_TIER_TARGET_WEIGHTS: Readonly<Record<number, number>> = targeting.shipTierWeights


export function isMyUnitTargetable(b: import('../state').BattleState, tag: string): boolean {
  const until = b.units[tag]?.stealthUntilMs
  return until === undefined || b.lastTickGameMs >= until
}

export function isMyUnitStealthed(b: import('../state').BattleState, tag: string): boolean {
  return !isMyUnitTargetable(b, tag)
}

export function isAliveAnyOf(b: import('../state').BattleState, myUnits: readonly UnitSpec[]): boolean {
  return myUnits.some((u) => isAlive(b, u.tag))
}

export function aliveMyUnits(
  b: import('../state').BattleState,
  myUnits: readonly UnitSpec[],
): UnitSpec[] {
  return myUnits.filter((u) => isAlive(b, u.tag))
}

export function myUnitOutputScore(u: UnitSpec): number {
  let sum = 0
  for (const w of u.weapons) sum += nominalWeaponDps(w)
  return sum
}

export function isNonCombatShipRole(role: ShipRole | undefined): boolean {
  return role === 'industrial' || role === 'hauler'
}

export function playerTargetWeightOf(unit: Pick<UnitSpec, 'shipTier' | 'targetWeightMul'>): number {
  const base = unit.shipTier !== undefined && Number.isInteger(unit.shipTier)
    ? SHIP_TIER_TARGET_WEIGHTS[unit.shipTier] ?? SHIP_TIER_TARGET_WEIGHTS[1]!
    : SHIP_TIER_TARGET_WEIGHTS[1]!
  const mod = unit.targetWeightMul
  const weight = base * (mod !== undefined && Number.isFinite(mod) && mod > 0 ? mod : 1)
  return Number.isFinite(weight) && weight > 0 ? weight : base
}

export function pickMyUnitTarget(
  state: GameState,
  b: import('../state').BattleState,
  myUnits: readonly UnitSpec[],
  mode: FoeTargetingMode = 'random',
  chance = 1,
): UnitSpec | null {
  if (myUnits.length === 1) {
    const only = myUnits[0]!
    return isMyUnitTargetable(b, only.tag) ? only : null
  }
  const alive = aliveMyUnits(b, myUnits).filter((u) => isMyUnitTargetable(b, u.tag))
  if (alive.length === 0) return null
  if (alive.length === 1) return alive[0]!
  const randomOf = (cands: UnitSpec[]): UnitSpec =>
    pickWeighted(state.rng, cands, playerTargetWeightOf) ?? cands[cands.length - 1]!
  const missed = chance < 1 && mode !== 'random' && nextRandom(state.rng) >= chance
  if (mode === 'random' || missed) return randomOf(alive)
  switch (mode) {
    case 'top-output': {
      const best = Math.max(...alive.map((u) => myUnitOutputScore(u)))
      return randomOf(alive.filter((u) => myUnitOutputScore(u) === best))
    }
    case 'smallest':
    case 'largest': {
      const tiers = alive.map((u) => u.shipTier ?? 1)
      const want = mode === 'smallest' ? Math.min(...tiers) : Math.max(...tiers)
      return randomOf(alive.filter((u) => (u.shipTier ?? 1) === want))
    }
    case 'noncombat': {
      const civ = alive.filter((u) => isNonCombatShipRole(u.shipRole))
      return civ.length > 0 ? randomOf(civ) : randomOf(alive)
    }
    default:
      return randomOf(alive)
  }
}

export function firstAliveFoe(foes: UnitSpec[], b: import('../state').BattleState): UnitSpec | null {
  for (const f of foes) if (isFoeEngageable(b, f.tag)) return f
  return null
}

export function lockAwareFoe(state: GameState, b: import('../state').BattleState, foes: UnitSpec[], unit: UnitSpec): UnitSpec | null {
  const chance = unit.lockTargetChance ?? ((unit.lockedDmgBonus ?? 0) > 0 ? 1 : 0)
  if (chance <= 0) return randomAliveFoe(state, b, foes)
  const alive = foes.filter(f => isFoeEngageable(b, f.tag))
  if (alive.length < 2) return alive[0] ?? null
  if (chance >= 1 || nextRandom(state.rng) < chance) return alive[0]!
  return alive[1 + nextInt(state.rng, alive.length - 1)]!
}

export function randomAliveFoe(state: import('../state').GameState, b: import('../state').BattleState, foes: UnitSpec[]): UnitSpec | null {
  const alive = foes.filter((f) => isFoeEngageable(b, f.tag))
  if (alive.length === 0) return null
  const i = nextInt(state.rng, alive.length)
  return alive[i]!
}
