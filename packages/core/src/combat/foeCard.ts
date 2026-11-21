import type { AnomalyDef, FoeShipDef, FoeShipSlot } from '../types'
import { resolveFoeMounts } from './foeMounts'


const FOE_CLASS: Record<string, Record<string, string>> = {
  brawl: { shield: '突击护卫舰', armor: '攻坚重甲舰', balanced: '突击炮艇' },
  orbit: { shield: '巡逻护卫舰', armor: '装甲巡逻舰', balanced: '环绕护航舰' },
  kite: { shield: '狙击护卫舰', armor: '远程装甲舰', balanced: '狙击炮艇' },
}

export const FOE_LIGHT_WORD = '轻装'
export const FOE_ELITE_WORD = '精锐'
const FOE_LIGHT_FRAC = 0.6
const FOE_CLASS_FALLBACK = '敌方舰艇'

export function foeClassName(tactic: string | undefined, profile: string | undefined): string {
  return FOE_CLASS[tactic ?? 'orbit']?.[profile ?? 'balanced'] ?? FOE_CLASS_FALLBACK
}

export function foeMainTagOf(tag: string): boolean {
  const base = baseFoeTag(tag)
  if (base === 'foe-0') return true
  if (/^foe-\d+$/.test(base)) return false
  return base.includes('-foe-') && !base.includes('-e')
}

function waveHpShareOf(tag: string, anomaly: AnomalyDef): number {
  const waves = anomaly.waves
  if (!waves || waves.length === 0) return 1
  const m = /^w(\d+)-/.exec(baseFoeTag(tag))
  const idx = m ? Math.min(waves.length - 1, parseInt(m[1]!, 10)) : 0
  return Math.max(0.001, waves[idx]!.hpShare ?? 1)
}


export function shipWaveIndexOf(prefix: string): number {
  const m = /^w(\d+)-$/.exec(prefix)
  return m ? parseInt(m[1]!, 10) : 0
}

export function enumerateShipUnits(
  anomaly: AnomalyDef,
  waveIdx: number,
): Array<{ tag: string; slot: FoeShipSlot; escort: boolean }> {
  const prefix = waveIdx === 0 ? '' : `w${waveIdx}-`
  const out: Array<{ tag: string; slot: FoeShipSlot; escort: boolean }> = []
  let mainIdx = 0
  let lastMain = 0
  const escortCounts = new Map<number, number>()
  for (const slot of anomaly.ships ?? []) {
    if ((slot.wave ?? 0) !== waveIdx) continue
    const count = Math.max(1, Math.floor(slot.count ?? 1))
    const isEscort = slot.escort === true
    const escortOffset = isEscort ? escortCounts.get(lastMain) ?? 0 : 0
    for (let i = 0; i < count; i++) {
      const k = isEscort ? lastMain : mainIdx + i
      const legacySquad = prefix === '' && k === 0
      const squadPrefix = legacySquad ? '' : prefix === '' ? 'w0-' : prefix
      const tag = isEscort
        ? legacySquad
          ? `foe-${escortOffset + i + 1}`
          : `${squadPrefix}foe-${k}-e${escortOffset + i + 1}`
        : legacySquad
          ? 'foe-0'
          : `${squadPrefix}foe-${k}`
      out.push({ tag, slot, escort: isEscort })
    }
    if (isEscort) escortCounts.set(lastMain, escortOffset + count)
    if (!isEscort) {
      lastMain = mainIdx + count - 1
      mainIdx += count
    }
  }
  return out
}

export const FOE_SUPPORT_TAG_RE = /^sup\d+(?:~([^~]+)~|-)/

export function baseFoeTag(tag: string): string {
  return tag.replace(FOE_SUPPORT_TAG_RE, '')
}

export function supportFoeModelTagOf(tag: string): string {
  return FOE_SUPPORT_TAG_RE.exec(tag)?.[1] ?? baseFoeTag(tag)
}

function foeShipAtTag(anomaly: AnomalyDef, tag: string): { ship: FoeShipDef; escort: boolean } | null {
  if (!anomaly.ships || anomaly.ships.length === 0) return null
  const base = supportFoeModelTagOf(tag)
  const m = /^w(\d+)-/.exec(base)
  const waveIdx = m ? parseInt(m[1]!, 10) : 0
  const summon = /^(?:w\d+-)?summon-(.+)$/.exec(base)
  if (summon) {
    const enabled = enumerateShipUnits(anomaly, waveIdx).some(unit =>
      resolveFoeMounts(unit.slot.mounts ?? unit.slot.ship.mounts).foeSummonEscort?.shipId === summon[1])
    const ship = enabled ? anomaly.ships.find(slot => slot.ship.id === summon[1])?.ship : undefined
    return ship ? { ship, escort: false } : null
  }
  for (const u of enumerateShipUnits(anomaly, waveIdx)) {
    if (u.tag === base) return { ship: u.slot.ship, escort: u.escort }
  }
  return null
}

export function foeShipIdOfTag(anomaly: AnomalyDef | null | undefined, tag: string): string | null {
  if (!anomaly) return null
  return foeShipAtTag(anomaly, tag)?.ship.id ?? null
}

export function foeCardShipIdOf(anomaly: AnomalyDef | null | undefined): string | null {
  if (!anomaly?.ships || anomaly.ships.length === 0) return null
  let pick: { id: string; tier: number; elite: boolean } | null = null
  for (const u of enumerateShipUnits(anomaly, 0)) {
    const t = u.slot.ship.hullClassTier
    const e = u.slot.ship.elite === true
    if (!pick || t > pick.tier || (t === pick.tier && e && !pick.elite)) pick = { id: u.slot.ship.id, tier: t, elite: e }
  }
  return pick?.id ?? null
}

export function foeUnitNameOf(anomaly: AnomalyDef, tag: string): string {
  const hit = foeShipAtTag(anomaly, tag)
  if (hit) {
    if (hit.ship.elite) return `${FOE_ELITE_WORD}${hit.ship.name}`
    return hit.escort ? `${FOE_LIGHT_WORD}${hit.ship.name}` : hit.ship.name
  }
  const base = foeClassName(anomaly.tactic, anomaly.defProfile)
  if (!foeMainTagOf(tag)) return `${FOE_LIGHT_WORD}${base}`
  const waves = anomaly.waves
  if (waves && waves.length > 0) {
    let maxShare = 0.001
    for (const w of waves) maxShare = Math.max(maxShare, w.hpShare ?? 0)
    if (waveHpShareOf(tag, anomaly) / maxShare <= FOE_LIGHT_FRAC) return `${FOE_LIGHT_WORD}${base}`
  }
  return base
}

export function foeShipTierOf(anomaly: AnomalyDef, tag: string): 1 | 2 | 3 | 4 | 5 | null {
  const hit = foeShipAtTag(anomaly, tag)
  return hit ? hit.ship.hullClassTier : null
}

export function foeShipEliteOf(anomaly: AnomalyDef, tag: string): boolean {
  const hit = foeShipAtTag(anomaly, tag)
  return hit ? hit.ship.elite === true : false
}
