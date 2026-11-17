import { ceilFinalQuantity } from './quantity'
import type { AnomalyDef, DamageType, FoeFamily } from './types'
import type { GameState } from './state'
import { rareDropRateMulOf } from './tuning'
import { foeHpOfThreat, foeJudgedThreatOf, foeThreatAtHpBudgetOf } from './foePower'
import type { BattleBalance } from './types'
import { enemyFormationCard } from './combat/formation'

export type LairTier = 1 | 2 | 3


export const LAIR_THREAT_MUL: Record<LairTier, number> = { 1: 1.3, 2: 1.6, 3: 2.0 }
export const LAIR_REWARD_MUL: Record<LairTier, number> = { 1: 2, 2: 4, 3: 8 }
export const LAIR_ESCORT_BONUS: Record<LairTier, number> = { 1: 0, 2: 1, 3: 1 }
export const LAIR_WAVES: Record<LairTier, ReadonlyArray<{ units: number; hpShare: number }> | null> = {
  1: null,
  2: [
    { units: 1, hpShare: 0.35 },
    { units: 1, hpShare: 0.65 },
  ],
  3: [
    { units: 1, hpShare: 0.2 },
    { units: 1, hpShare: 0.3 },
    { units: 1, hpShare: 0.5 },
  ],
}
export const LAIR_TASK_REWARD_MUL: Record<LairTier, number> = { 1: 0.5, 2: 0.75, 3: 1.0 }
export const LAIR_RARE_WRECK_GAIN: Record<LairTier, number> = { 1: 1, 2: 2, 3: 3 }


export const FACTION_BOUNTY_REWARD_MUL = 1.1
export const FACTION_BOUNTY_THREAT_MUL = 1.1
export const FACTION_RARE_DROP_CHANCE = 0.3
export const FACTION_RARE_DROP_COUNT = 1
export const FACTION_RARE_DROP_PITY_ROLLS = 10

export function factionRareDropEffectiveRate(rate: number = FACTION_RARE_DROP_CHANCE): number {
  const p = Math.min(1, Math.max(0, rate))
  const n = FACTION_RARE_DROP_PITY_ROLLS
  let expected = 0
  for (let k = 1; k < n; k += 1) expected += k * p * Math.pow(1 - p, k - 1)
  expected += n * Math.pow(1 - p, n - 1)
  return expected > 0 ? 1 / expected : 1
}

export function factionRareDropChanceOf(
  state: Pick<GameState, 'wallMs' | 'ironman'> | null | undefined,
): number {
  return Math.min(1, FACTION_RARE_DROP_CHANCE * rareDropRateMulOf(state))
}

export function factionRareDropRateOf(
  state: Pick<GameState, 'wallMs' | 'ironman'> | null | undefined,
): number {
  return factionRareDropEffectiveRate(factionRareDropChanceOf(state))
}

export function factionAnomalyOf(anomaly: AnomalyDef): AnomalyDef {
  return {
    ...anomaly,
    threat: Math.round(anomaly.threat * FACTION_BOUNTY_THREAT_MUL),
    threatJudged: Math.round(foeJudgedThreatOf(anomaly) * FACTION_BOUNTY_THREAT_MUL),
  }
}

export function factionBaseRewardIsk(anomaly: AnomalyDef): number {
  return ceilFinalQuantity(anomaly.rewardIsk * FACTION_BOUNTY_REWARD_MUL)
}


export const FOE_LAIR_TIERS: Record<FoeFamily, readonly [string, string, string]> = {
  A: ['小头目', '藏货据点', '隐蔽船坞'],
  B: ['小队头目', '拾荒营地', '隐蔽拆解场'],
  C: ['虫群头目', '虫巢', '隐秘孵化地'],
  D: ['守卫舰长', '残舰泊地', '隐秘陵寝'],
  E: ['警戒机群', '核心舱段', '深层机库'],
  F: ['巡逻队长', '据点', '隐蔽据点'],
  G: ['残兵头目', '聚落营地', '藏匿地'],
  H: ['堂口头目', '私货仓', '隐蔽坞'],
  R: ['节点主控', '数据坞', '隐匿机巢'],
}
const LAIR_TIER_FALLBACK: readonly [string, string, string] = ['头目', '据点', '秘密据点']


export const FOE_LAIR_GEAR: Record<FoeFamily, readonly string[]> = {
  A: ['mod-lair-turret-a', 'mod-lair-missile-a', 'mod-lair-cargo-a'],
  B: [],
  C: ['mod-lair-armor-c', 'mod-lair-dc-c', 'mod-lair-laser-c'],
  D: ['mod-lair-shield-d', 'mod-lair-turret-d', 'mod-lair-armor-d'],
  E: ['mod-lair-turret-e', 'mod-lair-hangar-e', 'mod-lair-frame-e'],
  F: [],
  G: ['drone-exile-bee', 'mod-lair-drone-tac-g', 'mod-lair-drone-relay-g', 'bp-lair-g-drone'],
  H: ['mod-lair-ecm-h', 'mod-lair-web-h', 'drone-ink-heavy'],
  R: ['mod-lair-laser-r', 'mod-lair-blink-r', 'mod-lair-beam-r', 'mod-lair-pd-r'],
}

export function lairGearOf(anomaly: AnomalyDef): readonly string[] {
  if (anomaly.lairGear && anomaly.lairGear.length > 0) return anomaly.lairGear
  return anomaly.foeFamily ? FOE_LAIR_GEAR[anomaly.foeFamily] : []
}

export function hasLairCore(anomaly: AnomalyDef): boolean {
  if (anomaly.hidden === true) return false
  return (anomaly.lairCore ?? '') !== ''
}

export function isLairCandidate(anomaly: AnomalyDef): boolean {
  if (!hasLairCore(anomaly)) return false
  if (anomaly.foeFamily === 'B') return false
  return anomaly.rewardIsk > 0
}

export function lairCoreOf(anomaly: AnomalyDef): string {
  return anomaly.lairCore ?? anomaly.name
}

export function lairTierWordOf(anomaly: AnomalyDef, tier: LairTier): string {
  const table = anomaly.lairTierNames ?? (anomaly.foeFamily ? FOE_LAIR_TIERS[anomaly.foeFamily] : undefined) ?? LAIR_TIER_FALLBACK
  return table[tier - 1] ?? LAIR_TIER_FALLBACK[tier - 1]!
}

export function lairNameOf(anomaly: AnomalyDef, tier: LairTier): string {
  return `${lairCoreOf(anomaly)}·${lairTierWordOf(anomaly, tier)}`
}


export const LAIR_LEVEL_DEFAULT: LairTier = 3

export function lairLevelOf(anomaly: AnomalyDef): LairTier {
  return anomaly.lairLevel ?? LAIR_LEVEL_DEFAULT
}

export function lairTiersOf(anomaly: AnomalyDef): LairTier[] {
  const max = lairLevelOf(anomaly)
  const out: LairTier[] = []
  for (let t = 1; t <= max; t += 1) out.push(t as LairTier)
  return out
}

export function lairBaseRewardIsk(anomaly: AnomalyDef, tier: LairTier): number {
  return ceilFinalQuantity(anomaly.rewardIsk * LAIR_REWARD_MUL[tier])
}

export function lairTaskRewardIsk(anomaly: AnomalyDef, tier: LairTier): number {
  return ceilFinalQuantity(lairBaseRewardIsk(anomaly, tier) * LAIR_TASK_REWARD_MUL[tier])
}

export const LAIR_SUB_DMG_SHARE = 0.4

export const LAIR_SUB_DMG_SHARE_BY_FAMILY: Partial<Record<FoeFamily, number>> = {}

export const FOE_SUB_DMG: Record<FoeFamily, readonly DamageType[]> = {
  A: ['kinetic', 'explosive', 'plasma'],
  B: ['kinetic', 'explosive', 'plasma'],
  C: ['explosive', 'plasma', 'kinetic'],
  D: ['plasma', 'kinetic', 'explosive'],
  E: ['kinetic', 'explosive', 'plasma'],
  F: ['kinetic', 'explosive', 'plasma'],
  G: ['explosive', 'kinetic', 'plasma'],
  H: ['kinetic', 'explosive', 'plasma'],
  R: ['plasma', 'kinetic', 'explosive'],
}

type LairCacheEntry = { catalog?: ReadonlyMap<string, import('./types').FoeShipDef>; card: AnomalyDef }
const formationLairMemo = new WeakMap<AnomalyDef, WeakMap<BattleBalance, Map<LairTier, LairCacheEntry>>>()

export function lairAnomalyOf(anomaly: AnomalyDef, tier: LairTier, bal: BattleBalance, formationVersion: 0 | 1 = 1, shipCatalog?: ReadonlyMap<string, import('./types').FoeShipDef>): AnomalyDef {
  if (formationVersion === 1) {
    const base = anomaly.foeFormation?.baseline ?? anomaly
    const byBalance = formationLairMemo.get(base) ?? new WeakMap<BattleBalance, Map<LairTier, LairCacheEntry>>()
    const cache = byBalance.get(bal) ?? new Map<LairTier, LairCacheEntry>()
    const cached = cache.get(tier)
    if (cached && cached.catalog === shipCatalog) return cached.card
    const old = lairAnomalyOf(base, tier, bal, 0)
    if (!old.ships?.length) return old
    const counts = old.ships.map(slot => Math.max(1, slot.count ?? 1))
    const candidates = old.ships.map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => old.foeFamily !== 'E' && !slot.ship.elite && !slot.enterBranch && !slot.ship.repairPct && slot.ship.id !== 'foe-d-stasis' && !slot.ship.id.includes('spore') && !slot.ship.id.includes('hiveback'))
      .sort((a, b) => a.slot.ship.hp * (a.slot.hpMul ?? 1) - b.slot.ship.hp * (b.slot.hpMul ?? 1))
    if (old.threat > 40 && candidates.length) {
      const amount = Math.min(tier, Math.max(1, Math.floor(counts.reduce((a, b) => a + b, 0) * 0.5)))
      for (let i = 0; i < amount; i++) counts[candidates[i % candidates.length]!.index]! += 1
    }
    const maxHp = Math.max(...old.ships.map(slot => slot.ship.hp * (slot.hpMul ?? 1)))
    const boosts = tier > 1 && old.threat > 100 ? old.ships.flatMap((slot, i) => slot.ship.hp * (slot.hpMul ?? 1) === maxHp ? [i] : []) : []
    const strong = old.threat > 140
    const card = enemyFormationCard(old, bal, { counts, boostSlots: boosts, hpMul: strong ? 1.1 : 1.05, dmgMul: strong ? 1.05 : 1.03,
      ...(!candidates.length && old.threat > 40 && old.foeFamily === 'E' && shipCatalog?.has('foe-auro-hulk')
        ? { extras: [{ wave: 0, shipId: 'foe-auro-hulk', count: Math.min(tier, 2), share: 0.4 }] } : {}) }, shipCatalog)
    cache.set(tier, { catalog: shipCatalog, card })
    byBalance.set(bal, cache)
    formationLairMemo.set(base, byBalance)
    return card
  }
  const waves = LAIR_WAVES[tier]
  const main = foeMainDamageTypeOf(anomaly)
  const sub = subDamageTypeOf(anomaly, main)
  const subShare =
    (anomaly.foeFamily ? LAIR_SUB_DMG_SHARE_BY_FAMILY[anomaly.foeFamily] : undefined) ??
    LAIR_SUB_DMG_SHARE
  const mainWeight = Math.round((1 - subShare) * 10)
  const subWeight = Math.round(subShare * 10)
  const shipSlots = anomaly.ships
  const isShipPath = !!shipSlots && shipSlots.length > 0
  const tierMul = Math.max(1, anomaly.threat)
  const scale = Math.round(anomaly.threat * LAIR_THREAT_MUL[tier]) / tierMul
  const threat = isShipPath ? foeThreatAtHpBudgetOf(scale * foeHpOfThreat(anomaly.threat, bal), bal) : Math.round(anomaly.threat * LAIR_THREAT_MUL[tier])
  const threatJudged = Math.round(foeJudgedThreatOf(anomaly) * LAIR_THREAT_MUL[tier])
  return {
    ...anomaly,
    name: lairNameOf(anomaly, tier),
    threat,
    threatJudged,
    escorts: isShipPath ? (anomaly.escorts ?? 0) : Math.min(2, (anomaly.escorts ?? 0) + LAIR_ESCORT_BONUS[tier]),
    ...(isShipPath
      ? {
          ships: shipSlots!.map((s) => ({
            ...s,
            hpMul: (s.hpMul ?? 1) * scale,
            dmgMul: (s.dmgMul ?? 1) * scale,
            ...(s.firepowerAnchor !== undefined
              ? { firepowerAnchor: Math.max(1, Math.round(s.firepowerAnchor * scale)) }
              : {}),
          })),
        }
      : {}),
    ...(waves && !isShipPath ? { waves } : {}),
    dmgMix: { [main]: mainWeight, [sub]: subWeight },
  }
}

export function foeMainDamageTypeOf(anomaly: AnomalyDef): DamageType {
  let best: DamageType = 'kinetic'
  let bestW = 0
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const w = anomaly.dmgMix?.[t] ?? 0
    if (w > bestW) {
      bestW = w
      best = t
    }
  }
  return best
}

export function subDamageTypeOf(anomaly: AnomalyDef, main: DamageType = foeMainDamageTypeOf(anomaly)): DamageType {
  const seq = (anomaly.foeFamily ? FOE_SUB_DMG[anomaly.foeFamily] : undefined) ?? FOE_SUB_DMG.A
  return seq.find((t) => t !== main) ?? 'kinetic'
}


export const LAIR_TIER_LABELS: Record<LairTier, string> = { 1: '外围', 2: '核心', 3: '深层' }
