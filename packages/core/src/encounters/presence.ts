import type { SimContext, AnomalyDef } from '../types'
import { type GameState, addLog } from '../state'
import { weekendBountyCardsOf, weekendEncounterAllowedIn, WEEKEND_CARD_PREFIX } from '../weekendBounty'
import { weekendFlagshipEncounterOf, weekendBattleInvolvedOf } from '../weekendBattle'
import { weekendEncounterChanceAt, weekendAmbushPickOf } from '../weekendEvent'
import { nextRandom, pickOne } from '../rng'
import { shipDisplayName } from '../instances'
import { spawnIndustrialEncounter, industrialSortieOf } from './industrial'
import { industrialFleetSnapshotOf, industrialFrequencyOf } from './risk'

export const ENC_TIERS: ReadonlyArray<{ id: string; threat: number }> = [
  { id: 'enc-pirate-1', threat: 10 },
  { id: 'enc-pirate-2', threat: 22 },
  { id: 'enc-pirate-3', threat: 40 },
  { id: 'enc-pirate-4', threat: 70 },
]

export function tierIdOf(threat: number): string {
  let best = ENC_TIERS[0]!
  for (const t of ENC_TIERS) {
    if (Math.abs(t.threat - threat) < Math.abs(best.threat - threat)) best = t
  }
  return best.id
}

export function localBountyPoolOf(ctx: SimContext, galaxyId: string, state?: GameState, nowWallMs?: number): AnomalyDef[] {
  const out: AnomalyDef[] = []
  for (const a of ctx.anomalies.values()) {
    if (a.hidden) continue
    if (a.galaxyId === galaxyId) out.push(a)
  }
  if (!state || nowWallMs === undefined) return out
  return [...weekendBountyCardsOf(state, ctx, out, galaxyId, nowWallMs)]
}

export function foeOf(state: GameState, ctx: SimContext): AnomalyDef | null {
  const enc = state.encounter
  if (enc.pirate) return enc.pirate.card
  if (enc.anomalyId) {
    const direct = ctx.anomalies.get(enc.anomalyId)
    if (direct && !direct.hidden) return direct
  }
  if (!enc.galaxyId) return null
  let best: AnomalyDef | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const a of localBountyPoolOf(ctx, enc.galaxyId)) {
    const dist = Math.abs(a.threat - enc.threat)
    if (dist < bestDist) {
      bestDist = dist
      best = a
    }
  }
  return best
}

export function weekendInvolvedAt(state: GameState, ctx: SimContext): boolean {
  const enc = state.encounter
  if (enc.pirate) return false
  if (weekendFlagshipEncounterOf(state, enc)) return true
  return weekendBattleInvolvedOf(state, ctx, enc.anomalyId ?? null, Date.now()) !== undefined
}

export function secOf(ctx: SimContext, galaxyId: string | null): number {
  if (galaxyId === null) return 1
  return ctx.galaxies.get(galaxyId)?.security ?? 1
}

export interface Exposure {
  galaxyId: string
  shipId: string
  kind: '采矿' | '停留' | '打捞' | '扫描'
}

export function collectExposures(state: GameState, ctx: SimContext, includeOccupiedAt?: number): Exposure[] {
  if (state.sideTasks.deliver !== null) return []
  const bal = ctx.balance.encounter
  const out = new Map<string, Exposure>()
  const push = (e: Exposure): void => {
    if (state.departure && (e.shipId === state.departure.shipId || state.combatEscort?.shipIds.includes(e.shipId))) return
    if (secOf(ctx, e.galaxyId) > bal.lowSecMax) {
      if (includeOccupiedAt === undefined) return
      if (!weekendEncounterAllowedIn(state, e.galaxyId, includeOccupiedAt)) return
    }
    const prev = out.get(e.galaxyId)
    const rank = (x: Exposure): number => (x.kind === '停留' ? 3 : x.shipId === state.shipId ? 2 : 1)
    if (!prev || rank(e) > rank(prev)) out.set(e.galaxyId, e)
  }
  const m = state.mining
  if (state.hauling.active && state.hauling.fleetLeg) {
    const leg = state.hauling.fleetLeg
    const current = leg.path[leg.pathIndex]
    if (current) push({ galaxyId: current.galaxyId, shipId: state.shipId, kind: '停留' })
    return [...out.values()]
  }
  if (m.active && m.phase === 'mining' && m.beltId) {
    const g = ctx.belts.get(m.beltId)?.galaxyId
    if (g) push({ galaxyId: g, shipId: state.shipId, kind: '采矿' })
  }
  if (state.salvaging.active && state.salvaging.phase === 'salvaging' && state.salvaging.galaxyId) {
    push({ galaxyId: state.salvaging.galaxyId, shipId: state.shipId, kind: '打捞' })
  }
  if (state.wormholeScan?.active === true && state.awayGalaxy !== null) {
    push({ galaxyId: state.awayGalaxy, shipId: state.shipId, kind: '扫描' })
  }
  if (
    state.awayGalaxy !== null &&
    !m.active &&
    !state.expedition.active &&
    !state.salvaging.active &&
    state.wormholeScan?.active !== true
  ) {
    push({ galaxyId: state.awayGalaxy, shipId: state.shipId, kind: '停留' })
  }
  return [...out.values()]
}

export function noteLowSec(state: GameState, ctx: SimContext, galaxyId: string): void {
  if (state.lowSecNotified) return
  state.lowSecNotified = true
  const name = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  addLog(
    state,
    'warn',
    `⚠ 首次进入低安星系（${name}，安全 ${secOf(ctx, galaxyId).toFixed(1)}）：低安活动可能遭遇巡逻拦截或海盗伏击——采掘/打捞/扫描作业与驻留时可能，长途运输途中同样会；遇袭后舰船会自己用修理组件补装甲与结构，补不动或结构过低才收手返港；可「迎战」或快速脱离，详见手册「航行须知」。`,
  )
}

export function maintainPresence(state: GameState, ctx: SimContext): void {
  const now = state.gameMs
  const seen = new Set<string>()
  for (const exp of collectExposures(state, ctx)) {
    seen.add(exp.galaxyId)
    if (state.lowSecPresence[exp.galaxyId] === undefined) {
      state.lowSecPresence[exp.galaxyId] = now
      noteLowSec(state, ctx, exp.galaxyId)
    }
  }
  for (const g of Object.keys(state.lowSecPresence)) {
    if (!seen.has(g)) delete state.lowSecPresence[g]
  }
}

export function rollLowSecAmbush(state: GameState, ctx: SimContext, cadenceScale = 1, nowWallMs = Date.now()): boolean {
  if (state.encounter.active) return false
  const bal = ctx.balance.encounter
  const invadedOf = (galaxyId: string): boolean => weekendEncounterAllowedIn(state, galaxyId, nowWallMs)
  for (const exp of collectExposures(state, ctx, nowWallMs)) {
    const invaded = invadedOf(exp.galaxyId)
    const since = state.lowSecPresence[exp.galaxyId]
    const isScan = exp.kind === '扫描'
    const protection = state.industrialProtection
    if (!invaded && protection && (state.gameMs < protection.postBattleUntilMs || !isScan && protection.entryRemainingMs > 0)) continue
    if (!isScan && !invaded && !protection && (since === undefined || state.gameMs - since < bal.entryBufferMs)) continue
    const cd = state.encounterZoneCooldown[exp.galaxyId] ?? 0
    if (state.gameMs < cd) continue
    const sec = secOf(ctx, exp.galaxyId)
    let p: number
    if (invaded) {
      p = weekendEncounterChanceAt(state, state.weekendEvent!, exp.galaxyId, nowWallMs)
    } else {
      p = Math.min(0.9, bal.ambushChanceAtZero + bal.ambushChancePerSec * Math.min(1.5, Math.max(0, bal.lowSecMax - sec)))
      if (isScan) p = Math.min(0.9, p * (bal.scanAmbushMul ?? 1))
      const fleet = industrialFleetSnapshotOf(state, ctx, industrialSortieOf(state))
      p = Math.min(bal.industrial.frequency.maximumChance, p * industrialFrequencyOf(fleet.industrialMassKg, fleet.combatMassKg, bal.industrial.frequency).multiplier)
    }
    if (cadenceScale < 1) p = Math.min(0.9, p * Math.max(0, cadenceScale))
    if (nextRandom(state.rng) >= p) continue
    if (spawnEncounter(state, ctx, exp)) return true
  }
  return false
}

export function spawnEncounter(state: GameState, ctx: SimContext, exp: Exposure, nowWallMs = Date.now()): boolean {
  if (!weekendEncounterAllowedIn(state, exp.galaxyId, nowWallMs)) return spawnIndustrialEncounter(state, ctx, exp)
  const bal = ctx.balance.encounter
  const pool = localBountyPoolOf(ctx, exp.galaxyId, state, nowWallMs)
  if (pool.length === 0) return false
  const ev = state.weekendEvent
  const invaded = weekendEncounterAllowedIn(state, exp.galaxyId, nowWallMs)
  const ambushPick = invaded && ev ? weekendAmbushPickOf(state, ctx, exp.galaxyId, nowWallMs) : null
  const weekendFoe = ambushPick ? ctx.anomalies.get(ambushPick.cardId) : undefined
  const foe = weekendFoe ?? pickOne(state.rng, pool)!
  const foeId = foe.id.startsWith(WEEKEND_CARD_PREFIX) ? foe.id.slice(WEEKEND_CARD_PREFIX.length) : foe.id
  const foeName = foe.name
  state.encounterZoneCooldown[exp.galaxyId] = state.gameMs + bal.zoneCooldownMs
  const shipName = shipDisplayName(state, ctx, exp.shipId)
  state.encounter = {
    active: true,
    automatic: true,
    shipId: exp.shipId,
    galaxyId: exp.galaxyId,
    name: foeName,
    threat: Math.max(1, ambushPick?.threat ?? foe.threat),
    anomalyId: foeId,
    origin: `${shipName} · ${exp.kind}`,
    invitedAtGameMs: state.gameMs,
    deadlineGameMs: state.gameMs + bal.inviteWaitMs,
    battle: null,
    ...(ambushPick ? { foeStrengthMul: ambushPick.strengthMul } : {}),
  }
  addLog(state, 'combat', '', 'core.encounters.006')
  return true
}

export function foeKeyOf(enc: GameState['encounter']): string {
  return enc.anomalyId ?? tierIdOf(Math.max(1, enc.threat))
}
