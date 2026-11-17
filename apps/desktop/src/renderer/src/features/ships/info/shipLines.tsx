import { tr } from '../../../i18n/locale'
import { type UnitSpec, type BattleBalance, battleSpeedBonusOf, thrusterCycleNote, type ShipDef, shipCategoryKeyOf, type DamageType, rangeEwBaseOf, shipWeaponRangeBonusesOf } from '@whale/core'
import { type InfoLine, fmt, resistsText, DMG_LABEL, DmgChip, pct, slotListText, warpChargePct } from './primitives'
import { shipSubClassText, shipRoleText, shipTierText } from '../../../ui/labelsText'

export const FIT_MAIN_HIDDEN_KEYS = (): readonly string[] => [
  tr("ui.FitPage.010"),
  tr("ui.FitPage.049"),
]

export const COMBAT_BASE_KEYS = (): ReadonlySet<string> => new Set([
  tr("ui.FitPage.001"),
  tr("ui.FitPage.002"),
  tr("ui.FitPage.003"),
  tr("ui.FitPage.004"),
  tr("ui.ShipPage.023"),
  tr("ui.FitPage.005"),
  tr("ui.FitPage.006"),
  tr("ui.FitPage.007"),
])

export function fittedSpeedLine(spec: Pick<UnitSpec, 'speedMps'> & Partial<UnitSpec>, battle: BattleBalance): InfoLine {
  return {
    k: tr("ui.FitPage.049"),
    v: (
      <>
        {`${fmt(Math.round(spec.speedMps * (1 + battleSpeedBonusOf(spec, { startedAtGameMs: 0, lastTickGameMs: 0 }, false))))} m/s`}
        {spec.thrusterBoost !== undefined && spec.thrusterBoost > 0 ? (
          <span className="app-dim">
            {/* 点火周期按语言（2026-09-30 批 5）：`thrusterCycleNote` 给 { textId, params }，原来直接把中文串喂进 {p2} */}
            {tr("ui.FitPage.145", {
              p1: fmt(Math.round(spec.speedMps * (1 + battleSpeedBonusOf(spec, { startedAtGameMs: 0, lastTickGameMs: 0 })))),
              p2: (() => {
                const note = thrusterCycleNote(battle, { boostMs: spec.thrusterBoostMs, cooldownMs: spec.thrusterCooldownMs })
                return tr(note.textId, note.params)
              })(),
            })}
          </span>
        ) : null}
      </>
    ),
  }
}

export function fittedDroneBayLine(totalM3: number): InfoLine {
  return { k: tr("ui.FitPage.035"), v: tr("ui.FitPage.143", { droneBayTotal: totalM3 }) }
}

export function fittedHoldLine(capM3: number): InfoLine {
  return { k: tr("ui.Handbook.010"), v: `${fmt(capM3)} m³` }
}

export function fitHiddenBaseKeys(): readonly string[] {
  return [
    tr('ui.Handbook.008'),
    tr('ui.Handbook.011'),
    tr('ui.Handbook.010'),
    'CPU',
  ]
}

export function shipCurrentLines(
  ship: ShipDef,
  spec: UnitSpec,
  opts: { battle: BattleBalance; droneBayTotal?: number },
): InfoLine[] {
  const replaced = new Map<string, InfoLine>()
  replaced.set(tr('ui.rangeEw.010'), { k: tr('ui.rangeEw.010'), v: fmt(spec.rangeEwStrength ?? 0) })
  replaced.set(tr("ui.FitPage.001"), { k: tr("ui.FitPage.001"), v: fmt(spec.hp.s) })
  replaced.set(tr("ui.FitPage.002"), { k: tr("ui.FitPage.002"), v: resistsText(spec.resists.shield) })
  replaced.set(tr("ui.FitPage.003"), { k: tr("ui.FitPage.003"), v: fmt(spec.hp.a) })
  replaced.set(tr("ui.FitPage.004"), { k: tr("ui.FitPage.004"), v: resistsText(spec.resists.armor) })
  replaced.set(tr("ui.ShipPage.023"), { k: tr("ui.ShipPage.023"), v: fmt(spec.hp.h) })
  replaced.set(tr("ui.FitPage.005"), { k: tr("ui.FitPage.005"), v: resistsText(spec.resists.hull) })
  replaced.set(tr("ui.FitPage.006"), { k: tr("ui.FitPage.006"), v: `+${Math.round(spec.hitBonus * 100)}%` })
  replaced.set(tr("ui.FitPage.007"), { k: tr("ui.FitPage.007"), v: `${Math.round(spec.evasion * 100)}%` })
  replaced.set(tr("ui.FitPage.049"), fittedSpeedLine(spec, opts.battle))
  if (opts.droneBayTotal !== undefined && opts.droneBayTotal > 0) {
    replaced.set(tr("ui.FitPage.010"), fittedDroneBayLine(opts.droneBayTotal))
  }
  const out: InfoLine[] = []
  for (const line of shipInfoLines(ship)) {
    const hit = replaced.get(line.k)
    if (hit) out.push(hit)
    else if (FIT_MAIN_HIDDEN_KEYS().includes(line.k)) continue
    else out.push(line)
  }
  return out
}

export function shipCurrentLayout(
  ship: ShipDef,
  hasDroneBayTotal: boolean,
): { replaced: string[]; hidden: string[]; keys: string[] } {
  const replaced = new Set<string>([
    tr('ui.rangeEw.010'),
    tr("ui.FitPage.001"),
    tr("ui.FitPage.002"),
    tr("ui.FitPage.003"),
    tr("ui.FitPage.004"),
    tr("ui.ShipPage.023"),
    tr("ui.FitPage.005"),
    tr("ui.FitPage.006"),
    tr("ui.FitPage.007"),
    tr("ui.FitPage.049"),
    ...(hasDroneBayTotal ? [tr("ui.FitPage.010")] : []),
  ])
  const keys: string[] = []
  const hidden: string[] = []
  for (const line of shipInfoLines(ship)) {
    if (replaced.has(line.k)) keys.push(line.k)
    else if (FIT_MAIN_HIDDEN_KEYS().includes(line.k)) hidden.push(line.k)
    else keys.push(line.k)
  }
  return { replaced: [...replaced], hidden, keys }
}

export function shipCodexBaseLines(ship: ShipDef): ReturnType<typeof shipInfoLines> {
  const hasBay = (ship.droneBayM3 ?? 0) > 0
  return shipInfoLines(ship).filter(
    (l) => l.k !== tr('ui.Handbook.012') && (l.k !== tr('ui.FitPage.010') || hasBay),
  )
}

export function shipInfoLines(ship: ShipDef): InfoLine[] {
  const lines: InfoLine[] = [
    { k: tr('ui.command.003'), v: String(shipCommandCostOf(ship)) },
    {
      k: tr("ui.Handbook.009"),
      v: `${ship.subClass ? `${shipSubClassText(ship.subClass)} · ` : ''}${shipRoleText(shipCategoryKeyOf(ship))} · ${shipTierText(ship.tier)}`,
    },
    ...(() => {
      const bits: string[] = []
      const rangeText = Object.entries(shipWeaponRangeBonusesOf(ship))
        .map(([t, v]) => tr("ui.shipInfo.123", { p1: DMG_LABEL[t as keyof typeof DMG_LABEL] ?? t, p2: Math.round((v ?? 0) * 100) }))
        .join(' · ')
      if (rangeText) bits.push(rangeText)
      if (ship.civilianFittingOnly === true) bits.push(tr('ui.shipInfo.249'))
      if (ship.droneLaunchCutPct) bits.push(tr('ui.launchCalibration.001', { p1: Math.round(ship.droneLaunchCutPct * 100) }))
      if (ship.fleetDamageBonusPct) bits.push(tr("ui.shipInfo.124", { p1: Math.round(ship.fleetDamageBonusPct * 100) }))
      if (ship.wormholeScanRadiusBonus) bits.push(tr("ui.shipInfo.125", { p1: ship.wormholeScanRadiusBonus }))
      if (ship.repairOutputBonusPct) bits.push(tr('ui.repairDrone.002', { p1: Math.round(ship.repairOutputBonusPct * 100) }))
      if (ship.stealthCpuMul !== undefined && ship.stealthCpuMul !== 1) {
        bits.push(tr("ui.shipInfo.127", { p1: ship.stealthCpuMul }))
      }
      if (ship.stealthIgnoresPropulsion === true) bits.push(tr("ui.shipInfo.128"))
      if (ship.rangeEwBonus) bits.push(tr('ui.rangeEw.011', { p1: ship.rangeEwBonus }))
      if (ship.rangeEwEquipmentBonusPct) bits.push(tr('ui.rangeEw.012', { p1: ship.rangeEwEquipmentBonusPct * 100 }))
      if (ship.interceptorImmuneToWeb === true) bits.push(tr("ui.shipInfo.245"))
      return bits.length > 0 ? [{ k: tr("ui.shipInfo.006"), v: bits.join(' · ') }] : []
    })(),
    { k: tr("ui.Handbook.010"), v: `${fmt(ship.cargoM3)} m³` },
    { k: tr('ui.rangeEw.010'), v: fmt(rangeEwBaseOf(ship.tier) + (ship.rangeEwBonus ?? 0)) },
    { k: tr("ui.Handbook.011"), v: tr("ui.shipInfo.130", { p1: ship.cycleSeconds, p2: ship.oreUnitsPerCycle }) },
    ...(ship.maxSpeedMps !== undefined
      ? [{ k: tr("ui.FitPage.049"), v: `${fmt(ship.maxSpeedMps)} m/s` }]
      : []),
  ]
  const hasCombat = (ship.shieldHp ?? 0) > 0 || (ship.armorHp ?? 0) > 0 || (ship.hullHp ?? 0) > 0
  if (hasCombat) {
    lines.push({ k: tr("ui.FitPage.001"), v: fmt(ship.shieldHp) })
    lines.push({ k: tr("ui.FitPage.002"), v: resistsText(ship.shieldResist) })
    lines.push({ k: tr("ui.FitPage.003"), v: fmt(ship.armorHp) })
    lines.push({ k: tr("ui.FitPage.004"), v: resistsText(ship.armorResist) })
    lines.push({ k: tr("ui.ShipPage.023"), v: fmt(ship.hullHp) })
    lines.push({ k: tr("ui.FitPage.005"), v: resistsText(ship.hullResist) })
    if (ship.powerBonus !== undefined && ship.powerBonus > 0) {
      lines.push({ k: tr("ui.shipInfo.007"), v: `+${Math.round(ship.powerBonus * 100)}%` })
    }
    if (ship.weaponFamilyBonus !== undefined) {
      for (const [t, v] of Object.entries(ship.weaponFamilyBonus)) {
        if ((v ?? 0) > 0) {
          lines.push({
            k: tr("ui.shipInfo.008"),
            v: (
              <>
                <DmgChip t={t as DamageType} label={tr("ui.shipInfo.131", { p1: DMG_LABEL[t as DamageType] })} />
                <span className="app-dim">{` ${tr("ui.shipInfo.184", { p1: pct(v ?? 0) })}`}</span>
              </>
            ),
          })
        }
      }
    }
    if (ship.hitBonus !== undefined) lines.push({ k: tr("ui.FitPage.006"), v: `+${Math.round(ship.hitBonus * 100)}%` })
    if (ship.evasion !== undefined) lines.push({ k: tr("ui.FitPage.007"), v: `${Math.round(ship.evasion * 100)}%` })
  }
  lines.push({ k: tr("ui.Handbook.008"), v: slotListText(ship) })
  if (ship.cpu !== undefined) lines.push({ k: 'CPU', v: fmt(ship.cpu) })
  lines.push({ k: tr("ui.FitPage.010"), v: ship.droneBayM3 ? `${fmt(ship.droneBayM3)} m³` : tr("ui.BattleScreen.001") })
  return lines
}

export function shipIndirectLines(ship: ShipDef, effWarp?: { aus: number; bonusPct: number }): InfoLine[] {
  const lines: InfoLine[] = []
  if (ship.agility !== undefined) lines.push({ k: tr("ui.Handbook.012"), v: `${Math.round(ship.agility * 100)}%` })
  if (ship.warpSpeedAus !== undefined) {
    const base = ship.warpSpeedAus
    const boosted = effWarp !== undefined && effWarp.bonusPct > 0 && Math.abs(effWarp.aus - base) > 1e-6
    lines.push({
      k: tr("ui.shipInfo.010"),
      v: boosted ? tr("ui.shipInfo.132", { base: base, p2: effWarp.aus.toFixed(2), p3: pct(effWarp.bonusPct) }) : `${base} AU/s`,
    })
  }
  if (ship.massKg !== undefined) lines.push({ k: tr("ui.shipInfo.011"), v: tr("ui.shipInfo.133", { p1: (ship.massKg / 1_000_000).toFixed(1) }) })
  if (ship.lockRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.012"), v: `${(ship.lockRangeM / 1000).toFixed(0)} km` })
  if (ship.signatureM !== undefined) lines.push({ k: tr("ui.shipInfo.013"), v: `${fmt(ship.signatureM)} m` })
  if (ship.scanResMm !== undefined) lines.push({ k: tr("ui.shipInfo.014"), v: `${fmt(ship.scanResMm)} mm` })
  const charge = warpChargePct(ship)
  if (charge !== null) lines.push({ k: tr("ui.shipInfo.015"), v: `${charge}%` })
  return lines
}
import { shipCommandCostOf } from '@whale/core'
