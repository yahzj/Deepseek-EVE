import type { AnomalyDef, FoeShipDef } from '@whale/core'
import { FOE_MOUNTS, WEB_BREAK_DIST_M, foeFamilyHpMulOf } from '@whale/core'
import { isEn, tr } from '../../i18n/locale'

const HULL_CN: Record<number, string> = { 1: '护卫舰', 2: '驱逐舰', 3: '巡洋舰', 4: '战列舰', 5: '旗舰' }
const HULL_EN: Record<number, string> = { 1: 'frigate', 2: 'destroyer', 3: 'cruiser', 4: 'battleship', 5: 'flagship' }

function dmgText(t: string): string {
  if (t === 'kinetic') return tr('ui.foeIntro.001')
  if (t === 'explosive') return tr('ui.foeIntro.002')
  if (t === 'plasma') return tr('ui.foeIntro.003')
  return t
}

export function mountEffectText(id: string): string | null {
  const def = FOE_MOUNTS[id as keyof typeof FOE_MOUNTS]
  if (!def) return null
  if (def.acidShieldDamageMul !== undefined) return tr('ui.acidShield.001')
  const pct = (v: number) => String(Math.round(v * 100))
  if (def.rebirthProtocol) return tr('ui.gravekeeper.001', { p1: def.rebirthProtocol.repairMs / 1000, p2: `${pct(def.rebirthProtocol.armorTotalPct)}%` })
  if (def.mausoleumArmor) return tr('ui.gravekeeper.002', { p1: `${pct(def.mausoleumArmor.resistPct)}%`, p2: def.mausoleumArmor.hpMul })
  if (def.coatingArmor) return tr('ui.gravekeeper.003', { p1: pct(def.coatingArmor.resistAdd), p2: def.coatingArmor.durationMs / 1000, p3: `${pct(def.coatingArmor.cap)}%` })
  if (def.shieldCapacitor) return tr('ui.gravekeeper.004', { p1: `${pct(def.shieldCapacitor.rangeMul - 1)}%`, p2: def.shieldCapacitor.reloadMul, p3: def.shieldCapacitor.damageMul })
  if (def.broodControl) return tr('ui.alien.008', { p1: pct(def.broodControl.droneDmgMul - 1), p2: pct(def.broodControl.droneRangeBonusPct) })
  if (def.hatchery) {
    if (def.hatchery.stock === 'unlimited' && def.summonEscort && def.fleetSpeedRamp) return tr('ui.alien.007', { p1: def.hatchery.cycleMs / 1000, p2: def.summonEscort.everyMs / 1000, p3: def.fleetSpeedRamp.rampMs / 1000, p4: pct(def.fleetSpeedRamp.maxBonusPct), p5: def.summonEscort.count })
    return tr('ui.alien.003', { p1: def.hatchery.cycleMs / 1000, p2: def.hatchery.stock })
  }

  if (def.droneRangeOnHit) {
    return tr('ui.foeIntro.100', { p1: String(def.droneRangeOnHit.mul) })
  }
  if (def.gunRangeOnHit) {
    return tr(def.gunRangeOnHit.effectTextId ?? 'ui.foeIntro.101', { p1: String(def.gunRangeOnHit.mul) })
  }
  if (def.web) {
    return tr('ui.foeIntro.102', {
      p1: pct(1 - def.web.slowMul),
      p2: String(def.web.rangeDownM),
      p3: String(WEB_BREAK_DIST_M),
    })
  }
  if (def.supportCall) {
    return tr('ui.foeIntro.103', { p1: String(def.supportCall.delaySec) })
  }
  if (def.reviveEscort) {
    if (def.reviveEscort.all) return tr('ui.gravekeeperRetune.001', { p1: Math.round(def.reviveEscort.everyMs / 1000) })
    return tr('ui.foeIntro.104', { p1: String(Math.round(def.reviveEscort.everyMs / 1000)), p2: def.reviveEscort.count ?? 1 })
  }
  if (def.summonEscort) return tr('ui.foeIntro.116', { p1: def.summonEscort.everyMs / 1000 })
  if (def.overlayDrive) return tr('ui.foeIntro.115', { p1: def.overlayDrive.stepMs / 1000, p2: def.overlayDrive.floorMs / 1000, p3: def.overlayDrive.dmgMul })
  if (def.repairPulse) {
    const sec = Math.round(def.repairPulse.everyMs / 1000)
    const amt = `${def.repairPulse.armor}/${def.repairPulse.hull}`
    return tr('ui.foeIntro.105', { p1: String(sec), p2: amt })
  }
  if (def.evasionBonus) {
    return tr('ui.foeIntro.106', { p1: pct(def.evasionBonus.add) })
  }
  if (def.charge) {
    const base = tr('ui.foeIntro.107', { p1: String(def.charge.mul), p2: String(Math.round(def.charge.cooldownMs / 1000)) })
    return def.charge.webImmune === true ? `${base}${tr('ui.foeIntro.109')}` : base
  }
  if (def.rangeDebuff) {
    if (def.rangeDebuff.strength !== undefined) return `${tr('ui.rangeEw.010')} +${def.rangeDebuff.strength}`
    return tr('ui.foeIntro.108', { p1: pct(def.rangeDebuff.pct) })
  }
  if (def.blink) {
    return tr('ui.foeIntro.110', { p1: String(def.blink.distanceM) })
  }
  if (def.flashOverload) {
    return tr('ui.foeIntro.111', { p1: pct(def.flashOverload.hullCostPct) })
  }
  if (def.standbyShield) {
    return tr('ui.foeIntro.112', { p1: pct(def.standbyShield.resistPct), p2: def.standbyShield.delayMs / 1000 })
  }
  if (def.focusArray) {
    return tr('ui.foeIntro.113', { p1: def.focusArray.rampMs / 1000, p2: pct(def.focusArray.rangeBonusPct ?? 0), p3: pct(def.focusArray.antiDroneBonusPct ?? 0) })
  }
  return null
}

const MOUNT_ID_BY_NAME: ReadonlyMap<string, string> = new Map(
  Object.values(FOE_MOUNTS).map((d) => [d.name, String(d.id)]),
)

export function mountEffectTextByName(name: string): string | null {
  const id = MOUNT_ID_BY_NAME.get(name)
  return id === undefined ? null : mountEffectText(id)
}

export interface FoeMountLine {
  name: string
  effect: string
}

export interface FoeBriefLine {
  id: string
  name: string
  hull: string
  count: number
  bits: string[]
  mounts?: FoeMountLine[]
}

function bitsOf(ship: FoeShipDef, out: { mounts?: FoeMountLine[] }): string[] {
  const bits: string[] = []
  if (ship.gunCount !== undefined && !ship.acidBurst) bits.push(`${tr('ui.itemSubs.009')} ×${ship.gunCount}`)
  if (ship.tactic === 'brawl') bits.push(tr('ui.foeIntro.010'))
  else if (ship.tactic === 'orbit') bits.push(tr('ui.foeIntro.011'))
  else if (ship.tactic === 'kite') bits.push(tr('ui.foeIntro.012'))
  if (ship.energyForm !== undefined) bits.push(ship.energyForm === 'beam' ? tr('ui.foeIntro.020') : tr('ui.foeIntro.021'))
  const mix = Object.entries(ship.dmgMix ?? {}).sort((a, b) => b[1] - a[1])
  const total = mix.reduce((n, [, v]) => n + v, 0)
  if (mix.length > 0 && total > 0) {
    const [mt, mv] = mix[0]!
    bits.push(tr('ui.foeIntro.030', { p1: dmgText(mt), p2: String(Math.round((mv / total) * 100)) }))
    const sub = mix[1]
    if (sub && sub[1] / total >= 0.15) bits.push(tr('ui.foeIntro.031', { p1: dmgText(sub[0]) }))
  }
  const drones = ship.drones ?? []
  if (drones.length > 0) {
    bits.push(tr('ui.foeIntro.040', { p1: String(drones.reduce((n, d) => n + (d.count ?? 1), 0)) }))
  }
  const mech: FoeMountLine[] = []
  if (ship.acidBurst) mech.push({ name: '', effect: tr('ui.alienArmor.001', { p1: ship.acidBurst.attackRangeM, p2: ship.acidBurst.deathRangeM, p3: ship.acidBurst.corrosionPct * 100, p4: ship.acidBurst.damage ?? 0, p5: Math.round((ship.acidBurst.hitRate ?? .95) * 100) }) })
  for (const id of ship.mounts ?? []) {
    const eff = mountEffectText(id)
    if (!eff) continue
    const def = FOE_MOUNTS[id as keyof typeof FOE_MOUNTS]
    const name = def === undefined ? '' : isEn() ? (def.en ?? def.name) : def.name
    mech.push({ name, effect: eff })
  }
  if ((ship.repairPct ?? 0) > 0) mech.push({ name: '', effect: tr('ui.foeIntro.050') })
  if ((ship.foeRangeDebuffPct ?? 0) > 0) mech.push({ name: '', effect: tr('ui.foeIntro.051') })
  if (mech.length > 0) out.mounts = mech
  if (ship.elite === true) bits.push(tr('ui.foeIntro.070'))
  if (ship.family === 'C') bits.push(tr('ui.alien.009', { p1: Math.round((foeFamilyHpMulOf(ship.family) - 1) * 100) }))
  return bits
}

export function briefShipsOf(anomaly: AnomalyDef | null | undefined): FoeBriefLine[] {
  const slots = anomaly?.ships ?? []
  const seen = new Map<string, { ship: FoeShipDef; count: number; main: boolean }>()
  for (const s of slots) {
    const base = s?.ship
    if (!base) continue
    const ship = s.mounts === undefined ? base : { ...base, mounts: s.mounts }
    const hit = seen.get(ship.id)
    if (hit) {
      hit.count += s.count ?? 1
      hit.main = hit.main || s.escort !== true
    } else {
      seen.set(ship.id, { ship, count: s.count ?? 1, main: s.escort !== true })
    }
  }
  const list = [...seen.values()]
  const score = (x: { ship: FoeShipDef; main: boolean }) =>
    (x.ship.elite === true ? 1000 : 0) + x.ship.hullClassTier * 10 + (x.main ? 5 : 0)
  list.sort((a, b) => score(b) - score(a))
  return list.map((x) => toLine(x.ship, x.count))
}

function toLine(ship: FoeShipDef, count: number): FoeBriefLine {
  const out: { mounts?: FoeMountLine[] } = {}
  const bits = bitsOf(ship, out)
  return {
    id: ship.id,
    name: ship.name,
    hull: isEn() ? (HULL_EN[ship.hullClassTier] ?? '') : (HULL_CN[ship.hullClassTier] ?? ''),
    count,
    bits,
    ...(out.mounts !== undefined ? { mounts: out.mounts } : {}),
  }
}

export function foeBriefLinesOfShip(ship: FoeShipDef | null | undefined): FoeBriefLine | null {
  if (!ship) return null
  return toLine(ship, 0)
}

export function mountLabelText(): string {
  return tr('ui.foeIntro.060', { p1: '' })
    .replace('{p1}', '')
    .replace(/[：:]\s*$/, '')
    .trim()
}

export function briefsOfPool(anomalies: ReadonlyMap<string, AnomalyDef>, poolIds: readonly string[], drawn: AnomalyDef | null | undefined): FoeBriefLine[] {
  const acc = new Map<string, FoeBriefLine>()
  for (const id of poolIds) {
    const card = anomalies.get(id)
    for (const line of briefShipsOf(card)) {
      const hit = acc.get(line.id)
      if (hit) hit.count += line.count
      else acc.set(line.id, { ...line, count: line.count })
    }
  }
  for (const line of briefShipsOf(drawn)) {
    const hit = acc.get(line.id)
    if (hit) hit.count = Math.max(hit.count, line.count)
    else acc.set(line.id, line)
  }
  const list = [...acc.values()]
  list.sort((a, b) => b.count - a.count || b.bits.length - a.bits.length || a.id.localeCompare(b.id))
  return list
}
