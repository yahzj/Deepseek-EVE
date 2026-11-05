import type { AnomalyDef } from '../../types'
import type { UnitSpec } from '../model'
import type { FoeSpecOpts } from './catalog'
import { enumerateShipUnits, shipWaveIndexOf, foeUnitNameOf } from '../foeCard'
import { ceilFinalQuantity } from '../../quantity'
import { compositionOfMix, splitShotByComposition } from '../composition'
import { foeJudgedThreatOf } from '../foePower'
import { FOE_REPAIR_THREAT_REF } from './ships'

/** 固定单舰规格不再按新编成总数补偿；强度覆写与旗舰绝对血量仍作用于整队。 */
export function fixedFormationSpecs(card: AnomalyDef, opts: FoeSpecOpts): UnitSpec[] {
  const formation = card.foeFormation!
  const wave = shipWaveIndexOf(opts.tagPrefix ?? '')
  const visible = enumerateShipUnits(card, wave)
  const indexes = (card.ships ?? []).flatMap((slot, i) => (slot.wave ?? 0) === wave ? [i] : [])
  const scale = (spec: UnitSpec, hp: number, damage: number): void => {
    if (hp !== 1) spec.hp = { s: ceilFinalQuantity(spec.hp.s * hp), a: ceilFinalQuantity(spec.hp.a * hp), h: ceilFinalQuantity(spec.hp.h * hp) }
    if (damage !== 1) {
      for (const weapon of spec.weapons) {
        if (weapon.shotDmg !== undefined) weapon.shotDmg = ceilFinalQuantity(weapon.shotDmg * damage)
        if (weapon.shotsByType) weapon.shotsByType = Object.fromEntries(splitShotByComposition(weapon.shotDmg ?? 0, compositionOfMix(weapon.shotsByType)).map(row => [row.type, row.dmg]))
      }
      if (spec.acidBurst?.damage !== undefined) spec.acidBurst.damage = ceilFinalQuantity(spec.acidBurst.damage * damage)
    }
  }
  return indexes.map((index, i) => {
    const slot = card.ships![index]!
    const fixed = formation.units[index]!
    const spec = structuredClone(opts.beforeHpUplift ? fixed.rawSpec : fixed.spec)
    spec.tag = visible[i]!.tag
    spec.name = foeUnitNameOf(card, spec.tag)
    if (spec.foeRepairPulse) spec.foeRepairPulse.k = Math.max(1, foeJudgedThreatOf(card) / FOE_REPAIR_THREAT_REF)
    const hp = (slot.hpMul ?? 1) / fixed.hpMul
    const damage = (slot.dmgMul ?? 1) / fixed.dmgMul
    scale(spec, slot.hpOverride ? 1 : hp, damage)
    if (slot.hpOverride) spec.hp = { ...slot.hpOverride }
    if (slot.shieldRegenMax !== undefined) {
      spec.shieldRegenMax = slot.shieldRegenMax
      spec.shieldRegenCap = slot.shieldRegenCap
    }
    const summon = spec.foeSummonEscort
    if (summon && spec.foeSummonTemplate) {
      const source = formation.units.findIndex(unit => !unit.added && unit.spec.foeShipId === summon.shipId)
      if (source >= 0) {
        // 模板保留原召唤火力，不继承召唤者厚血或共享池，只消费来源条目的本场倍率。
        const sourceSlot = card.ships![source]!, sourceFixed = formation.units[source]!
        scale(spec.foeSummonTemplate, (sourceSlot.hpMul ?? 1) / sourceFixed.hpMul, (sourceSlot.dmgMul ?? 1) / sourceFixed.dmgMul)
      }
    }
    return spec
  })
}
