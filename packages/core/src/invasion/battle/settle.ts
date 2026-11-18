import { type GameState, addLog } from '../../state'
import type { SimContext } from '../../types'
import type { WeekendBattleSpec } from './specs'
import { weekendIsBossFamily, weekendNoteFlagshipDamage, weekendFlagshipDefeated, weekendProgressAt, weekendWinGainOf, weekendNoteContribution, WEEKEND_GAIN_OFFLINE_REPEL, WEEKEND_GAIN_REPEL, weekendNoteFlagshipKilled, weekendOccupiedIds, type WeekendEventState, weekendContributionShareAt, weekendContributionTier, weekendProgressIncomeIsk, weekendPlayerContribution, weekendLastHitByPlayer, type WeekendResultSnapshot, weekendFlagshipOutcomeOf, weekendFlagshipSharesOf, weekendStandingGainOf, weekendFoeCardOf } from '../../weekendEvent'
import { weekendRareWreckUnits, WEEKEND_FLAGSHIP_WRECK, weekendSyncReclaimRewards, weekendRareWreckIdFor, weekendBlackBoxItemIdOf, weekendGrantRewards, noteReward } from './rewards'
import { noteStandingEarned, DSI_FACTION_ID } from '../../standing'

export type WeekendOutcome = 'win' | 'repel' | 'offlineRepel' | 'loss'

export interface WeekendResolveResult {
  progressGain: number
  note: string
  reclaimed?: { galaxyId: string; allClear: boolean }
  flagshipKilled?: { blackBox: boolean; wreck: number }
}

export function weekendResolveBattle(
  state: GameState,
  ctx: SimContext,
  spec: WeekendBattleSpec,
  outcome: WeekendOutcome,
  nowWallMs: number,
  flagshipDmg = 0,
  flagshipRunId?: number,
): WeekendResolveResult {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return { progressGain: 0, note: '本场入侵已结束' }

  if (spec.kind === 'flagship' && weekendIsBossFamily(ev)) {
    weekendNoteFlagshipDamage(ev, flagshipDmg, flagshipRunId)
  }
  const bossDown = spec.kind === 'flagship' && weekendIsBossFamily(ev) && weekendFlagshipDefeated(ev)

  if (outcome === 'loss' && !bossDown) return { progressGain: 0, note: '战败：只受损，进度不动（第 5 条）' }

  const wasReclaimed = weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) >= 1
  const beforePct = weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) * 100
  let gatedThisBattle = false
  let gain = 0
  if (outcome === 'win') {
    gain = weekendWinGainOf(state, ev, spec.galaxyId)
    const gated = spec.galaxyId === ev.coreId && weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) <= 0 && !peripheryCleared(state, ev, nowWallMs)
    gatedThisBattle = gated
    if (!gated) weekendNoteContribution(ev, spec.galaxyId, gain)
    else gain = 0
  } else {
    gain = outcome === 'offlineRepel' ? WEEKEND_GAIN_OFFLINE_REPEL : WEEKEND_GAIN_REPEL
    weekendNoteContribution(ev, spec.galaxyId, gain)
  }

  const res: WeekendResolveResult = { progressGain: gain, note: '' }

  if (spec.kind === 'flagship' && (bossDown || (outcome === 'win' && !weekendIsBossFamily(ev)))) {
    if (weekendNoteFlagshipKilled(state, nowWallMs)) {
      res.flagshipKilled = { blackBox: true, wreck: weekendRareWreckUnits(WEEKEND_FLAGSHIP_WRECK) }
      res.note = bossDown ? '旗舰血量归零：击沉（跨场累计）· 黑匣入手' : '旗舰被击毁：战利品归玩家（含黑匣）'
      return res
    }
  }

  if (!wasReclaimed && weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) >= 1) {
    const allClear = weekendOccupiedIds(ev).every((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
    res.reclaimed = { galaxyId: spec.galaxyId, allClear }
    res.note = allClear ? '全部占领区夺回：全清追加待结算' : '该星系夺回：奖励待结算'
  } else if (res.note === '') {
    res.note = outcome === 'win' ? '推进进度' : '击退遇袭'
  }
  if (res.reclaimed === undefined) {
    const gname0 = ctx.galaxies.get(spec.galaxyId)?.name ?? spec.galaxyId
    if (gain > 0) {
      const pctBefore = Math.round(beforePct)
      const pctAfter = Math.round(weekendProgressAt(state, ev, spec.galaxyId, nowWallMs) * 100)
      addLog(state, 'combat', `✦ ${gname0}：夺回进度 ${pctBefore}% → ${pctAfter}%`, 'core.weekend.035', {
        p1: gname0,
        p2: pctBefore,
        p3: pctAfter,
      })
    } else if (gatedThisBattle) {
      addLog(state, 'combat', `✦ ${gname0}：外围未清完，本次不计夺回进度`, 'core.weekend.036', { p1: gname0 })
    }
  }
  return res
}

export function peripheryCleared(state: GameState, ev: WeekendEventState, nowWallMs: number): boolean {
  return ev.peripheryIds.every((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
}

export interface WeekendSettlePlan {
  share: number
  tier: 'A' | 'B' | 'C' | 'D' | 'none'
  wreck: number
  isk: number
  progressIsk: number
  progressPct: number
  blackBoxToPlayer: boolean
}

export function weekendSettlePlanOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): WeekendSettlePlan {
  const share = weekendContributionShareAt(state, ev, nowWallMs)
  const tier = weekendContributionTier(share)
  return {
    share,
    tier: tier.tier,
    wreck: weekendRareWreckUnits(tier.wreck),
    isk: tier.isk,
    progressIsk: weekendProgressIncomeIsk(ev),
    progressPct: weekendPlayerContribution(ev),
    blackBoxToPlayer: weekendLastHitByPlayer(ev),
  }
}

export interface WeekendSettleGrant {
  share: number
  tier: 'A' | 'B' | 'C' | 'D' | 'none'
  isk: number
  wreck: number
  progressIsk: number
}

export function weekendResultSnapshotOf(
  state: GameState,
  ctx: SimContext,
  ev: WeekendEventState,
  atWallMs: number,
  plan: WeekendSettlePlan,
  wreckItemId?: string,
  blackBoxItemId?: string,
): WeekendResultSnapshot {
  const led = ev.rewardLedger ?? { isk: 0, wreck: 0, blackBox: 0, byGalaxy: {} }
  const galaxies = weekendOccupiedIds(ev).map((galaxyId) => {
    const put = ev.contributed[galaxyId] ?? 0
    const progress = weekendProgressAt(state, ev, galaxyId, atWallMs)
    const g = led.byGalaxy[galaxyId] ?? { isk: 0, wreck: 0 }
    return { galaxyId, put, progress, reclaimed: progress >= 1, isk: g.isk, wreck: g.wreck }
  })
  const hpMax = ev.flagshipHpMax
  const hpDone = Math.max(0, ev.flagshipHpDone ?? 0)
  const playerKill = ev.flagshipPlayerKill
  const flagshipOutcome: WeekendResultSnapshot['flagshipOutcome'] = weekendFlagshipOutcomeOf(ev)
  const flagship =
    hpMax !== undefined
      ? (() => {
          const shares = weekendFlagshipSharesOf(ev)
          return {
            hpMax,
            hpDone,
            defeated: flagshipOutcome === 'player',
            playerFrac: shares.player,
            octopusFrac: shares.octopus,
          }
        })()
      : undefined
  void ctx
  const standingGain = weekendStandingGainOf(ev, plan.share)
  return {
    seq: ev.seq,
    family: ev.family,
    coreId: ev.coreId,
    endedAtWallMs: atWallMs,
    flagshipOutcome,
    share: plan.share,
    tier: plan.tier,
    galaxies,
    ...(flagship !== undefined ? { flagship } : {}),
    ...(playerKill !== undefined
      ? { flagshipPlayerKill: { atWallMs: playerKill.atWallMs, ...(playerKill.waveIdx !== undefined ? { waveIdx: playerKill.waveIdx } : {}) } }
      : {}),
    progressPct: weekendPlayerContribution(ev),
    progressIsk: plan.progressIsk,
    ...(standingGain > 0 ? { standing: standingGain } : {}),
    isk: led.isk,
    wreck: led.wreck,
    blackBox: led.blackBox,
    ...(wreckItemId !== undefined ? { wreckItemId } : {}),
    ...(blackBoxItemId !== undefined ? { blackBoxItemId } : {}),
  }
}

export function weekendSettleAndGrant(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
): WeekendSettleGrant | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs === undefined) return null
  if (ev.prizePaidAtWallMs !== undefined) return null
  weekendSyncReclaimRewards(state, ev, ev.endedAtWallMs)
  const plan = weekendSettlePlanOf(state, ev, ev.endedAtWallMs)
  const wreckItemId = weekendRareWreckIdFor(weekendFoeCardOf(ev.family, 'flagship'), ctx)
  const pending = ev.reclaimPending ?? { isk: 0, wreck: 0 }
  const boxItemId = weekendBlackBoxItemIdOf(ev, ctx)
  const granted = weekendGrantRewards(state, {
    isk: plan.isk + pending.isk + plan.progressIsk,
    wreck: plan.wreck + pending.wreck,
    ...(wreckItemId !== undefined ? { wreckItemId } : {}),
  })
  ev.prizePaidAtWallMs = nowWallMs
  ev.reclaimPending = { isk: 0, wreck: 0 }
  const standing = weekendStandingGainOf(ev, plan.share)
  if (standing > 0) noteStandingEarned(state, DSI_FACTION_ID, standing)
  noteReward(ev, undefined, {
    isk: plan.isk + plan.progressIsk,
    wreck: Math.max(0, granted.wreck - pending.wreck),
  })
  state.weekendLastResult = weekendResultSnapshotOf(state, ctx, ev, ev.endedAtWallMs, plan, wreckItemId, boxItemId)
  return { share: plan.share, tier: plan.tier, isk: granted.isk, wreck: granted.wreck, progressIsk: plan.progressIsk }
}
