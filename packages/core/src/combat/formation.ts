import type { AnomalyDef, BattleBalance, FoeShipDef, FoeShipSlot } from '../types'
import type { UnitSpec } from './model'
import { createFoeSpecs, foeStrengthOf } from './foes/catalog'
import { enumerateShipUnits } from './foeCard'
import { foeHpOfThreat, foeThreatAtHpBudgetOf, foeJudgedThreatOf } from './foePower'
import { ceilFinalQuantity } from '../quantity'
import { compositionOfMix, splitShotByComposition } from './composition'
import { resolveFoeMounts } from './foeMounts'

export interface EnemyFormationPlan {
  counts?: readonly number[]
  boostSlots?: readonly number[]
  hpMul?: number
  dmgMul?: number
  extras?: readonly { wave: number; shipId: string; count: number; share?: number }[]
}

type FormationCacheEntry = { catalog?: ReadonlyMap<string, FoeShipDef>; card: AnomalyDef }
const memo = new WeakMap<AnomalyDef, WeakMap<BattleBalance, Map<string, FormationCacheEntry>>>()

/** 旧编成先建档，再复制完整单位；新人数不再参与补偿或整波DPS折扣。 */
export function enemyFormationCard(
  baseline: AnomalyDef,
  bal: BattleBalance,
  plan: EnemyFormationPlan,
  shipCatalog?: ReadonlyMap<string, FoeShipDef>,
): AnomalyDef {
  if (!baseline.ships?.length || baseline.foeFormation) return baseline
  const key = JSON.stringify(plan)
  const byBalance = memo.get(baseline) ?? new WeakMap<BattleBalance, Map<string, FormationCacheEntry>>()
  const cache = byBalance.get(bal) ?? new Map<string, FormationCacheEntry>()
  const cached = cache.get(key)
  if (cached && cached.catalog === shipCatalog) return cached.card
  const slots: FoeShipSlot[] = []
  const fixed: NonNullable<AnomalyDef['foeFormation']>['units'][number][] = []
  const waveBuilds = new Map<number, UnitSpec[]>()
  const rawBuilds = new Map<number, UnitSpec[]>()
  for (const slot of baseline.ships) {
    const wave = slot.wave ?? 0
    if (!waveBuilds.has(wave)) waveBuilds.set(wave, createFoeSpecs(baseline, bal, { tagPrefix: wave ? `w${wave}-` : '' }))
    if (!rawBuilds.has(wave)) rawBuilds.set(wave, createFoeSpecs(baseline, bal, { tagPrefix: wave ? `w${wave}-` : '', beforeHpUplift: true }))
  }
  const add = (slot: FoeShipSlot, original: UnitSpec, raw: UnitSpec, added: boolean, hp = 1, damage = 1): void => {
    const spec = structuredClone(original)
    spec.foeFormationAdded = added
    if (hp !== 1) spec.hp = { s: ceilFinalQuantity(spec.hp.s * hp), a: ceilFinalQuantity(spec.hp.a * hp), h: ceilFinalQuantity(spec.hp.h * hp) }
    if (damage !== 1) for (const weapon of spec.weapons) {
      if (weapon.shotDmg !== undefined) weapon.shotDmg = ceilFinalQuantity(weapon.shotDmg * damage)
      if (weapon.shotsByType) weapon.shotsByType = Object.fromEntries(splitShotByComposition(weapon.shotDmg ?? 0, compositionOfMix(weapon.shotsByType)).map(row => [row.type, row.dmg]))
    }
    if (damage !== 1 && spec.acidBurst?.damage !== undefined) spec.acidBurst.damage = ceilFinalQuantity(spec.acidBurst.damage * damage)
    const mounts = added ? (slot.mounts ?? slot.ship.mounts ?? []).filter(id => {
      const effect = resolveFoeMounts([id])
      return !effect.foeCaptureWeb && !effect.foeRangeDebuffPct && !effect.rangeEwStrength && !effect.foeReviveEscort && !effect.foeSummonEscort && !effect.hatchery && !effect.foeSupportCall
    }) : slot.mounts
    if (added) {
      delete spec.foeCaptureWeb
      delete spec.foeRangeDebuffPct
      delete spec.rangeEwStrength
      delete spec.foeReviveEscort
      delete spec.foeSummonEscort
      delete spec.foeSummonTemplate
      delete spec.foeHatchery
      delete spec.foeSupportCall
      const resolved = resolveFoeMounts(mounts)
      spec.foeMountNames = resolved.names
      spec.foeMountNamePairs = resolved.namePairs
    }
    const single = { ...slot, count: 1, firepowerAnchor: undefined, ...(mounts ? { mounts } : {}) }
    slots.push(single)
    fixed.push({ spec, rawSpec: { ...spec, hp: { s: raw.hp.s * hp, a: raw.hp.a * hp, h: raw.hp.h * hp } }, hpMul: single.hpMul ?? 1, dmgMul: single.dmgMul ?? 1, added })
  }
  baseline.ships.forEach((slot, index) => {
    const wave = slot.wave ?? 0
    const enumerated = enumerateShipUnits(baseline, wave)
    const originals = enumerated.flatMap((unit, i) => unit.slot === slot ? [waveBuilds.get(wave)![i]!] : [])
    const raws = enumerated.flatMap((unit, i) => unit.slot === slot ? [rawBuilds.get(wave)![i]!] : [])
    const oldCount = originals.length
    const count = Math.max(oldCount, Math.floor(plan.counts?.[index] ?? oldCount))
    for (let i = 0; i < count; i++) {
      const boost = i < oldCount && plan.boostSlots?.includes(index)
      add(slot, originals[i % oldCount]!, raws[i % oldCount]!, i >= oldCount, boost ? plan.hpMul ?? 1 : 1, boost ? plan.dmgMul ?? 1 : 1)
    }
  })
  const oldStrength = foeStrengthOf(baseline, bal)
  for (const extra of plan.extras ?? []) {
    const source = baseline.ships.find(slot => slot.ship.id === extra.shipId)
    if (source) {
      const wave = source.wave ?? 0
      const at = enumerateShipUnits(baseline, wave).findIndex(unit => unit.slot === source)
      const spec = structuredClone(waveBuilds.get(wave)![at]!)
      const raw = structuredClone(rawBuilds.get(wave)![at]!)
      delete spec.foeReinforceAt
      delete spec.foeReinforceBranch
      delete raw.foeReinforceAt
      delete raw.foeReinforceBranch
      for (let i = 0; i < extra.count; i++) add({ ...source, wave: extra.wave, enterAt: undefined, enterBranch: undefined }, spec, raw, true)
      continue
    }
    const ship = shipCatalog?.get(extra.shipId)
    if (!ship) throw new Error(`enemy-formation-missing-ship:${extra.shipId}`)
    const donor = { ...baseline, ships: [{ ship }], waves: undefined }
    const spec = createFoeSpecs(donor, bal)[0]!
    const raw = createFoeSpecs(donor, bal, { beforeHpUplift: true })[0]!
    const hp = spec.hp.s + spec.hp.a + spec.hp.h
    const dps = spec.weapons.reduce((sum, weapon) => sum + (weapon.shotDmg ?? 0) * (weapon.count ?? 1) * 1000 / weapon.reloadMs, 0)
    const share = (extra.share ?? 0.4) / extra.count
    for (let i = 0; i < extra.count; i++) add({ ship, wave: extra.wave }, spec, raw, true,
      Math.min(1, oldStrength.hp * share / Math.max(1, hp)), Math.min(1, oldStrength.dps * share / Math.max(1, dps)))
  }
  const waves = Array.from({ length: 1 + Math.max(...slots.map(slot => slot.wave ?? 0)) }, (_, wave) => ({
    units: slots.filter(slot => (slot.wave ?? 0) === wave).length,
    hpShare: baseline.waves?.[wave]?.hpShare ?? 1,
  }))
  const card: AnomalyDef = {
    ...baseline, ships: slots, waves,
    threatJudged: foeJudgedThreatOf(baseline),
    wreckThreat: baseline.wreckThreat ?? baseline.threat,
    wreckEnemyCount: baseline.wreckEnemyCount ?? baseline.waves?.reduce((sum, wave) => sum + wave.units, 0) ?? 1,
    foeFormation: { baseline, layout: slots, units: fixed },
  }
  const strength = foeStrengthOf(card, bal)
  card.threat = strength.x <= oldStrength.x ? baseline.threat : Math.max(baseline.threat, foeThreatAtHpBudgetOf(foeHpOfThreat(baseline.threat, bal) * strength.x / Math.max(1, oldStrength.x), bal))
  cache.set(key, { catalog: shipCatalog, card })
  byBalance.set(bal, cache)
  memo.set(baseline, byBalance)
  return card
}

/** 指定旗舰末波增加完整电子战舰，不重新定价旧单舰或放大原能力节拍。 */
export function rangeEwFlagshipCard(card: AnomalyDef, bal: BattleBalance): AnomalyDef {
  const shipId = card.id === 'ink-flagship' ? 'foe-h-ink-jammer'
    : card.id === 'gravekeeper-flagship' ? 'foe-d-invasion-bastion' : undefined
  if (!shipId || !card.foeFormation) return card
  const wave = Math.max(...card.ships!.map(slot => slot.wave ?? 0))
  const index = card.ships!.findIndex(slot => slot.ship.id === shipId && (slot.wave ?? 0) === wave)
  if (index < 0) throw new Error(`range-ew-flagship-source:${card.id}`)
  const ships = [...card.ships!, { ...card.ships![index]!, count: 1 }]
  const source = card.foeFormation.units[index]!
  const units = [...card.foeFormation.units, { ...structuredClone(source), added: false }]
  units.at(-1)!.spec.foeFormationAdded = false
  units.at(-1)!.rawSpec.foeFormationAdded = false
  const waves = card.waves!.map((row, i) => i === wave ? { ...row, units: row.units + 1 } : row)
  const result = { ...card, ships, waves, rangeEwLegacyCard: card,
    foeFormation: { ...card.foeFormation, layout: ships, units } }
  const before = foeStrengthOf(card, bal), after = foeStrengthOf(result, bal)
  result.threat = Math.max(card.threat, foeThreatAtHpBudgetOf(foeHpOfThreat(card.threat, bal) * after.x / Math.max(1, before.x), bal))
  return result
}
