import type { GameState } from '../state'
import type { AnomalyDef, SimContext, FoeShipSlot } from '../types'
import { type LairTier, lairAnomalyOf, factionAnomalyOf } from '../lairs'
import type { FoeOverride } from './model'
import { type WormholeExpeditionFoeCard, wormholeExpeditionCard, wormholeExpeditionModifyCard } from '../wormholeExpeditionFoes'
import { WORMHOLE_TIER_THREAT_MUL, wormholeTierOfCard, wormholeSkippedBranch, wormholeAnomalyOf, wormholeCardThreatOf, WORMHOLE_FOE_BASE_STRENGTH_MUL } from '../wormholeFoes'
import { createFoeSpecs } from './foes/catalog'
import { foeHpOfThreat, foeShipHpMulOf } from './foePower'
import { ceilFinalQuantity } from '../quantity'
import { enemyFormationCard } from './formation'
import { SIGNAL_FORMATION_COUNTS } from './formation-plans'

export function noteFoeShipsSeen(state: GameState, anomaly: AnomalyDef): void {
  const slots = anomaly.ships
  if (!slots || slots.length === 0) return
  let next: Record<string, true> | null = null
  for (const slot of slots) {
    const id = slot.ship?.id
    if (!id || state.foeShipSeen?.[id] === true) continue
    next = next ?? { ...(state.foeShipSeen ?? {}) }
    next[id] = true
  }
  if (next) state.foeShipSeen = next
}

export function battleAnomalyOf(
  ctx: SimContext,
  anomalyId: string | null | undefined,
  lairTier?: LairTier,
  factionActive?: boolean,
  formationVersion: 0 | 1 = 1,
  rangeEwVersion: 0 | 1 = 1,
): AnomalyDef | undefined {
  const entry = anomalyId ? ctx.anomalies.get(anomalyId) : undefined
  if (!entry) return undefined
  const current = rangeEwVersion === 0 ? entry.rangeEwLegacyCard ?? entry : entry
  const base = formationVersion === 0 ? current.foeFormation?.baseline ?? current : current
  const card = lairTier ? lairAnomalyOf(base, lairTier, ctx.balance.battle, formationVersion, ctx.foeShips) : base
  return factionActive ? factionAnomalyOf(card) : card
}

export function resolvedBattleAnomaly(
  ctx: SimContext,
  battle: import('../state').BattleState,
  anomalyId: string | null | undefined,
  lairTier?: LairTier,
  factionActive?: boolean,
): AnomalyDef | undefined {
  const version = battle.enemyFormationVersion ?? 0
  const base = battleAnomalyOf(ctx, battle.wormhole?.cardId ?? anomalyId, lairTier, factionActive, version, battle.rangeEwVersion ?? 0)
  const derived = base && battle.wormhole ? wormholeDerivedAnomaly(ctx, base, battle.wormhole, version) : base
  return applyFoeOverride(derived, battle.foeOverride)
}

export function applyFoeOverride<T>(anomaly: T, override?: FoeOverride): T {
  if (override?.generatedCard) return override.generatedCard as T
  if (!anomaly || !override) return anomaly
  const next = { ...(anomaly as Record<string, unknown>) }
  if (override.patrolFormation === true && next.region === 'inv' && next.foeFormation) {
    return applyFoeOverride((next.foeFormation as NonNullable<AnomalyDef['foeFormation']>).baseline as T, override)
  }
  if (override.threat !== undefined && Number.isFinite(override.threat)) next.threat = Math.max(1, Math.round(override.threat))
  if (override.keepCardWaves !== true && override.waves !== undefined && override.waves.length > 0) next.waves = override.waves
  const strengthMul = override.strengthMul
  if (strengthMul !== undefined && Number.isFinite(strengthMul) && strengthMul > 0 && strengthMul !== 1) {
    const ships = next.ships
    if (Array.isArray(ships)) {
      next.ships = ships.map((raw) => {
        const slot = raw as { hpMul?: number; dmgMul?: number; firepowerAnchor?: number }
        const out: Record<string, unknown> = {
          ...slot,
          hpMul: (slot.hpMul ?? 1) * strengthMul,
          dmgMul: (slot.dmgMul ?? 1) * strengthMul,
        }
        if (slot.firepowerAnchor !== undefined) out.firepowerAnchor = Math.max(1, Math.round(slot.firepowerAnchor * strengthMul))
        return out
      })
    }
  }
  const bossHp = override.bossHp
  const bossShipId = override.bossShipId
  if (bossHp !== undefined && Number.isFinite(bossHp) && bossHp > 0 && typeof bossShipId === 'string' && bossShipId.length > 0) {
    const ships = next.ships
    if (Array.isArray(ships)) {
      next.ships = ships.map((raw, index) => {
        const slot = raw as FoeShipSlot
        if (slot.ship?.id !== bossShipId) return raw
        const classHp = Math.max(1, slot.ship.hp ?? 1)
        const fixed = (next.foeFormation as AnomalyDef['foeFormation'])?.units[index]
        const shieldRegenMax = slot.shieldRegenMax ?? (slot.hpOverride?.s ?? (fixed
          ? ceilFinalQuantity(fixed.spec.hp.s * (slot.hpMul ?? 1) / fixed.hpMul)
          : ceilFinalQuantity(classHp * (slot.hpMul ?? 1) * (slot.split ?? slot.ship.split).s * foeShipHpMulOf(slot.ship.family))))
        const layers = override.bossHpLayers
        const layerSplit =
          layers !== undefined
            ? { s: Math.max(0, layers.s) / bossHp, a: Math.max(0, layers.a) / bossHp, h: Math.max(0, layers.h) / bossHp }
            : undefined
        const split = slot.split ?? slot.ship?.split ?? { s: 0.2, a: 0.55, h: 0.25 }
        const hpOverride = layers !== undefined
          ? { s: Math.max(0, layers.s), a: Math.max(0, layers.a), h: Math.max(0, layers.h) }
          : { s: bossHp * split.s, a: bossHp * split.a, h: bossHp * split.h }
        return { ...(raw as object), shieldRegenMax, shieldRegenCap: override.bossMaxLayers?.s ?? hpOverride.s,
          hpMul: bossHp / classHp, hpOverride, ...(layerSplit !== undefined ? { split: layerSplit } : {}) }
      })
    }
  }
  return next as T
}

export let wormholeDerivedMemo: { ctx: SimContext; base: AnomalyDef; key: string; card: AnomalyDef } | null = null

export const expeditionDerivedMemo = new WeakMap<SimContext, Map<string, WormholeExpeditionFoeCard>>()

export function wormholeDerivedAnomaly(
  ctx: SimContext,
  baseCard: AnomalyDef,
  spec: {
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'
    waves: number
    expeditionRules?: number
    expeditionRole?: 'ordinary' | 'elite' | 'guard' | 'patrol' | 'event'
    guardSupportDisabled?: boolean
    strengthMul?: number
    threatMul?: number
    foeHitDown?: number
    blindReduce?: number
  },
  formationVersion: 0 | 1 = 1,
): AnomalyDef {
  if (spec.expeditionRules !== undefined) {
    if (spec.expeditionRules !== 2) throw new Error('wormhole-expedition-unsupported-rules')
    const family = baseCard.foeFamily
    if (family !== 'A' && family !== 'C' && family !== 'D' && family !== 'E' && family !== 'G') throw new Error('wormhole-expedition-family-invalid')
    const role = spec.expeditionRole ?? (spec.kind === 'boss' ? 'guard' : spec.kind === 'spawn' ? 'patrol' : 'ordinary')
    const key = JSON.stringify([family, spec.depth, role, spec.guardSupportDisabled, spec.threatMul, spec.foeHitDown, spec.blindReduce])
    const cache = expeditionDerivedMemo.get(ctx) ?? new Map<string, WormholeExpeditionFoeCard>()
    if (!expeditionDerivedMemo.has(ctx)) expeditionDerivedMemo.set(ctx, cache)
    const old = cache.get(key)
    if (old) return old
    const base = wormholeExpeditionCard(ctx, family, spec.depth, role, spec.guardSupportDisabled)
    const card = wormholeExpeditionModifyCard(base, ctx.balance.battle, spec)
    if (cache.size >= 64) cache.clear()
    cache.set(key, card)
    return card
  }
  const threatMul = spec.threatMul ?? 1
  const tierThreatMul = WORMHOLE_TIER_THREAT_MUL[wormholeTierOfCard(baseCard.id) ?? 'shallow']
  const zero = (v: number | undefined): string => (v === undefined || v === 0 ? '' : String(v))
  const memoKey = `${formationVersion}|${baseCard.id}|${spec.depth}|${spec.kind}|${spec.waves}|${spec.strengthMul ?? ''}|${threatMul}|${tierThreatMul}|${zero(spec.foeHitDown)}|${zero(spec.blindReduce)}`
  if (wormholeDerivedMemo?.ctx === ctx && wormholeDerivedMemo.base === baseCard && wormholeDerivedMemo.key === memoKey) return wormholeDerivedMemo.card
  const naturalDps = (() => {
    const skip = wormholeSkippedBranch(baseCard)
    let dps = 0
    for (const f of createFoeSpecs(baseCard, ctx.balance.battle)) {
      if (skip !== null && f.foeReinforceBranch === skip) continue
      for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
    }
    return dps
  })()
  const derived = wormholeAnomalyOf(baseCard, spec.depth, spec.kind, spec.waves, {
    hpBudget:
      foeHpOfThreat(wormholeCardThreatOf(baseCard, spec.depth, spec.kind), ctx.balance.battle) *
      WORMHOLE_FOE_BASE_STRENGTH_MUL *
      threatMul,
    tierThreatMul,
    naturalDps,
    ...(spec.strengthMul !== undefined ? { strengthMul: spec.strengthMul } : {}),
  })
  const foeHitDown = spec.foeHitDown ?? 0
  const blindReduce = spec.blindReduce ?? 0
  let card: AnomalyDef =
    foeHitDown > 0 || blindReduce > 0
      ? {
          ...derived,
          ...(foeHitDown > 0 ? { foeHitRate: Math.max(0, (derived.foeHitRate ?? ctx.balance.battle.foeHitRate) - foeHitDown) } : {}),
          ...(blindReduce > 0 ? { blindDmgMul: Math.max(0, (derived.blindDmgMul ?? 0.3) - blindReduce) } : {}),
        }
      : derived
  if (formationVersion === 1 && SIGNAL_FORMATION_COUNTS[baseCard.id]) {
    const expanded = spec.depth >= 2
    const nWaves = Math.max(1, spec.waves)
    const counts = (card.ships ?? []).map((slot, i) => expanded
      ? Math.max(slot.count ?? 1, SIGNAL_FORMATION_COUNTS[baseCard.id]![Math.floor(i / nWaves)] ?? 1) : slot.count ?? 1)
    const extraId = baseCard.foeFamily === 'A' ? 'foe-pirate-skiff' : baseCard.foeFamily === 'C' ? 'foe-alien-starcore-adult'
      : baseCard.foeFamily === 'D' ? 'foe-d-ghost' : baseCard.foeFamily === 'E' ? 'foe-auro-hulk' : 'foe-g-swarm-skiff'
    const baseExtras = expanded && baseCard.id === 'wh-titan-missile' ? 1
      : expanded && (baseCard.id === 'wh-titan-hulk' || baseCard.id === 'wh-exile-line') ? 2 : 0
    const branchCount = Math.max(0, ...(card.ships ?? []).flatMap((slot, i) => slot.enterBranch === 'outside' ? [counts[i]!] : []))
    const actual = counts.reduce((a, b) => a + b, 0) - branchCount + baseExtras
    const stageExtras = spec.depth >= 10 ? 2 : spec.depth >= 7 ? 1 : 0
    const guardExtras = expanded && (spec.kind === 'boss' || spec.kind === 'ruins') ? 1 : 0
    const extras = Math.max(0, Math.min(8 - actual, stageExtras + guardExtras)) + baseExtras
    const maxHp = Math.max(...(card.ships ?? []).filter(slot => !slot.enterBranch).map(slot => slot.ship.hp * (slot.hpMul ?? 1)))
    const boosts = spec.depth >= 7 ? (card.ships ?? []).flatMap((slot, i) => !slot.enterBranch && slot.ship.hp * (slot.hpMul ?? 1) === maxHp ? [i] : []) : []
    card = enemyFormationCard(card, ctx.balance.battle, { counts, boostSlots: boosts,
      hpMul: spec.depth >= 10 ? 1.1 : 1.05, dmgMul: spec.depth >= 10 ? 1.05 : 1.03,
      ...(extras ? { extras: [{ wave: 0, shipId: extraId, count: extras, share: 0.4 }] } : {}) }, ctx.foeShips)
  }
  wormholeDerivedMemo = { ctx, base: baseCard, key: memoKey, card }
  return card
}
