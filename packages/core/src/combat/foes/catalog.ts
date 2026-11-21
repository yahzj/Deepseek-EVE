import type { AnomalyDef, BattleBalance, DamageType } from '../../types'
import { foeThreatRatingOf, TACTIC_RANGE, foeRefSpeedMps, foeSpeedBase, foeHpOfThreat, foeFamilyHpMulOf, foeShipHpMulOf, hasFixedFoeFormation } from '../foePower'
import type { UnitSpec } from '../model'
import { createFoeSpecsFromShips } from './ships'
import { PROFILE_SPLIT, pickTopType, splitShotByComposition, foeDamageComposition } from '../../wormholeFoes'
import { ceilFinalQuantity } from '../../quantity'
import type { Hp3 } from '../combatMath'
import { foeUnitNameOf } from '../foeCard'
import { fixedFormationSpecs } from './formation'

export function foeStrengthOf(anomaly: AnomalyDef, bal: BattleBalance): { hp: number; dps: number; x: number } {
  const idxs = new Set<number>()
  for (const s of anomaly.ships ?? []) idxs.add(Math.max(0, Math.floor(s.wave ?? 0)))
  if (idxs.size === 0) idxs.add(0)
  let hp = 0
  let peak = 0
  for (const i of idxs) {
    const specs = createFoeSpecs(anomaly, bal, { tagPrefix: i === 0 ? '' : `w${i}-` })
    let whp = 0
    let wdps = 0
    for (const f of specs) {
      whp += f.hp.s + f.hp.a + f.hp.h
      for (const w of f.weapons) wdps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
    }
    hp += whp
    peak = Math.max(peak, wdps)
  }
  return { hp, dps: peak, x: Math.sqrt(hp * peak) }
}

export function foeThreatOfAnomaly(anomaly: AnomalyDef, designMul: number, bal: BattleBalance): number {
  return foeThreatRatingOf(foeStrengthOf(anomaly, bal).x, designMul, bal)
}

export interface FoeSpecOpts {
  units?: number
  hpShare?: number
  tagPrefix?: string
  beforeHpUplift?: boolean
}

export function createFoeSpecs(anomaly: AnomalyDef, bal: BattleBalance, opts: FoeSpecOpts = {}): UnitSpec[] {
  if (hasFixedFoeFormation(anomaly)) return fixedFormationSpecs(anomaly, opts)
  if (anomaly.ships && anomaly.ships.length > 0) {
    const specs = createFoeSpecsFromShips(anomaly, bal, opts)
    for (const spec of specs) {
      const summon = spec.foeSummonEscort
      if (!summon) continue
      const source = anomaly.ships.find(slot => slot.ship.id === summon.shipId)
      if (!source) continue
      const sourceWave = source.wave ?? 0
      const template = createFoeSpecsFromShips(anomaly, bal, { tagPrefix: sourceWave === 0 ? '' : `w${sourceWave}-` })
        .find(unit => unit.foeShipId === summon.shipId)
      if (template) spec.foeSummonTemplate = { ...template, tag: `${opts.tagPrefix ?? ''}summon-${summon.shipId}` }
    }
    if (anomaly.wormholePdTags || anomaly.wormholeRepairScale !== undefined) {
      for (const spec of specs) {
        if (anomaly.wormholePdTags) spec.foePointDefenseEnabled = anomaly.wormholePdTags.includes(spec.tag)
        if (spec.foeRepairPulse && anomaly.wormholeRepairScale !== undefined) spec.foeRepairPulse.k = anomaly.wormholeRepairScale
      }
    }
    return specs
  }
  const tactic = anomaly.tactic ?? 'orbit'
  const split = PROFILE_SPLIT[anomaly.defProfile ?? 'balanced'] ?? PROFILE_SPLIT.balanced!
  const escorts = Math.max(0, Math.min(2, anomaly.escorts ?? 0))
  const waveUnits = Math.max(1, Math.floor(opts.units ?? 1))
  const hpShare = opts.hpShare ?? 1
  const prefix = opts.tagPrefix ?? ''
  const mainThreat = anomaly.threat / (1 + 0.6 * escorts)
  const mainType = pickTopType(anomaly.dmgMix)
  const rangeBase = TACTIC_RANGE[tactic]!
  const growMul = bal.foeRangeGrowMul[tactic] ?? 0.7
  const growT = Math.min(1, Math.max(0, (anomaly.threat - 10) / 90))
  const cap = bal.foeRangeCapM ?? 15_000
  const rangeMax = Math.min(cap, Math.round(rangeBase.max * (1 + growMul * growT)))
  const rangeMin = Math.max(1, Math.min(rangeMax - 1, Math.round(rangeBase.min * (1 + growMul * growT))))
  const refSpeed = foeRefSpeedMps(anomaly.threat, bal)
  const spdCap = Math.round(refSpeed * (bal.foeSpeedCapMul ?? 1.2))
  const tacticSpd = bal.foeSpeedTacticMul[tactic] ?? 1
  const foeSpeed = anomaly.foeSpeedMps ?? Math.min(spdCap, Math.round(refSpeed * foeSpeedBase(anomaly.threat, bal) * tacticSpd))

  const make = (tag: string, name: string, uThreat: number, type: DamageType): UnitSpec => {
    const baseHp = (anomaly.foeHpOverride ?? foeHpOfThreat(anomaly.threat, bal)) * hpShare
    const unitHp = (baseHp * uThreat) / Math.max(1, anomaly.threat)
    const totalHp = unitHp
    const hpMul = opts.beforeHpUplift ? foeFamilyHpMulOf(anomaly.foeFamily) : foeShipHpMulOf(anomaly.foeFamily)
    const hpValue = opts.beforeHpUplift ? (value: number) => value : ceilFinalQuantity
    const hp: Hp3 = { s: hpValue(totalHp * split.s * hpMul), a: hpValue(totalHp * split.a * hpMul), h: hpValue(totalHp * split.h * hpMul) }
    const dps = uThreat * bal.foeDpsPerThreat
    const effHit = type === 'plasma' ? 1 : anomaly.foeHitRate ?? bal.foeHitRate
    const shotDmg =
      anomaly.foeShotDmg ??
      Math.max(
        1,
        ceilFinalQuantity(((dps * bal.foeReloadMs) / 1000) * (effHit < 1 ? bal.foeHitCompMul / effHit : 1)),
      )
    const shotSplit = splitShotByComposition(shotDmg, foeDamageComposition(anomaly))
    const multiShots: Partial<Record<DamageType, number>> | undefined =
      shotSplit.length > 1
        ? shotSplit.reduce<Partial<Record<DamageType, number>>>((acc, r) => {
            acc[r.type] = (acc[r.type] ?? 0) + r.dmg
            return acc
          }, {})
        : undefined
    return {
      tag,
      name,
      side: 'foe',
      hp,
      resists: {},
      evasion: 0.12,
      hitBonus: 0,
      signatureM: Math.max(45, Math.round(60 + totalHp * 0.5)),
      scanResMm: 450,
      speedMps: foeSpeed,
      agility: 0.3,
      ...(bal.foeChargeEnabled === true &&
      anomaly.threat >= bal.foeChargeThreatFloor &&
      (anomaly.tactic ?? 'orbit') === 'brawl'
        ? { foeCanCharge: true }
        : {}),
      weapons: [
        {
          label: `${name} 武器组`,
          kind: type === 'plasma' ? 'beam' : 'fixed',
          fixedType: type,
          shotDmg,
          ...(multiShots ? { shotsByType: multiShots } : {}),
          maxRangeM: rangeMax,
          minRangeM: rangeMin,
          blindDmgMul: anomaly.blindDmgMul ?? 0.3,
          hitRate: type === 'plasma' ? 1 : anomaly.foeHitRate ?? bal.foeHitRate,
          falloff: anomaly.foeFalloff ?? bal.foeFalloff,
          reloadMs: bal.foeReloadMs,
        },
      ],
      foeTactic: tactic,
    }
  }
  const specs: UnitSpec[] = []
  for (let k = 0; k < waveUnits; k++) {
    const legacySquad = prefix === '' && k === 0
    const squadPrefix = legacySquad ? '' : `${prefix === "" ? "w0-" : prefix}`
    const mainTag = legacySquad ? 'foe-0' : `${squadPrefix}foe-${k}`
    specs.push(make(mainTag, foeUnitNameOf(anomaly, mainTag), mainThreat, mainType))
    for (let i = 1; i <= escorts; i++) {
      const escortTag = legacySquad ? `foe-${i}` : `${squadPrefix}foe-${k}-e${i}`
      specs.push(make(escortTag, foeUnitNameOf(anomaly, escortTag), mainThreat * 0.6, mainType))
    }
  }
  return specs
}

export function activeFoeSpecsOf(
  anomaly: AnomalyDef,
  bal: BattleBalance,
  waveIdx: number | undefined,
): UnitSpec[] {
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  if (!waves) return createFoeSpecs(anomaly, bal)
  const i = Math.min(Math.max(0, waveIdx ?? 0), waves.length - 1)
  const w = waves[i]!
  return createFoeSpecs(anomaly, bal, { units: w.units, hpShare: w.hpShare, tagPrefix: i === 0 ? '' : `w${i}-` })
}

export function flagshipBattleLedger(
  battle: import('../../state').BattleState,
  cardIds: readonly string[],
): { rawDmg: number; flagshipMaxHp: number; flagshipSeq: number } {
  const ids = new Set(cardIds)
  let rawDmg = 0
  let maxHp = 0
  let seq = 0
  for (const tag of Object.keys(battle.units)) {
    const u = battle.units[tag]!
    if (u.side !== 'foe') continue
    if (u.foeShipId === undefined || !ids.has(u.foeShipId)) continue
    const max = u.hpMax
    if (!max) continue
    const maxSum = max.s + max.a + max.h
    const curSum = u.hp.s + u.hp.a + u.hp.h
    rawDmg += maxSum - curSum
    maxHp += maxSum
    seq++
  }
  return { rawDmg: rawDmg < 0 ? rawDmg : ceilFinalQuantity(rawDmg), flagshipMaxHp: ceilFinalQuantity(maxHp), flagshipSeq: seq }
}
