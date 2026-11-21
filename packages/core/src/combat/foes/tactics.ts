import type { BattleBalance } from '../../types'
import type { UnitSpec, WeaponSpec } from '../model'
import { foeGunMaxRangeOf, foeDroneRangeOf, foeRangeWithDebuff } from '../foeRange'
import { isAlive, clamp } from '../combatMath'
import { TACTIC_RANGE } from '../foePower'


export const FOE_BEAM_USABLE_SHARE = 0.7

export function blinkProcessMs(bal: BattleBalance): number {
  return Math.max(1, Math.round(bal.foeBlinkProcessMs ?? 200))
}

export function blinkGapMs(bal: BattleBalance): number {
  return Math.max(0, Math.round(bal.foeBlinkGapMs ?? 200))
}

export const BLINK_VANISH_SHARE_NUM = 1

export const BLINK_SHARE_DEN = 3

export function foeDecideReachM(
  b: import('../../state').BattleState | undefined,
  unit: UnitSpec,
): number {
  let top = 0
  for (const w of unit.weapons) {
    const reach = b !== undefined ? foeGunMaxRangeOf(b, unit, w) : w.maxRangeM
    top = Math.max(top, w.kind === 'beam' ? Math.round(reach * FOE_BEAM_USABLE_SHARE) : reach)
  }
  return top
}

export function battleOpenM(me: UnitSpec, foes: UnitSpec[], bal: BattleBalance): number {
  let top = 0
  for (const w of me.weapons) top = Math.max(top, w.maxRangeM)
  for (const f of foes) for (const w of f.weapons) top = Math.max(top, w.maxRangeM)
  const pad = Math.max(bal.openRangePadM, Math.round(top * (bal.openRangePadShare ?? 0.1)))
  return Math.round(top * bal.openRangeFactor + pad)
}

export function rFamilyDesireOf(
  me: UnitSpec,
  foes: readonly UnitSpec[],
  bal: BattleBalance,
  b?: import('../../state').BattleState,
): number | null {
  let meTop = 0
  let meBlindM = 0
  for (const w of me.weapons) {
    if (w.disabled || w.repairDrone) continue
    meTop = Math.max(meTop, w.maxRangeM)
    meBlindM = Math.max(meBlindM, w.minRangeM ?? 0)
  }
  if (meTop <= 0) return null
  const cap = foes.find((f) => f.family === 'R')
  if (!cap) return null
  const capTop = foeDecideReachM(b, cap as UnitSpec)
  if (capTop <= 0) return null
  const floor = bal.minDistanceM
  const capReachRaw = Math.max(cap.foeRangeBand?.max ?? 0, ...cap.weapons.map((w) => w.maxRangeM))
  const clampTo = (v: number): number => Math.max(floor, Math.min(Math.round(v), capReachRaw))
  if (capTop > meTop) return clampTo(meTop + 100)
  if (meBlindM > 0) {
    return clampTo(meBlindM < meTop ? Math.max(floor, meBlindM - 100) : meTop + 500)
  }
  return null
}

export function battleMaxDistanceM(
  b: import('../../state').BattleState,
  me: UnitSpec,
  foes: readonly UnitSpec[],
  bal: BattleBalance,
  ours?: readonly UnitSpec[],
): number {
  const open = battleOpenM(me, foes as UnitSpec[], bal)
  let top = 0
  for (const w of me.weapons) top = Math.max(top, w.maxRangeM)
  for (const u of ours ?? []) for (const w of u.weapons) top = Math.max(top, w.maxRangeM)
  for (const f of foes) {
    for (const w of f.weapons) {
      top = Math.max(top, w.src === 'drone' ? foeDroneRangeOf(b, w, f) : foeGunMaxRangeOf(b, f, w))
    }
  }
  const pad = Math.max(bal.openRangePadM, Math.round(top * (bal.openRangePadShare ?? 0.1)))
  return Math.max(open, Math.round(top * bal.openRangeFactor + pad))
}

export function mainWeaponOf(me: UnitSpec): WeaponSpec | undefined {
  let best: WeaponSpec | undefined
  let bestDps = -1
  for (const w of me.weapons) {
    if (w.disabled) continue
    if (best === undefined || w.maxRangeM > best.maxRangeM) {
      best = w
      bestDps = nominalWeaponDps(w)
    } else if (w.maxRangeM === best.maxRangeM) {
      const d = nominalWeaponDps(w)
      if (d > bestDps) {
        best = w
        bestDps = d
      }
    }
  }
  return best
}

export function nominalWeaponDps(w: WeaponSpec): number {
  const per = w.kind === 'gun' ? (Object.values(w.shotsByType ?? {})[0] ?? 0) : (w.shotDmg ?? 0)
  return (per * (w.count ?? 1)) / Math.max(0.1, w.reloadMs / 1000)
}

export function desiredRangeFor(
  me: UnitSpec,
  tactic: 'assault' | 'mid' | 'kite',
  bal: BattleBalance,
  midPos = bal.desireBandMid,
): number {
  const main = mainWeaponOf(me) ?? me.weapons[0]
  const mainMin = main ? main.minRangeM : 0
  const mainMax = main ? main.maxRangeM : 0
  if (tactic === 'assault') return Math.max(bal.minDistanceM, Math.round(mainMin * 0.6))
  if (tactic === 'kite') return Math.max(bal.minDistanceM + 1, Math.round(mainMax * 0.95))
  const pos = Math.min(1, Math.max(0, midPos))
  return Math.max(bal.minDistanceM, Math.round(mainMin + (mainMax - mainMin) * pos))
}


export function foeDesiredRange(
  _me: UnitSpec,
  foes: UnitSpec[],
  bal: BattleBalance,
  foeRangeDebuffR = 0,
  battle?: import('../../state').BattleState,
): number {
  const acidRoster = battle !== undefined && foes.some(f => f.acidBurst)
  if (acidRoster && foes.some(f => f.acidBurst && isAlive(battle!, f.tag))) return bal.minDistanceM
  const head = acidRoster ? foes.find(f => isAlive(battle!, f.tag)) : foes[0]
  const pinned = head?.foeDesireRangeM
  const band = head?.foeRangeBand ?? TACTIC_RANGE[head?.foeTactic ?? 'orbit']!
  const effMax = foeRangeDebuffR > 0 ? foeRangeWithDebuff(band.max, 1, foeRangeDebuffR) : band.max
  const isBeam = head !== undefined && head.weapons.some((w) => w.kind === 'beam')
  const decideMax = isBeam ? Math.round(effMax * FOE_BEAM_USABLE_SHARE) : effMax
  if (pinned !== undefined && Number.isFinite(pinned)) {
    const ratio = band.max > 0 ? decideMax / band.max : 1
    return Math.max(bal.minDistanceM, Math.round(pinned * ratio))
  }
  const pos = clamp(0.05, 0.95, bal.tacticDesireFactor[head?.foeTactic ?? 'orbit'] ?? 0.5)
  return Math.max(bal.minDistanceM, Math.min(effMax, Math.round(band.min + pos * (decideMax - band.min))))
}
