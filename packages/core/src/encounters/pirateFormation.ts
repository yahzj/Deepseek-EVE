import type { AnomalyDef, BattleBalance, FoeShipDef, FoeShipSlot } from '../types'
import type { UnitSpec } from '../combat/model'
import type { PirateFormationConfig } from './riskTypes'
import { createFoeSpecs, foeStrengthOf } from '../combat/foes/catalog'
import { foeHpOfThreat, foeThreatRatingOf } from '../combat/foePower'
import { SHIP_HP_UPLIFT_MUL } from '../combat/combatMath'
import { pickWeighted } from '../rng'
import { ceilFinalQuantity } from '../quantity'
import { compositionOfMix, splitShotByComposition } from '../combat/composition'

export interface PirateFormation {
  card: AnomalyDef
  targetThreat: number
  realizedThreat: number
  unusedStrength: number
}

/** 只认威胁和确定种子，不读玩家队伍、货量或活动类型。 */
export function pirateFormationOf(targetThreat: number, seed: number, config: PirateFormationConfig, catalog: ReadonlyMap<string, FoeShipDef>, bal: BattleBalance): PirateFormation | null {
  if (!Number.isSafeInteger(targetThreat) || targetThreat < 1 || !Number.isSafeInteger(seed)) throw new Error('pirate-formation-invalid-input')
  if (!Number.isSafeInteger(config.maxShips) || config.maxShips < 1 || config.maxShips > 12 || !Number.isSafeInteger(config.maxWaves) || config.maxWaves < 1 || config.maxWaves > 3 || !Number.isFinite(config.maxStatMultiplier) || config.maxStatMultiplier < 1 || config.maxStatMultiplier > 2 || !Number.isFinite(config.designStrengthMul) || config.designStrengthMul <= 0) throw new Error('pirate-formation-invalid-config')
  let specialLimit = 0
  let previous = -1
  for (const row of config.specialShipLimits) {
    if (!Number.isFinite(row.minThreat) || row.minThreat <= previous || !Number.isSafeInteger(row.maxCount) || row.maxCount < specialLimit || row.maxCount > config.maxShips) throw new Error('pirate-formation-invalid-special-limit')
    previous = row.minThreat
    if (targetThreat >= row.minThreat) specialLimit = row.maxCount
  }
  const template: AnomalyDef = { id: 'enc-pirate-generated', name: '', description: '', galaxyId: '', threat: targetThreat, standingReq: 0, standingGain: 0, rewardIsk: 0, loot: [], combatSeconds: 0, foeFamily: 'A', ships: [] }
  const choices = config.pool.map(row => {
    const ship = catalog.get(row.shipId)
    if (!ship || ship.family !== 'A' || ship.hullClassTier === 5 || !Number.isFinite(row.weight) || row.weight < 0) throw new Error(`pirate-formation-invalid-pool:${row.shipId}`)
    const slot: FoeShipSlot = { ship, count: 1, ...(row.mounts ? { mounts: row.mounts as FoeShipSlot['mounts'] } : {}) }
    const card = { ...template, name: ship.name, ships: [slot] }
    const spec = createFoeSpecs(card, bal)[0]!
    const rawSpec = createFoeSpecs(card, bal, { beforeHpUplift: true })[0]!
    if (spec.foeSummonEscort || spec.foeReviveEscort || spec.foeHatchery || spec.foeSupportCall) throw new Error(`pirate-formation-forbidden-mechanic:${ship.id}`)
    return { ...row, slot, spec, rawSpec }
  }).filter(row => row.weight > 0)
  const budget = foeHpOfThreat(targetThreat, bal) * config.designStrengthMul * Math.sqrt(SHIP_HP_UPLIFT_MUL) / 5
  const rng = { seed: seed >>> 0, count: 0 }
  const slots: FoeShipSlot[] = []
  const units: { spec: UnitSpec; rawSpec: UnitSpec; hpMul: number; dmgMul: number; added: boolean }[] = []
  let specialCount = 0
  const assemble = (): AnomalyDef => ({ ...template, name: slots[0]?.ship.name ?? '', ships: [...slots],
    waves: Array.from({ length: slots.length ? 1 + (slots.at(-1)!.wave ?? 0) : 0 }, (_, wave) => ({ units: slots.filter(slot => (slot.wave ?? 0) === wave).length, hpShare: 1 })),
    foeFormation: { baseline: template, layout: [...slots], units: [...units] } })
  for (let i = 0; i < config.maxShips * config.maxWaves; i++) {
    const wave = Math.floor(i / config.maxShips)
    const affordable = choices.filter(row => {
      if (row.special && specialCount >= specialLimit) return false
      slots.push({ ...row.slot, wave })
      units.push({ spec: row.spec, rawSpec: row.rawSpec, hpMul: 1, dmgMul: 1, added: false })
      const x = foeStrengthOf(assemble(), bal).x
      units.pop(); slots.pop()
      return x <= budget
    })
    if (!affordable.length) break
    const selected = pickWeighted(rng, affordable, row => row.weight)!
    slots.push({ ...selected.slot, wave })
    units.push({ spec: selected.spec, rawSpec: selected.rawSpec, hpMul: 1, dmgMul: 1, added: false })
    if (selected.special) specialCount++
  }
  if (!slots.length) return null
  const baseCard = assemble()
  // 只改血和武器伤害，保持挂载、射程、命中及节拍；固定规格与倍率分母同步，避免重复增幅。
  const amplify = (multiplier: number): AnomalyDef => {
    const layout = slots.map(slot => ({ ...slot, hpMul: multiplier, dmgMul: multiplier }))
    const scaledSpec = (source: UnitSpec): UnitSpec => {
      const spec = structuredClone(source)
      spec.hp = { s: ceilFinalQuantity(spec.hp.s * multiplier), a: ceilFinalQuantity(spec.hp.a * multiplier), h: ceilFinalQuantity(spec.hp.h * multiplier) }
      for (const weapon of spec.weapons) {
        if (weapon.shotDmg !== undefined) weapon.shotDmg = ceilFinalQuantity(weapon.shotDmg * multiplier)
        if (weapon.shotsByType) weapon.shotsByType = Object.fromEntries(splitShotByComposition(weapon.shotDmg ?? 0, compositionOfMix(weapon.shotsByType)).map(row => [row.type, row.dmg]))
      }
      return spec
    }
    return { ...baseCard, ships: layout, pirateGeneration: { version: 2, statMultiplier: multiplier },
      foeFormation: { baseline: template, layout, units: units.map(unit => ({ ...unit, spec: scaledSpec(unit.spec), rawSpec: scaledSpec(unit.rawSpec), hpMul: multiplier, dmgMul: multiplier })) } }
  }
  let low = 1, high = config.maxStatMultiplier
  if (high > 1 && foeStrengthOf(amplify(high), bal).x <= budget) low = high
  else for (let i = 0; i < 26 && high > low; i++) {
    const middle = (low + high) / 2
    if (foeStrengthOf(amplify(middle), bal).x <= budget) low = middle
    else high = middle
  }
  const card = amplify(low)
  const strength = foeStrengthOf(card, bal)
  const realizedThreat = foeThreatRatingOf(strength.x, config.designStrengthMul, bal)
  card.threat = realizedThreat
  // 挂载资格已按本次目标威胁冻结；标签重标不得再次改变建档判据。
  card.threatJudged = targetThreat
  return { card, targetThreat, realizedThreat, unusedStrength: Math.max(0, budget - strength.x) }
}
