import { type DamageType, typeLayerMult, type DamageResists, type ModuleDef, thrusterCycleSeconds, DEFAULT_BALANCE, thrusterCycleOfModule, repairStatsFor, fittedRepairModules, fittedEffectParamsOf, stackingOf, type ShipDef, shipSlotsOf, MODULE_SLOTS } from '@whale/core'
import { tr } from '../../../i18n/locale'
import type { ReactNode } from 'react'
import type { GameEngine } from '../../../game/engine'
import { rackText, slotText } from '../../../ui/labelsText'

export const DMG_LABEL: Record<DamageType, string> = {
  get kinetic() { return tr("ui.BattleScreen.002") },
  get explosive() { return tr("ui.battleViewCore.001") },
  get plasma() { return tr("ui.battleViewCore.002") },
}

export interface InfoLine {
  k: string
  v: ReactNode
}

export function DmgChip({ t, label }: { t: DamageType; label?: ReactNode }): ReactNode {
  const layerMulText = (layer: 'shield' | 'armor' | 'hull'): string => {
    const v = typeLayerMult(t, layer)
    return v === 1 ? '×1' : `×${v}`
  }
  return (
    <span
      className={`app-d-chip app-d-${t}`}
      title={tr('ui.shipInfo.248', {
        p1: DMG_LABEL[t],
        p2: layerMulText('shield'),
        p3: layerMulText('armor'),
        p4: layerMulText('hull'),
      })}
    >
      {label ?? DMG_LABEL[t]}
    </span>
  )
}

export function ProfileChip({ profile, text }: { profile: 'shield' | 'armor' | 'balanced'; text: string }): ReactNode {
  return <span className={`app-d-chip app-p-${profile}`}>{text}</span>
}

export const fmt = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('zh-CN'))

export const pct = (n: number): string => `${Math.round(n * 100)}%`

export const recoveryPct = (n: number): string => `${(n * 100).toFixed(1)}%`

export const pctOpt = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '—' : pct(n))

export function rangeText(minM: number | undefined, maxM: number | undefined): string {
  if (maxM === undefined) return '—'
  const lo = minM !== undefined && minM > 0 ? `${minM.toLocaleString('zh-CN')} m ~ ` : ''
  const hi = maxM >= 1000 ? `${(maxM / 1000).toFixed(maxM % 1000 === 0 ? 0 : 1)} km` : `${maxM.toLocaleString('zh-CN')} m`
  return lo + hi
}

export function resistGapText(add: DamageResists | undefined): string {
  if (!add) return ''
  const parts = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ t, v: add[t] ?? 0 }))
    .filter((x) => x.v > 0)
    .map((x) => tr("ui.shipInfo.087", { p1: DMG_LABEL[x.t], p2: pct(x.v) }))
  return parts.join(' · ')
}

export function resistAddLine(k: string, add: DamageResists | undefined): InfoLine | null {
  const entries = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ t, v: add?.[t] ?? 0 }))
    .filter((x) => x.v > 0)
  if (entries.length === 0) return null
  return {
    k,
    v: (
      <>
        {entries.map((x, i) => (
          <span key={x.t} className="app-stack-inline">
            {i > 0 ? <span className="app-dim"> · </span> : null}
            <DmgChip t={x.t} />
            <span className="app-dim">{` +${pct(x.v)}`}</span>
          </span>
        ))}
        <span className="app-dim">{tr("ui.shipInfo.001")}</span>
      </>
    ),
  }
}

export function propTailOf(mod: ModuleDef): string {
  const { boost, cooldown } = thrusterCycleSeconds(DEFAULT_BALANCE.battle, thrusterCycleOfModule(mod))
  return `（${tr('ui.shipInfo.182', { p1: boost, p2: cooldown })}）`
}

export function thrusterCycleShort(mod: ModuleDef): string {
  const { boost, cooldown } = thrusterCycleSeconds(DEFAULT_BALANCE.battle, thrusterCycleOfModule(mod))
  return tr('ui.shipInfo.183', { p1: boost, p2: cooldown })
}

export function repairAmountText(mod: ModuleDef): string {
  const arm = mod.repairArmorHp ?? 0
  const hul = mod.repairHullHp ?? 0
  if (arm > 0 && hul > 0) return arm === hul ? tr("ui.shipInfo.088", { p1: fmt(arm) }) : tr("ui.shipInfo.089", { p1: fmt(arm), p2: fmt(hul) })
  if (arm > 0) return tr("ui.shipInfo.090", { p1: fmt(arm) })
  return tr("ui.shipInfo.091", { p1: fmt(hul) })
}

export function repairLayerText(arm: number, hul: number): string {
  if (arm > 0 && hul > 0) return arm === hul ? tr('ui.shipInfo.215', { p1: fmt(arm) }) : `${tr('ui.shipInfo.216', { p1: fmt(arm) })} / ${tr('ui.shipInfo.217', { p1: fmt(hul) })}`
  if (arm > 0) return tr('ui.shipInfo.216', { p1: fmt(arm) })
  return tr('ui.shipInfo.217', { p1: fmt(hul) })
}

export function fittedRepairLine(engine: GameEngine, shipId: string, mod: ModuleDef): InfoLine | null {
  const stats = repairStatsFor(engine.state, engine.ctx, shipId)
  if (!stats) return null
  const idx = fittedRepairModules(engine.state, engine.ctx, shipId).findIndex((d) => d.id === mod.id)
  const u = idx >= 0 ? stats.units[idx] : undefined
  if (!u) return null
  return {
    k: tr('ui.shipInfo.059'),
    v: tr('ui.shipInfo.214', {
      p1: repairLayerText(u.armorPerPulse, u.hullPerPulse),
      p2: repairLayerText(mod.repairArmorHp ?? 0, mod.repairHullHp ?? 0),
    }),
  }
}

export function fittedDecayLine(engine: GameEngine, shipId: string, mod: ModuleDef, ordinal = 1): InfoLine | null {
  const params = fittedEffectParamsOf(engine.state, engine.ctx, shipId, mod, ordinal)
  if (params.length === 0) return null
  const isGap = stackingOf(mod).group === 'gap'
  const parts = params.map((p) => {
    const name = p.key.startsWith('damage:') || p.key.startsWith('range:')
      ? `${DMG_LABEL[p.key.split(':')[1] as DamageType]} ${tr(p.key.startsWith('damage:') ? 'ui.shipInfo.071' : 'ui.shipInfo.082')}`
      : tr(EFF_PARAM_LABEL[p.key] ?? 'ui.shipInfo.218')
    const value = (v: number) => p.key === 'laserFalloff' ? `+${Number(v.toFixed(3))}`
      : ['speedAddMps', 'speedPenaltyMps'].includes(p.key) ? `${fmt(Number((p.key === 'speedPenaltyMps' ? -v : v).toFixed(2)))} m/s`
        : p.key === 'droneBayBonusM3' ? `${fmt(Number(v.toFixed(2)))} m³`
      : ['shieldHpAdd', 'armorHpAdd', 'hullHpAdd', 'cpuPenalty', 'rangeEwStrength'].includes(p.key) ? fmt(Number((p.key === 'cpuPenalty' ? -v : v).toFixed(2)))
      : p.key === 'shieldPulse' || p.key === 'shieldField' ? recoveryPct(v) : pct(v)
    const eff = value(p.eff)
    const raw = isGap && !p.key.endsWith('Penalty') ? tr('ui.shipInfo.220', { p1: value(p.raw) }) : tr('ui.shipInfo.221', { p1: value(p.raw) })
    return `${name} ${eff}${raw}`
  })
  return { k: tr('ui.shipInfo.222'), v: parts.join(' · ') }
}

export const EFF_PARAM_LABEL: Record<string, string> = {
  reload: 'ui.shipInfo.043',
  shieldHpAdd: 'ui.FitPage.001',
  armorHpAdd: 'ui.FitPage.003',
  hullHpAdd: 'ui.shipInfo.066',
  damageBonusPct: 'ui.shipInfo.071',
  hitBonusPct: 'ui.shipInfo.227',
  plugRangeBonusPct: 'ui.shipInfo.082',
  speedAddMps: 'ui.shipInfo.223',
  speedPenaltyMps: 'ui.shipInfo.017',
  cargoCapacityBonusPct: 'ui.Handbook.010',
  droneBayBonusM3: 'ui.FitPage.010',
  cpuPenalty: 'ui.Handbook.030',
  speed: 'ui.shipInfo.223',
  droneRange: 'ui.shipInfo.224',
  droneLaunch: 'ui.launchCalibration.004',
  laserFalloff: 'ui.launchCalibration.005',
  shieldPulse: 'ui.shipInfo.225',
  shieldField: 'ui.shipInfo.226',
  hit: 'ui.shipInfo.227',
  lock: 'ui.shipInfo.228',
  warp: 'ui.shipInfo.229',
  ecmRangeCut: 'ui.shipInfo.230',
  rangeEwStrength: 'ui.rangeEw.010',
  reloadPenalty: 'ui.shipInfo.072',
  speedPenalty: 'ui.shipInfo.075',
  rangePenalty: 'ui.shipInfo.070',
  hitPenalty: 'ui.shipInfo.021',
  resistPenalty: 'ui.shipInfo.073',
  evasion: 'ui.shipInfo.231',
  'resistShield:kinetic': 'ui.shipInfo.232',
  'resistShield:explosive': 'ui.shipInfo.233',
  'resistShield:plasma': 'ui.shipInfo.234',
  'resistArmor:kinetic': 'ui.shipInfo.235',
  'resistArmor:explosive': 'ui.shipInfo.236',
  'resistArmor:plasma': 'ui.shipInfo.237',
}

export function repairKitName(mod: ModuleDef): string {
  return mod.repairKit === 'repairkit-mil' ? tr("ui.shipInfo.002") : mod.repairKit === 'repairkit-civ' ? tr("ui.shipInfo.003") : (mod.repairKit ?? tr('ui.itemSubs.001'))
}

export function repairShortText(mod: ModuleDef): string {
  const arm = mod.repairArmorHp ?? 0
  const hul = mod.repairHullHp ?? 0
  if (arm <= 0 && hul <= 0) return ''
  const secs = ((mod.repairIntervalMs ?? 5_000) / 1_000).toFixed(0)
  const amt = [arm > 0 ? tr("ui.shipInfo.092", { p1: fmt(arm) }) : '', hul > 0 ? tr("ui.shipInfo.093", { p1: fmt(hul) }) : ''].filter(Boolean).join(' / ')
  return tr("ui.shipInfo.094", { secs: secs, amt: amt, p3: mod.repairFree === true ? tr("ui.shipInfo.004") : tr("ui.shipInfo.005") })
}

export function salvageCycleSecs(mod: ModuleDef): string {
  return ((mod.salvageCycleMs ?? 10_000) / 1000).toFixed(0)
}

export function reviveCycleSecs(mod: ModuleDef): string {
  return ((mod.droneReviveCycleMs ?? 14_000) / 1000).toFixed(0)
}

export function hullResistShortText(mod: ModuleDef): string {
  const bits = (['kinetic', 'explosive', 'plasma'] as const)
    .filter((t) => (mod.hullResistAdd?.[t] ?? 0) > 0)
    .map((t) => `${DMG_LABEL[t]}+${pct(mod.hullResistAdd![t]!)}`)
  return bits.length > 0 ? tr("ui.shipInfo.095", { p1: bits.join(' ') }) : ''
}

export function turretAmmoText(mod: ModuleDef): string {
  const type = DMG_LABEL[mod.damageType ?? 'kinetic'] ?? mod.damageType
  return tr("ui.shipInfo.096", { type: type })
}

export function resistsText(r: DamageResists | undefined): string {
  const parts = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ t, v: r?.[t] ?? 0 }))
    .filter((x) => x.v > 0)
  if (parts.length === 0) return tr("ui.BattleScreen.001")
  return parts.map((x) => `${DMG_LABEL[x.t]} ${pct(x.v)}`).join(' · ')
}

export function warpChargePct(ship: ShipDef): number | null {
  if (ship.agility === undefined || !Number.isFinite(ship.agility)) return null
  return Math.round(ship.agility * 200)
}

export function slotListText(ship?: ShipDef): string {
  if (ship) {
    const s = shipSlotsOf(ship)
    return tr("ui.shipInfo.122", { p1: rackText('high'), p2: s.high, p3: rackText('mid'), p4: s.mid, p5: rackText('low'), p6: s.low })
  }
  return MODULE_SLOTS.map((m) => slotText(m)).join(' · ')
}
