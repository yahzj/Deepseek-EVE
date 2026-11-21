import { tuningMul } from './tuning'
import type { GameState, WreckGalaxyRecord } from './state'
import type { AnomalyDef, FoeFamily, ItemDef, SimContext } from './types'
import { hashSeed, nextInt, nextRandom, pickOne, pickWeighted } from './rng'
import { advanceShipWreckDecay } from './shipWrecks'
import { addModule, ownedItemCount, ownedModuleCount } from './equipment'
import { addWare, countWare } from './inventory'
import { asFoeFamily, normalizeWeekendWreckRecord } from './weekendWreckLedger'
export { asFoeFamily, FOE_FAMILY_CODES } from './weekendWreckLedger'
import { FOE_LAIR_GEAR } from './lairs'
import {
  wreckGroupOfAnomaly,
  wreckGroupOfItemId,
  WRECK_GROUP_BY_KEY,
  type WreckGroupDef,
  type WreckRegion,
} from './wreckGroups'

export { WRECK_YIELD_TIER_MUL, wreckYieldMultiplierOf } from './wreckGroups'

export const WRECK_FLOOR = 10
export const WRECK_INJECT_PER_THREAT = 0.4
export const WRECK_INJECT_ENEMY_BONUS = 0.2
export const WRECK_BASE_BOUNTY_RUNS = 20
export const WRECK_ENCOUNTER_INJECT_FRAC = 0.5
export const WRECK_DRAIN_SHARE = 1 / 50
export const WRECK_DRAIN_SNAP = 0.05
export const WRECK_DECAY_MS = 48 * 3_600_000
export const WRECK_RECOVER_MS = 96 * 3_600_000

export const WRECK_VOLUME_PER_THREAT = 0.06

export function wreckItemDefOf(group: WreckGroupDef): ItemDef {
  return {
    id: wreckItemIdOf(group.key),
    name: group.name,
    kind: 'wreck',
    unitM3: 1,
    baseSellPriceIsk: 1,
    description: `${group.name.replace('残骸', '')}编队的舰体残骸（按 m³ 计舱）：可在空间站市场按废料价出售应急，或经精炼炉「残骸回收」拆解——保底原材料 + 概率特色掉落（拆解更值）。`,
  }
}

export function wreckItemIdOf(groupKey: string): string {
  return `wreck-${groupKey}`
}

export function wreckItemIdOfCard(anomalyId: string, ctx?: SimContext): string | null {
  const group = wreckGroupOfCard(anomalyId, ctx)
  return group ? wreckItemIdOf(group.key) : null
}

export function wreckGroupOfKey(key: string, ctx?: SimContext): WreckGroupDef | null {
  return ctx?.wreckGroups?.get(key) ?? WRECK_GROUP_BY_KEY.get(key) ?? null
}

export function wreckGroupOfCard(anomalyId: string, ctx?: SimContext): WreckGroupDef | null {
  if (ctx?.wreckGroups) {
    for (const g of ctx.wreckGroups.values()) {
      if (g.members.includes(anomalyId)) return g
    }
  }
  return wreckGroupOfAnomaly(anomalyId)
}

export function wreckGroupOfWreckItem(itemId: string, ctx?: SimContext): WreckGroupDef | null {
  const rare = isRareWreck(itemId)
  if (!rare && !itemId.startsWith('wreck-')) return null
  const key = itemId.slice(rare ? 'wreck-rare-'.length : 'wreck-'.length)
  const direct = wreckGroupOfKey(key, ctx)
  if (direct) return direct
  if (ctx?.wreckGroups) {
    for (const g of ctx.wreckGroups.values()) {
      if (g.members.includes(key)) return g
    }
  }
  return wreckGroupOfAnomaly(key)
}

export function wreckGroupKeyOfItemId(itemId: string): string | null {
  return wreckGroupOfItemId(itemId)?.key ?? null
}


export const RARE_WRECK_VOLUME_M3 = 30

export function rareWreckItemIdOf(groupKey: string): string {
  return `wreck-rare-${groupKey}`
}

export function rareWreckItemIdOfCard(anomalyId: string, ctx?: SimContext): string | null {
  const group = wreckGroupOfCard(anomalyId, ctx)
  return group ? rareWreckItemIdOf(group.key) : null
}

export function isRareWreck(itemId: string): boolean {
  return itemId.startsWith('wreck-rare-')
}

export function wreckRecycleClosedOf(_itemId: string, _ctx?: SimContext): boolean {
  return false
}

export function rareWreckItemDefOf(group: WreckGroupDef): ItemDef {
  return {
    id: rareWreckItemIdOf(group.key),
    name: group.rareName,
    kind: 'wreck',
    unitM3: 1,
    baseSellPriceIsk: 1,
    description: `${group.rareName.replace('稀有残骸', '')}窝点核心舱段的完好残骸（单件 ${RARE_WRECK_VOLUME_M3} m³）：回站用回收炉解体，保底原材料之外必给一件该敌族专属装备或特色装备，另附一批高阶原材料。`,
  }
}

export function injectRareWreck(state: GameState, galaxyId: string, anomalyId: string, count: number): void {
  if (count <= 0 || galaxyId.length === 0 || anomalyId.length === 0) return
  const rec = state.galaxyWrecks[galaxyId] ?? { density: 0, rare: 0 }
  rec.rare = Math.max(0, Math.floor((rec.rare ?? 0) + count))
  const by = { ...(rec.rareBy ?? {}) }
  by[anomalyId] = Math.max(0, Math.floor((by[anomalyId] ?? 0) + count))
  rec.rareBy = by
  state.galaxyWrecks[galaxyId] = rec
  state.rareWreckDryStreak = 0
}

export function rareWreckCountOf(state: GameState, galaxyId: string): number {
  return Math.max(0, Math.floor(state.galaxyWrecks[galaxyId]?.rare ?? 0))
}

export function pullRareWreck(
  state: GameState,
  galaxyId: string,
  ctx?: SimContext,
  target?: string,
  consume = true,
): string | null {
  const galaxyRec = state.galaxyWrecks[galaxyId]
  const weekRec = weekendWreckRecordOf(state, galaxyId)
  const inTarget = (cardId: string, fromWeekend: boolean): boolean => {
    if (target === undefined) return true
    if (target === WEEKEND_WRECK_TARGET) return fromWeekend
    return wreckGroupOfCard(cardId, ctx)?.key === target
  }
  const cand: Array<{ cardId: string; fromWeekend: boolean; bucketKey?: string }> = []
  for (const [cardId, n] of Object.entries(galaxyRec?.rareBy ?? {})) {
    if ((n ?? 0) > 0 && inTarget(cardId, false)) cand.push({ cardId, fromWeekend: false })
  }
  for (const [bucketKey, bucket] of Object.entries(weekRec.byFamily)) {
    for (const [cardId, n] of Object.entries(bucket.rareBy ?? {})) {
      if (n > 0 && inTarget(cardId, true)) cand.push({ cardId, fromWeekend: true, bucketKey })
    }
    const attributed = Object.values(bucket.rareBy ?? {}).reduce((sum, n) => sum + n, 0)
    if ((bucket.rare ?? 0) > attributed && ctx) {
      const card = [...ctx.anomalies.values()].find((a) => a.hidden === true && a.region === 'inv'
        && (bucketKey === '?' || a.foeFamily === bucketKey) && inTarget(a.id, true)
        && rareWreckItemIdOfCard(a.id, ctx) !== null)
      if (card) cand.push({ cardId: card.id, fromWeekend: true, bucketKey })
    }
  }
  const pick = cand.find((c) => rareWreckItemIdOfCard(c.cardId, ctx) !== null)
  if (pick === undefined) {
    return null
  }
  if (!consume) return rareWreckItemIdOfCard(pick.cardId, ctx)
  if (pick.fromWeekend) {
    const bucket = weekRec.byFamily[pick.bucketKey!]!
    const by = { ...(bucket.rareBy ?? {}) }
    by[pick.cardId] = Math.max(0, (by[pick.cardId] ?? 0) - 1)
    if (by[pick.cardId]! <= 0) delete by[pick.cardId]
    const rare = Math.max(0, (bucket.rare ?? 0) - 1)
    const next: WeekendWreckBucket = { density: bucket.density, decayAccMs: bucket.decayAccMs,
      ...(rare > 0 ? { rare } : {}), ...(Object.keys(by).length > 0 ? { rareBy: by } : {}) }
    writeWeekendWreckBucket(state, galaxyId, pick.bucketKey!, next)
    return rareWreckItemIdOfCard(pick.cardId, ctx)
  }
  const rec = galaxyRec!
  const by = rec.rareBy ?? {}
  by[pick.cardId] = (by[pick.cardId] ?? 0) - 1
  if (by[pick.cardId]! <= 0) delete by[pick.cardId]
  rec.rareBy = by
  rec.rare = Math.max(0, (rec.rare ?? 0) - 1)
  state.galaxyWrecks[galaxyId] = rec
  return rareWreckItemIdOfCard(pick.cardId, ctx)
}

export function rareStockForTargetOf(
  state: GameState,
  ctx: SimContext | undefined,
  galaxyId: string,
  target: string | undefined,
): number {
  const inTarget = (cardId: string, fromWeekend: boolean): boolean => {
    if (target === undefined) return true
    if (target === WEEKEND_WRECK_TARGET) return fromWeekend
    return wreckGroupOfCard(cardId, ctx)?.key === target
  }
  let n = 0
  for (const [cardId, c] of Object.entries(state.galaxyWrecks[galaxyId]?.rareBy ?? {})) {
    if ((c ?? 0) > 0 && inTarget(cardId, false)) n += c ?? 0
  }
  for (const bucket of Object.values(weekendWreckRecordOf(state, galaxyId).byFamily)) {
    for (const [cardId, c] of Object.entries(bucket.rareBy ?? {})) {
      if (c > 0 && inTarget(cardId, true)) n += c
    }
  }
  return n
}

export function bountyEnemyCount(anomaly: Pick<AnomalyDef, 'waves' | 'wreckEnemyCount'>): number {
  if (anomaly.wreckEnemyCount !== undefined) return anomaly.wreckEnemyCount
  const w = anomaly.waves
  if (!w || w.length === 0) return 1
  return Math.max(1, w.reduce((s, x) => s + x.units, 0))
}

export function bountyWreckInjection(threat: number, units: number): number {
  return threat * WRECK_INJECT_PER_THREAT * (1 + WRECK_INJECT_ENEMY_BONUS * units)
}

export function wreckInjectThreatOf(anomaly: Pick<AnomalyDef, 'threat' | 'wreckThreat'>): number {
  return anomaly.wreckThreat ?? anomaly.threat
}

function wreckBaseDensityBySecurity(galaxyId: string, ctx: SimContext): number {
  const g = ctx.galaxies.get(galaxyId)
  const sec = typeof g?.security === 'number' && Number.isFinite(g.security) ? g.security : 0.5
  const v = 10 + 15 * (1 - sec)
  return Math.min(40, Math.max(10, Math.round(v)))
}

export function wreckBaseDensity(galaxyId: string, ctx: SimContext): number {
  let sum = 0
  let anyCard = false
  for (const a of ctx.anomalies.values()) {
    if (a.hidden === true || a.galaxyId !== galaxyId) continue
    anyCard = true
    sum += bountyWreckInjection(wreckInjectThreatOf(a), bountyEnemyCount(a))
  }
  if (!anyCard) return wreckBaseDensityBySecurity(galaxyId, ctx)
  return Math.max(1, Math.round(sum * WRECK_BASE_BOUNTY_RUNS))
}

export function wreckCardTierOf(card: Pick<AnomalyDef, 'galaxyId' | 'wreckTier'>, ctx: SimContext): RecycleTier {
  return card.wreckTier ?? recycleTierOf(wreckBaseDensity(card.galaxyId, ctx))
}

export function strongestBountyInjection(galaxyId: string, ctx: SimContext): number | null {
  let best: number | null = null
  for (const a of ctx.anomalies.values()) {
    if (a.hidden === true || a.galaxyId !== galaxyId) continue
    const v = bountyWreckInjection(wreckInjectThreatOf(a), bountyEnemyCount(a))
    if (best === null || v > best) best = v
  }
  return best
}

export function wreckDensityOf(state: GameState, galaxyId: string, ctx: SimContext): number {
  const rec = state.galaxyWrecks[galaxyId]
  const rawDensity = rec ? rec.density : wreckBaseDensity(galaxyId, ctx)
  return rawDensity * tuningMul(state, 'wreckDensity')
}

function recordOf(state: GameState, galaxyId: string, ctx: SimContext): WreckGalaxyRecord {
  const base = wreckBaseDensity(galaxyId, ctx)
  const rec = state.galaxyWrecks[galaxyId]
  return rec ?? { density: base, rare: 0 }
}

export const WEEKEND_WRECK_TARGET = '__weekend__'

export function residentWreckGroupsOf(galaxyId: string, ctx: SimContext): string[] {
  const out: string[] = []
  for (const a of ctx.anomalies.values()) {
    if (a.hidden === true || a.galaxyId !== galaxyId) continue
    const g = wreckGroupOfCard(a.id, ctx)
    if (g && !out.includes(g.key)) out.push(g.key)
  }
  return out
}

export function ensureWreckGroupShares(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  rec: WreckGalaxyRecord,
): Record<string, number> {
  if (rec.byGroup) return rec.byGroup
  const groups = residentWreckGroupsOf(galaxyId, ctx)
  const shares: Record<string, number> = {}
  if (groups.length > 0) {
    const each = Math.max(0, rec.density) / groups.length
    for (const g of groups) shares[g] = each
  }
  rec.byGroup = shares
  state.galaxyWrecks[galaxyId] = rec
  return shares
}

export function wreckGroupStocksOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  readOnly = false,
): Array<{ groupKey: string; stockM3: number; rareCount?: number }> {
  const rows: Array<{ groupKey: string; stockM3: number; rareCount?: number }> = []
  const rec = state.galaxyWrecks[galaxyId]
  if (rec) {
    const shares = rec.byGroup
      ? rec.byGroup
      : (() => {
          const groups = residentWreckGroupsOf(galaxyId, ctx)
          const out: Record<string, number> = {}
          if (groups.length > 0) {
            const each = Math.max(0, rec.density) / groups.length
            for (const g of groups) out[g] = each
          }
          return out
        })()
    if (!readOnly) ensureWreckGroupShares(state, ctx, galaxyId, rec)
    for (const [groupKey, v] of Object.entries(shares)) {
      if (v > 0.05) rows.push({ groupKey, stockM3: v })
    }
  }
  const inv = weekendWreckDensityOf(state, galaxyId)
  const invRare = weekendRareWreckCountOf(state, galaxyId)
  if (inv > 0 || invRare > 0) {
    rows.push({ groupKey: WEEKEND_WRECK_TARGET, stockM3: inv, ...(invRare > 0 ? { rareCount: invRare } : {}) })
  }
  return rows
}

export function wreckGroupStockOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  target: string,
): number {
  if (target === WEEKEND_WRECK_TARGET) return weekendWreckDensityOf(state, galaxyId)
  const rec = state.galaxyWrecks[galaxyId]
  if (!rec) return 0
  return ensureWreckGroupShares(state, ctx, galaxyId, rec)[target] ?? 0
}

export function injectWreckDensity(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  amount: number,
  sourceCardId?: string,
): void {
  if (!(amount > 0)) return
  const rec = recordOf(state, galaxyId, ctx)
  const shares = ensureWreckGroupShares(state, ctx, galaxyId, rec)
  rec.density += amount
  const g = sourceCardId !== undefined ? wreckGroupOfCard(sourceCardId, ctx) : undefined
  if (g) {
    shares[g.key] = (shares[g.key] ?? 0) + amount
  } else {
    const groups = Object.keys(shares)
    if (groups.length > 0) for (const k of groups) shares[k] = (shares[k] ?? 0) + amount / groups.length
  }
  rec.byGroup = shares
  state.galaxyWrecks[galaxyId] = rec
}

export function advanceWreckDrift(
  state: GameState,
  ctx: SimContext,
  dtMs: number,
  salvagingGalaxyId: string | null = null,
): void {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return
  for (const [galaxyId, rec] of Object.entries(state.galaxyWrecks)) {
    if (galaxyId === salvagingGalaxyId) continue
    const base = wreckBaseDensity(galaxyId, ctx)
    const d = rec.density
    if (d > base) {
      rec.density = Math.max(base, d - (d - base) * (dtMs / WRECK_DECAY_MS))
    } else if (d < base) {
      rec.density = Math.min(base, d + (base - d) * (dtMs / WRECK_RECOVER_MS))
    }
    if (rec.byGroup && d > 0 && rec.density !== d) {
      const k = rec.density / d
      for (const g of Object.keys(rec.byGroup)) rec.byGroup[g] = (rec.byGroup[g] ?? 0) * k
    }
    if (Math.abs(rec.density - base) < 1e-9) {
      if (rec.rare > 0) rec.density = base
      else delete state.galaxyWrecks[galaxyId]
    }
  }
  advanceWeekendWreckDecay(state, dtMs, salvagingGalaxyId)
  advanceShipWreckDecay(state, dtMs, salvagingGalaxyId)
}


export const WEEKEND_WRECK_DECAY_MS = WRECK_DECAY_MS
const WEEKEND_WRECK_SNAP = 0.05

export type { WeekendWreckRecord } from './state'
import type { WeekendWreckBucket, WeekendWreckRecord } from './state'

function weekendWreckRecordOf(state: GameState, galaxyId: string): WeekendWreckRecord {
  const rec = state.weekendWrecks?.[galaxyId]
  return rec?.byFamily !== undefined ? rec : normalizeWeekendWreckRecord(rec)
}

export function weekendWreckValueOf(rec: WeekendWreckBucket): number {
  const left = 1 - Math.max(0, rec.decayAccMs) / WEEKEND_WRECK_DECAY_MS
  return left <= 0 ? 0 : Math.max(0, rec.density) * left
}

export function weekendWreckDensityOf(state: GameState, galaxyId: string): number {
  return weekendWreckPoolsOf(state, galaxyId).reduce((sum, pool) => sum + pool.density, 0)
}

export interface WeekendWreckPool {
  key: string
  family: FoeFamily | null
  density: number
  rare: number
}

export function weekendWreckPoolsOf(state: GameState, galaxyId: string): WeekendWreckPool[] {
  return Object.entries(weekendWreckRecordOf(state, galaxyId).byFamily)
    .map(([key, bucket]) => ({ key, family: asFoeFamily(key) ?? null,
      density: weekendWreckValueOf(bucket), rare: Math.max(0, Math.floor(bucket.rare ?? 0)) }))
    .filter((pool) => pool.density > 0 || pool.rare > 0)
    .sort((a, b) => b.density - a.density || a.key.localeCompare(b.key))
}

export function weekendWreckInjectionOf(
  card: Pick<AnomalyDef, 'threat' | 'wreckThreat' | 'waves'>,
  frac = 1,
): number {
  return bountyWreckInjection(wreckInjectThreatOf(card), bountyEnemyCount(card)) * Math.max(0, frac)
}

export function injectWeekendWreck(
  state: GameState,
  galaxyId: string,
  amount: number,
  family?: FoeFamily,
): void {
  if (!Number.isFinite(amount) || !(amount > 0) || galaxyId.length === 0) return
  const key = family ?? '?'
  const cur = weekendWreckRecordOf(state, galaxyId).byFamily[key]
  writeWeekendWreckBucket(state, galaxyId, key, {
    ...cur, density: (cur ? weekendWreckValueOf(cur) : 0) + amount, decayAccMs: 0,
  })
}

export function injectWeekendRareWreck(
  state: GameState,
  galaxyId: string,
  cardId: string,
  count: number,
  family?: FoeFamily,
): void {
  const n = Math.max(0, Math.floor(count))
  if (!Number.isFinite(n) || n <= 0 || galaxyId.length === 0 || cardId.length === 0) return
  const key = family ?? wreckGroupOfCard(cardId)?.family ?? '?'
  const cur = weekendWreckRecordOf(state, galaxyId).byFamily[key]
  const rare = Math.max(0, Math.floor(cur?.rare ?? 0)) + n
  const by = { ...(cur?.rareBy ?? {}) }
  by[cardId] = Math.max(0, Math.floor(by[cardId] ?? 0)) + n
  writeWeekendWreckBucket(state, galaxyId, key, {
    density: cur?.density ?? 0,
    decayAccMs: cur?.decayAccMs ?? 0,
    rare,
    rareBy: by,
  })
  state.rareWreckDryStreak = 0
}

export function weekendRareWreckCountOf(state: GameState, galaxyId: string): number {
  return weekendWreckPoolsOf(state, galaxyId).reduce((sum, pool) => sum + pool.rare, 0)
}

export function weekendWreckFamilyOf(state: GameState, galaxyId: string): FoeFamily | undefined {
  const pools = weekendWreckPoolsOf(state, galaxyId)
  return pools.length === 1 ? pools[0]!.family ?? undefined : undefined
}

function writeWeekendWreckBucket(state: GameState, galaxyId: string, key: string, bucket: WeekendWreckBucket): void {
  const map = (state.weekendWrecks ??= {})
  const byFamily = { ...weekendWreckRecordOf(state, galaxyId).byFamily }
  if (weekendWreckValueOf(bucket) <= WEEKEND_WRECK_SNAP && (bucket.rare ?? 0) <= 0) delete byFamily[key]
  else byFamily[key] = bucket
  if (Object.keys(byFamily).length === 0) delete map[galaxyId]
  else map[galaxyId] = { byFamily }
}

export function advanceWeekendWreckDecay(
  state: GameState,
  dtMs: number,
  salvagingGalaxyId: string | null = null,
): void {
  const map = state.weekendWrecks
  if (!map || !Number.isFinite(dtMs) || dtMs <= 0) return
  for (const galaxyId of Object.keys(map)) {
    if (galaxyId === salvagingGalaxyId) continue
    for (const [key, bucket] of Object.entries(weekendWreckRecordOf(state, galaxyId).byFamily)) {
      const decayAccMs = Math.min(WEEKEND_WRECK_DECAY_MS, bucket.decayAccMs + dtMs)
      writeWeekendWreckBucket(state, galaxyId, key, { ...bucket, decayAccMs })
    }
  }
}

function roundMulOf(density: number, weekend = 0): number {
  return Math.max(0.5, (density + weekend) / 10)
}

function roundMulFor(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  target: string | undefined,
  weekend: number,
): number {
  const fromWeekend = weekend > 0 && (target === undefined || target === WEEKEND_WRECK_TARGET)
  if (fromWeekend) return roundMulOf(wreckBaseDensity(galaxyId, ctx))
  if (target !== undefined) {
    const shares = ensureWreckGroupShares(state, ctx, galaxyId, recordOf(state, galaxyId, ctx))
    return roundMulOf(shares[target] ?? 0)
  }
  return roundMulOf(recordOf(state, galaxyId, ctx).density)
}

export function salvageRoundMulOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  target?: string,
  bucketKey?: string,
): number {
  if (bucketKey !== undefined) {
    return roundMulOf(wreckBaseDensity(galaxyId, ctx))
  }
  return roundMulFor(state, ctx, galaxyId, target, weekendWreckDensityOf(state, galaxyId))
}

export function chargeWeekendWreckByVolume(state: GameState, galaxyId: string, wantM3: number, bucketKey?: string): number {
  if (!Number.isFinite(wantM3) || !(wantM3 > 0)) return 0
  let given = 0
  for (const pool of weekendWreckPoolsOf(state, galaxyId)) {
    if (bucketKey !== undefined && pool.key !== bucketKey) continue
    const bucket = weekendWreckRecordOf(state, galaxyId).byFamily[pool.key]!
    const give = Math.min(wantM3 - given, pool.density)
    if (give <= 0) continue
    writeWeekendWreckBucket(state, galaxyId, pool.key, { ...bucket, density: pool.density - give, decayAccMs: 0 })
    given += give
    if (given >= wantM3) break
  }
  return given
}

export function salvageRoundPull(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  target?: string,
): number {
  const rec = recordOf(state, galaxyId, ctx)
  const weekend = weekendWreckDensityOf(state, galaxyId)
  const mul = roundMulFor(state, ctx, galaxyId, target, weekend)
  const wantsWeekend = target === WEEKEND_WRECK_TARGET
  const wantsGroup = target !== undefined && !wantsWeekend
  const fromWeekend = weekend > 0 && (target === undefined || wantsWeekend)
  const d = rec.density
  if (!wantsWeekend && !fromWeekend && d > WRECK_FLOOR) {
    const excess = d - WRECK_FLOOR
    const next = Math.max(WRECK_FLOOR, d - excess * WRECK_DRAIN_SHARE)
    rec.density = next - WRECK_FLOOR < WRECK_DRAIN_SNAP ? WRECK_FLOOR : next
    const lost = d - rec.density
    const shares = ensureWreckGroupShares(state, ctx, galaxyId, rec)
    if (wantsGroup) {
      shares[target!] = Math.max(0, (shares[target!] ?? 0) - lost)
    } else if (rec.density > 0) {
      const k = rec.density / d
      for (const g of Object.keys(shares)) shares[g] = (shares[g] ?? 0) * k
    } else {
      for (const g of Object.keys(shares)) shares[g] = 0
    }
    rec.byGroup = shares
    state.galaxyWrecks[galaxyId] = rec
  }
  return mul
}


export const RECYCLE_BATCH_M3 = 100
export const RECYCLE_CYCLE_MS = 25_000

export const RECYCLE_YIELD_PER_M3: Record<RecycleTier, number> = {
  common: 2.92,
  risky: 2.06,
  dire: 0.927,
}
export const RECYCLE_YIELD_JITTER = 0.1

export const RECYCLE_POOL_AVG_ISK: Record<RecycleTier, number> = {
  common: 9.8,
  risky: 27.76,
  dire: 92.55,
}

export type RecycleTier = 'common' | 'risky' | 'dire'
export const RECYCLE_TIER_LABELS: Record<RecycleTier, string> = { common: '常', risky: '险', dire: '危' }

export const RECYCLE_POOLS: Record<RecycleTier, ReadonlyArray<readonly [string, number]>> = {
  common: [
    ['min-tritanium', 65],
    ['min-pyerite', 30],
    ['min-mexallon', 5],
  ],
  risky: [
    ['min-tritanium', 40],
    ['min-pyerite', 18],
    ['min-mexallon', 18],
    ['min-nocxium', 16],
    ['min-isotope', 8],
  ],
  dire: [
    ['min-tritanium', 40],
    ['min-mexallon', 6],
    ['min-nocxium', 18],
    ['min-isotope', 17],
    ['min-starcore', 16],
    ['min-darkiron', 3],
  ],
}

export const RECYCLE_TIER_COEF = 21.4
export const RECYCLE_TIER_RISKY = Math.round(20 * RECYCLE_TIER_COEF)
export const RECYCLE_TIER_DIRE = Math.round(30 * RECYCLE_TIER_COEF)

export function recycleTierOf(baseDensity: number): RecycleTier {
  if (baseDensity >= RECYCLE_TIER_DIRE) return 'dire'
  if (baseDensity >= RECYCLE_TIER_RISKY) return 'risky'
  return 'common'
}

export function recycleMineralPoolOf(profile: RecycleProfile): ReadonlyArray<readonly [string, number]> {
  return profile.pool && profile.pool.length > 0 ? profile.pool : RECYCLE_POOLS[profile.tier]!
}

export function recycleProfileOf(ctx: SimContext, wreckItemId: string): RecycleProfile | null {
  const group = wreckGroupOfWreckItem(wreckItemId, ctx)
  if (!group) return null
  return {
    groupKey: group.key,
    ...(group.family !== undefined ? { family: group.family } : {}),
    region: group.region,
    threat: group.threat,
    tier: group.tier,
    lowSec: group.region === 'lo',
    pool: group.pool,
    note: group.note.length > 0 ? group.note : undefined,
    theme: group.theme,
    ...(isRareWreck(wreckItemId)
      ? (() => {
          const gear = group.lairGear ?? FOE_LAIR_GEAR[group.family] ?? []
          return {
            rare: true as const,
            ...(gear.length > 0 ? { lairGear: gear } : {}),
            ...(group.rareTheme !== undefined ? { rareTheme: group.rareTheme } : {}),
          }
        })()
      : {}),
  }
}


export const RARE_BOX_GEAR_CHANCE: Record<RecycleTier, number> = { common: 0.05, risky: 0.08, dire: 0.1 }

export const RARE_BOX_DRONE_UNITS = 10
export const RARE_BOX_MINERAL_UNITS: Record<RecycleTier, number> = { common: 300, risky: 120, dire: 40 }

export function rareBoxThemePoolOf(
  profile: RecycleProfile,
  themeFallback: readonly string[] = [],
): string[] {
  const own = profile.rareTheme !== undefined
    ? [...profile.rareTheme]
    : [...(profile.theme?.mk2 ?? []), ...(profile.theme?.modules ?? [])]
  return own.length > 0 ? own : [...themeFallback]
}

export function rollRareBoxExtra(
  state: GameState,
  ctx: SimContext,
  profile: RecycleProfile,
  themeFallback: readonly string[] = [],
  weightedFallback: ReadonlyArray<{ ids: readonly string[]; weight: number }> = [],
): {
  modules: string[]
  drones: Array<{ id: string; count: number }>
  blueprints: string[]
  minerals: Array<{ mineralId: string; units: number }>
  note: string
} | undefined {
  const modules: string[] = []
  const drones: Array<{ id: string; count: number }> = []
  const blueprints: string[] = []
  const minerals: Array<{ mineralId: string; units: number }> = []
  const notes: string[] = []
  const gearAll = profile.lairGear ?? []
  const heldCount = (id: string): number => {
    const kind = ctx.modules.has(id) ? 'module' : ctx.items.has(id) ? 'item' : 'blueprint'
    let held = kind === 'module' ? ownedModuleCount(state, id)
      : kind === 'item' ? ownedItemCount(state, id) : state.blueprintStock[id] ?? 0
    for (const good of ctx.marketGoods.values()) {
      if (good.kind === kind && good.refId === id) held += Math.max(0, state.escrowItems[good.key] ?? 0)
    }
    return held
  }
  const gear = gearAll.filter((id) => heldCount(id) <= 0)
  const gearPool = gear.length > 0 ? gear : gearAll
  if (gearPool.length > 0 && nextRandom(state.rng) < (RARE_BOX_GEAR_CHANCE[profile.tier] ?? 0)) {
    const pick = gearPool[nextInt(state.rng, gearPool.length)]!
    const modDef = ctx.modules.get(pick)
    const bpDef = ctx.blueprints.get(pick)
    if (modDef) {
      modules.push(pick)
      notes.push(`专属装备「${modDef.name}」`)
    } else if (bpDef) {
      blueprints.push(pick)
      notes.push(`专属图纸「${bpDef.name}」`)
    } else {
      const itemDef = ctx.items.get(pick)
      drones.push({ id: pick, count: RARE_BOX_DRONE_UNITS })
      notes.push(`专属装备「${itemDef?.name ?? pick}」×${RARE_BOX_DRONE_UNITS} 架`)
    }
  } else {
    const theme = rareBoxThemePoolOf(profile, [])
    const pick = ((): string | undefined => {
      if (theme.length > 0) return pickOne(state.rng, theme)
      const groups = weightedFallback.filter((g) => g.ids.length > 0 && g.weight > 0)
      if (groups.length > 0) {
        const chosen = pickWeighted(state.rng, groups, (g) => g.weight, { bound: 'lte' }) ?? groups[0]!
        return pickOne(state.rng, chosen.ids)
      }
      const flat = [...themeFallback]
      return flat.length > 0 ? pickOne(state.rng, flat) : undefined
    })()
    if (pick !== undefined) {
      const themeBpDef = ctx.blueprints.get(pick)
      const themeItemDef = ctx.items.get(pick)
      if (themeBpDef) {
        blueprints.push(pick)
        notes.push(`主题图纸「${themeBpDef.name}」`)
      } else if (themeItemDef?.kind === 'drone') {
        drones.push({ id: pick, count: RARE_BOX_DRONE_UNITS })
        notes.push(`主题装备「${themeItemDef.name}」×${RARE_BOX_DRONE_UNITS} 架`)
      } else {
        modules.push(pick)
        notes.push(`主题装备「${ctx.modules.get(pick)?.name ?? themeItemDef?.name ?? pick}」`)
      }
    }
  }
  const pool = profile.pool ?? RECYCLE_POOLS[profile.tier]
  const units = RARE_BOX_MINERAL_UNITS[profile.tier] ?? 0
  if (pool.length > 0 && units > 0) {
    const chosen = pickWeighted(state.rng, pool, (row) => row[1], { bound: 'lte' })?.[0] ?? pool[0]![0]
    minerals.push({ mineralId: chosen, units })
    notes.push(`${ctx.items.get(chosen)?.name ?? chosen} ×${units}`)
  }
  if (modules.length === 0 && drones.length === 0 && blueprints.length === 0 && minerals.length === 0) return undefined
  return { modules, drones, blueprints, minerals, note: notes.join('、') }
}

export interface RecycleProfile {
  groupKey: string
  family?: FoeFamily
  region: WreckRegion
  threat: number
  tier: RecycleTier
  lowSec: boolean
  pool: ReadonlyArray<readonly [string, number]>
  note?: string
  theme: { modules?: readonly string[]; mk2?: readonly string[] }
  rareTheme?: readonly string[]
  rare?: boolean
  lairGear?: readonly string[]
}

export function recyclePoolMeanIsk(
  pool: ReadonlyArray<readonly [string, number]>,
  priceOf: (id: string) => number,
): number {
  const wSum = pool.reduce((s, [, w]) => s + w, 0)
  if (wSum <= 0) return 0
  return pool.reduce((s, [id, w]) => s + w * priceOf(id), 0) / wSum
}

export function recycleRefiningMultiplier(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['salvage-refining'] ?? 0)
  const upLv = Math.min(5, state.skills.trained['wreck-refining'] ?? 0)
  return (1 + 0.08 * lv) * (1 + 0.025 * upLv)
}

export function recycleBatchValueFromYield(
  yieldPerM3: number,
  poolMeanIsk: number,
  volumeM3: number,
  refiningMultiplier: number,
): number {
  return Math.max(1, volumeM3 * yieldPerM3) * poolMeanIsk * refiningMultiplier
}

export function recycleBatchValueIsk(
  tier: RecycleTier,
  poolMeanIsk: number,
  volumeM3: number,
  refiningMultiplier: number,
): number {
  return recycleBatchValueFromYield(RECYCLE_YIELD_PER_M3[tier], poolMeanIsk, volumeM3, refiningMultiplier)
}

export function rollRecycleGuarantee(
  state: GameState,
  ctx: SimContext,
  profile: RecycleProfile,
  volumeM3: number,
): Array<{ mineralId: string; units: number }> {
  const pool = recycleMineralPoolOf(profile)
  if (pool.length === 0) return []
  const priceOf = (id: string): number => ctx.items.get(id)?.baseSellPriceIsk ?? 0
  const wSum = pool.reduce((s, [, w]) => s + w, 0)
  if (wSum <= 0) return []
  const poolMean = recyclePoolMeanIsk(pool, priceOf)
  if (poolMean <= 0) return []
  const refMult = recycleRefiningMultiplier(state)
  const jitter = 1 - RECYCLE_YIELD_JITTER + 2 * RECYCLE_YIELD_JITTER * nextRandom(state.rng)
  const value = recycleBatchValueIsk(profile.tier, poolMean, volumeM3, refMult) * jitter
  const carry = (state.recycleCarry ??= {})
  const out: Array<{ mineralId: string; units: number }> = []
  for (const [id, w] of pool) {
    const price = priceOf(id)
    if (price <= 0) continue
    const exact = (value * (w / wSum)) / price + (carry[id] ?? 0)
    const whole = Math.floor(exact)
    carry[id] = exact - whole
    if (whole > 0) out.push({ mineralId: id, units: whole })
  }
  return out
}

export const RECYCLE_BASE_MODULES: readonly string[] = [
  'mod-miner-civ',
  'mod-cargo-civ',
  'mod-turret-civ',
  'mod-miner-1',
  'mod-cargo-1',
  'mod-turret-kin-1',
  'mod-laser-1',
  'mod-missile-1',
]
export const RECYCLE_MK2_MODULES: readonly string[] = [
  'mod-miner-2',
  'mod-cargo-2',
  'mod-turret-kin-2',
  'mod-laser-2',
  'mod-missile-2',
  'mod-shield-kin-2',
  'mod-armor-kin-2',
]
export const RECYCLE_CHANCE = { base: 0.00008, mk2: 0.000003, fragT2: 0.00045, fragT3: 0.0007 }
export const FRAGMENT_RECIPES: Record<string, { blueprintId: string; tier: 2 | 3; need: number }> = {
  'mod-miner-2': { blueprintId: 'bp-miner-2', tier: 2, need: 25 },
  'mod-cargo-2': { blueprintId: 'bp-cargo-2', tier: 2, need: 25 },
  'mod-turret-kin-2': { blueprintId: 'bp-turret-2', tier: 2, need: 25 },
  'mod-miner-3': { blueprintId: 'bp-miner-3', tier: 3, need: 250 },
  'mod-cargo-3': { blueprintId: 'bp-cargo-3', tier: 3, need: 250 },
  'mod-turret-kin-3': { blueprintId: 'bp-turret-3', tier: 3, need: 250 },
}
export function fragmentPoolOf(state: GameState, ctx: SimContext, tier: 2 | 3): string[] {
  return Object.keys(FRAGMENT_RECIPES).filter((m) => {
    const r = FRAGMENT_RECIPES[m]!
    if (r.tier !== tier) return false
    if (!ctx.blueprints.has(r.blueprintId)) return false
    if (state.learnedRecipes.includes(r.blueprintId)) return false
    if (countWare(state, fragmentItemIdOf(m)) >= r.need) return false
    return true
  })
}
export function fragmentItemIdOf(moduleId: string): string {
  return `frag-${moduleId}`
}
export function fragmentItemDefOf(
  moduleId: string,
  moduleName: string,
  en?: Readonly<{ name: string; description: string }>,
): ItemDef {
  const need = FRAGMENT_RECIPES[moduleId]?.need ?? '?'
  if (en !== undefined) {
    return {
      id: fragmentItemIdOf(moduleId),
      name: en.name.replace('{p1}', moduleName),
      kind: 'fragment',
      unitM3: 0.02,
      baseSellPriceIsk: 1,
      description: en.description.replace('{p1}', String(need)),
    }
  }
  return {
    id: fragmentItemIdOf(moduleId),
    name: `${moduleName}蓝图碎片`,
    kind: 'fragment',
    unitM3: 0.02,
    baseSellPriceIsk: 1,
    description: `逆向研究残骸得到的蓝图碎片：集齐 ${need} 片后，在物品页的「蓝图碎片」分组里点「逆向解锁」即可换成该装备的永久蓝图（需停靠空间站）。集齐前不会重复掉落同一本书的碎片——拿到蓝图后它就不再出现。`,
  }
}

export function rollRecycleLoot(
  state: GameState,
  ctx: SimContext,
  profile: RecycleProfile,
  batchUnits: number,
): { modules: string[]; fragments: string[] } {
  const modules: string[] = []
  const fragments: string[] = []
  const avgPriceOf = (ids: readonly string[]): number => {
    const ps = ids
      .map((id) => ctx.marketGoods.get(id)?.basePrice)
      .filter((p): p is number => typeof p === 'number' && p > 0)
    return ps.length > 0 ? ps.reduce((a, b) => a + b, 0) / ps.length : 0
  }
  const defBase = RECYCLE_BASE_MODULES.filter((id) => ctx.modules.has(id))
  const appendBase = (profile.theme?.modules ?? []).filter((id) => ctx.modules.has(id) && !defBase.includes(id))
  const defBaseAvg = avgPriceOf(defBase)
  const basePool = [...defBase, ...appendBase]
  const baseChance =
    appendBase.length > 0 && basePool.length > 0
      ? RECYCLE_CHANCE.base * (defBaseAvg / (avgPriceOf(basePool) || defBaseAvg))
      : RECYCLE_CHANCE.base
  const defMk2 = RECYCLE_MK2_MODULES.filter((id) => ctx.modules.has(id))
  const appendMk2 = (profile.theme?.mk2 ?? []).filter((id) => ctx.modules.has(id) && !defMk2.includes(id))
  const defMk2Avg = avgPriceOf(defMk2)
  const mk2Pool = [...defMk2, ...appendMk2]
  const mk2Chance =
    appendMk2.length > 0 && mk2Pool.length > 0
      ? RECYCLE_CHANCE.mk2 * (defMk2Avg / (avgPriceOf(mk2Pool) || defMk2Avg))
      : RECYCLE_CHANCE.mk2
  const t2Pool = fragmentPoolOf(state, ctx, 2)
  const t3Pool = fragmentPoolOf(state, ctx, 3)
  for (let i = 0; i < batchUnits; i++) {
    if (basePool.length > 0 && nextRandom(state.rng) < baseChance) {
      modules.push(pickOne(state.rng, basePool)!)
    }
    if (profile.lowSec && mk2Pool.length > 0 && nextRandom(state.rng) < mk2Chance) {
      modules.push(pickOne(state.rng, mk2Pool)!)
    }
    if (profile.threat >= 17 && t2Pool.length > 0 && nextRandom(state.rng) < RECYCLE_CHANCE.fragT2) {
      fragments.push(pickOne(state.rng, t2Pool)!)
    }
    if (profile.threat >= 41 && t3Pool.length > 0 && nextRandom(state.rng) < RECYCLE_CHANCE.fragT3) {
      fragments.push(pickOne(state.rng, t3Pool)!)
    }
  }
  return { modules, fragments }
}


export const RECYCLE_CORE_SHARE = 0.1

export const RECYCLE_CORE_WEIGHTS: Readonly<Record<'gamma' | 'beta' | 'alpha', number>> = {
  gamma: 60,
  beta: 30,
  alpha: 10,
}

export function rollRecycleCoreGain(
  wreckItemId: string,
  batchSeq: number,
): 'gamma' | 'beta' | 'alpha' | undefined {
  const group = wreckGroupOfWreckItem(wreckItemId)
  if (group?.family !== 'R' || !isRareWreck(wreckItemId)) return undefined
  let s = hashSeed(`${wreckItemId}:${Math.max(1, Math.round(batchSeq))}`) >>> 0
  const rng = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  if (rng() >= RECYCLE_CORE_SHARE) return undefined
  const total = RECYCLE_CORE_WEIGHTS.gamma + RECYCLE_CORE_WEIGHTS.beta + RECYCLE_CORE_WEIGHTS.alpha
  let pick = rng() * total
  for (const type of ['gamma', 'beta', 'alpha'] as const) {
    pick -= RECYCLE_CORE_WEIGHTS[type]
    if (pick < 0) return type
  }
  return 'gamma'
}

const INTACT_FRAG_T2_CHANCE = 0.3
const INTACT_FRAG_T2_COUNT = 3
const INTACT_FRAG_T3_CHANCE = 0.2
const INTACT_FRAG_T3_COUNT = 1

export function rollIntactHullLoot(state: GameState, ctx: SimContext, anomalyId: string): string | null {
  const group = wreckGroupOfCard(anomalyId, ctx)
  if (!group) return null
  const profile = recycleProfileOf(ctx, wreckItemIdOf(group.key))
  if (!profile) return null
  const gains: string[] = []
  const defBase = RECYCLE_BASE_MODULES.filter((id) => ctx.modules.has(id))
  const appendBase = (profile.theme?.modules ?? []).filter((id) => ctx.modules.has(id) && !defBase.includes(id))
  if (defBase.length === 0 && appendBase.length === 0) return null
  const basePick = pickOne(state.rng, [...defBase, ...appendBase])!
  addModule(state, basePick)
  gains.push(`「${ctx.modules.get(basePick)?.name ?? basePick}」`)
  if (profile.lowSec) {
    const defMk2 = RECYCLE_MK2_MODULES.filter((id) => ctx.modules.has(id))
    const appendMk2 = (profile.theme?.mk2 ?? []).filter((id) => ctx.modules.has(id) && !defMk2.includes(id))
    const mk2Pool = [...defMk2, ...appendMk2]
    if (mk2Pool.length > 0 && nextRandom(state.rng) < ctx.balance.intactMk2Chance) {
      const mk2Pick = pickOne(state.rng, mk2Pool)!
      addModule(state, mk2Pick)
      gains.push(`「${ctx.modules.get(mk2Pick)?.name ?? mk2Pick}」`)
    }
  }
  const t2Pool = fragmentPoolOf(state, ctx, 2)
  const t3Pool = fragmentPoolOf(state, ctx, 3)
  if (profile.threat >= 17 && t2Pool.length > 0 && nextRandom(state.rng) < INTACT_FRAG_T2_CHANCE) {
    const m = pickOne(state.rng, t2Pool)!
    addWare(state, fragmentItemIdOf(m), INTACT_FRAG_T2_COUNT)
    gains.push(`${INTACT_FRAG_T2_COUNT} 片「${ctx.items.get(fragmentItemIdOf(m))?.name ?? ''}」`)
  }
  if (profile.threat >= 41 && t3Pool.length > 0 && nextRandom(state.rng) < INTACT_FRAG_T3_CHANCE) {
    const m = pickOne(state.rng, t3Pool)!
    addWare(state, fragmentItemIdOf(m), INTACT_FRAG_T3_COUNT)
    gains.push(`${INTACT_FRAG_T3_COUNT} 片「${ctx.items.get(fragmentItemIdOf(m))?.name ?? ''}」`)
  }
  return `缴获 ${gains.join('、')}——成件装备已随协会货运先行送回空间站（装备库查收）`
}

