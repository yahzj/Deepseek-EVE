import type { GameState } from '../state'
import type { SimContext } from '../types'
import { lairAnomalyOf } from '../lairs'
import { RETURN_LEG_MUL } from '../balance'
import { bountyWinPercentGuarded } from '../combat'
import { familyModules } from '../equipment'
import { departureView } from '../departure'

export interface ExpeditionView {
  active: boolean
  anomalyId: string | null
  anomalyName: string
  galaxyName: string
  remainingMs: number
  totalMs: number
  percent: number
  phase: 'out' | 'combat' | 'back' | null
  phaseLabel: string
  recallable: boolean
  threat: number
  power: number
  winPercent: number
  combat: {
    distanceM: number
    myDesireM: number
    meHp: { s: number; a: number; h: number }
    foeHp: Record<string, { s: number; a: number; h: number; name: string }>
    shots: number
    hits: number
    lockTag: string | null
  } | null
  lairTier: 1 | 2 | 3 | null
}

export function expeditionStatus(state: GameState, ctx: SimContext): ExpeditionView {
  const exp = state.expedition
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  const galaxy = anomaly ? ctx.galaxies.get(exp.foeGalaxyId ?? anomaly.galaxyId) : undefined
  const base = {
    active: false,
    anomalyId: null as string | null,
    anomalyName: '',
    galaxyName: '',
    remainingMs: 0,
    totalMs: 0,
    percent: 0,
    phase: null as 'out' | 'combat' | 'back' | null,
    phaseLabel: '',
    recallable: false,
    threat: 0,
    power: 0,
    winPercent: 0,
    combat: null,
    lairTier: null as 1 | 2 | 3 | null,
  }
  if (!exp.active || exp.anomalyId === null) return base

  const source = exp.battle && exp.battle.enemyFormationVersion !== 1 ? anomaly?.foeFormation?.baseline ?? anomaly : anomaly
  const card = source && exp.lairTier ? lairAnomalyOf(source, exp.lairTier, ctx.balance.battle, exp.battle ? exp.battle.enemyFormationVersion ?? 0 : 1, ctx.foeShips) : source
  const threat = card?.threat ?? 0
  const power = exp.power
  const phase: 'out' | 'combat' | 'back' = exp.phase === 'battle' ? 'combat' : exp.phase
  const phaseLabel =
    phase === 'out' ? '航行中（去程）' : phase === 'combat' ? '交火中' : '返航中'
  let percent = 0
  let remainingMs = 0
  let totalMs = 1
  if (exp.phase === 'out') {
    const departure = departureView(state)
    remainingMs = Math.max(0, exp.finishAtGameMs - state.gameMs)
    totalMs = exp.outMs
    percent = Math.min(100, Math.max(0, ((totalMs - remainingMs) / Math.max(1, totalMs)) * 100))
    if (departure?.kind === 'expedition') {
      remainingMs = departure.remainingMs
      percent = departure.percent
      totalMs = departure.undocking ? state.departure!.undockMs : state.departure!.gateMs
    }
  } else if (exp.phase === 'back') {
    remainingMs = Math.max(0, exp.finishAtGameMs - state.gameMs)
    const totalBack =
      exp.returnAtGameMs !== undefined && Number.isFinite(exp.returnAtGameMs)
        ? Math.max(1, exp.finishAtGameMs - exp.returnAtGameMs)
        : exp.outMs * RETURN_LEG_MUL
    totalMs = Math.max(1, totalBack)
    percent = Math.min(100, Math.max(0, ((totalMs - remainingMs) / totalMs) * 100))
  } else if (exp.battle) {
    const b = exp.battle
    const elapsed = Math.max(0, b.lastTickGameMs - b.startedAtGameMs)
    totalMs = ctx.balance.battle.maxBattleMs
    remainingMs = Math.max(0, totalMs - elapsed)
    percent = Math.min(100, (elapsed / totalMs) * 100)
  }
  let winPercent = 0
  if (card && exp.phase !== 'battle') {
    winPercent = Math.round(bountyWinPercentGuarded(state, ctx, card, state.shipId) * 100)
  }
  const combat =
    exp.phase === 'battle' && exp.battle
      ? (() => {
          let lockTag: string | null = null
          if (familyModules(state, ctx, state.shipId, 'target-lock').length > 0) {
            for (const [tag, u] of Object.entries(exp.battle!.units)) {
              if (u.side !== 'foe') continue
              if (u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0) {
                lockTag = tag
                break
              }
            }
          }
          return {
            distanceM: Math.round(exp.battle!.distanceM),
            myDesireM: Math.round(exp.battle!.myDesireM),
            meHp: { ...(exp.battle!.units['player']?.hp ?? { s: 0, a: 0, h: 0 }) },
            foeHp: Object.fromEntries(
              Object.entries(exp.battle!.units)
                .filter(([, u]) => u.side === 'foe')
                .map(([tag, u]) => [tag, { s: Math.round(u.hp.s), a: Math.round(u.hp.a), h: Math.round(u.hp.h), name: u.name }]),
            ),
            shots: exp.battle!.stats.meShots,
            hits: exp.battle!.stats.meHits,
            lockTag,
          }
        })()
      : null

  return {
    active: true,
    anomalyId: exp.anomalyId,
    anomalyName: card?.name ?? exp.anomalyId,
    galaxyName: galaxy?.name ?? '',
    remainingMs,
    totalMs,
    percent,
    phase,
    phaseLabel,
    recallable: exp.phase === 'out' || (exp.phase === 'back' && exp.returnReason !== 'victory'),
    threat,
    power,
    winPercent,
    combat,
    lairTier: exp.lairTier ?? null,
  }
}
