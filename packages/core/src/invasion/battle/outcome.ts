import { type GameState, addLog } from '../../state'
import type { SimContext } from '../../types'
import { type WeekendOutcomeHint, type WeekendBattleKind, weekendBattleInvolvedOf, weekendFlagshipSpecOf, weekendAmbushSpecOf, weekendAssaultSpecOf } from './specs'
import { weekendZoneLiveAt, weekendIsBossFamily, weekendFlagshipSlotOf, weekendBossPoolView, weekendFlagshipDefeated, WEEKEND_CARD_PREFIX, weekendFlagshipSharesOf } from '../../weekendEvent'
import { flagshipBattleLedger } from '../../combat'
import { ceilFinalQuantity } from '../../quantity'
import { type WeekendOutcome, weekendResolveBattle } from './settle'
import { injectWeekendRareWreck, asFoeFamily } from '../../salvage'
import { weekendRareWreckIdFor, weekendGrantRewards, weekendBlackBoxItemIdOf, noteReward } from './rewards'

export function weekendApplyBattleOutcome(
  state: GameState,
  ctx: SimContext,
  anomalyId: string | null | undefined,
  victory: boolean,
  nowWallMs: number,
  battle?: import('../../state').BattleState | null,
  hint?: WeekendOutcomeHint,
): { galaxyId: string; kind: WeekendBattleKind; gain: number; isk: number; wreck: number; note: string } | null {
  const involved: { galaxyId: string; kind: WeekendBattleKind } | undefined = (() => {
    const ev = state.weekendEvent
    if (hint === undefined || ev === undefined || ev.endedAtWallMs !== undefined || hint.galaxyId.length === 0) {
      return weekendBattleInvolvedOf(state, ctx, anomalyId, nowWallMs)
    }
    if (hint.kind === 'flagship') {
      return hint.galaxyId === ev.coreId ? { galaxyId: hint.galaxyId, kind: 'flagship' } : undefined
    }
    return weekendZoneLiveAt(state, hint.galaxyId, nowWallMs)
      ? { galaxyId: hint.galaxyId, kind: hint.kind }
      : undefined
  })()
  if (!involved) return null
  const spec =
    involved.kind === 'flagship'
      ? weekendFlagshipSpecOf(state, ctx, nowWallMs)
      : involved.kind === 'ambush'
        ? weekendAmbushSpecOf(state, ctx, involved.galaxyId, nowWallMs)
        : weekendAssaultSpecOf(state, ctx, involved.galaxyId)
  if (!spec) return null
  let flagshipDmg = 0
  if (involved.kind === 'flagship' && weekendIsBossFamily(state.weekendEvent)) {
    const card = ctx.anomalies.get(spec.cardId)
    const flagship = weekendFlagshipSlotOf(card)
    const flagshipIds = flagship !== undefined ? [flagship.ship.id] : []
    if (battle) {
      const led = flagshipBattleLedger(battle, flagshipIds)
      flagshipDmg = led.rawDmg
      const poolLeft = weekendBossPoolView(state, state.weekendEvent)?.hpLeft ?? 0
      const roundingGap = poolLeft - flagshipDmg
      const killedBoss = battle.bossDownAtMs !== undefined && battle.foeOverride?.bossShipId === flagship?.ship.id
        && Object.values(battle.units).some(unit => unit.side === 'foe' && unit.foeShipId === flagship?.ship.id
          && unit.hp.s + unit.hp.a + unit.hp.h <= 0)
      if (led.flagshipSeq === 1 && killedBoss && roundingGap > 0 && roundingGap <= 1) flagshipDmg += 1
      if (!killedBoss && poolLeft > 0 && flagshipDmg > 0) flagshipDmg = Math.min(flagshipDmg, Math.max(0, ceilFinalQuantity(poolLeft) - 1))
    }
  }
  const bossDown =
    involved.kind === 'flagship' && weekendIsBossFamily(state.weekendEvent) && weekendFlagshipDefeated(state.weekendEvent)
  const outcome: WeekendOutcome = bossDown
    ? 'win'
    : involved.kind === 'ambush'
      ? victory
        ? hint?.source === 'text'
          ? 'offlineRepel'
          : 'repel'
        : 'loss'
      : victory
        ? 'win'
        : 'loss'
  const r = weekendResolveBattle(state, ctx, spec, outcome, nowWallMs, flagshipDmg, battle?.startedAtGameMs)
  const foughtCardId =
    typeof anomalyId === 'string' && anomalyId.startsWith(WEEKEND_CARD_PREFIX)
      ? anomalyId.slice(WEEKEND_CARD_PREFIX.length)
      : typeof anomalyId === 'string'
        ? anomalyId
        : ''
  const rareDrop = foughtCardId.length > 0 ? (ctx.anomalies.get(foughtCardId)?.rareWreckDrop ?? 0) : 0
  if (rareDrop > 0 && (outcome === 'win' || outcome === 'repel')) {
    injectWeekendRareWreck(state, involved.galaxyId, foughtCardId, rareDrop, asFoeFamily(ctx.anomalies.get(foughtCardId)?.foeFamily))
    const gnameDrop = ctx.galaxies.get(involved.galaxyId)?.name ?? involved.galaxyId
    addLog(
      state,
      'trade',
      `✦ 击退「${gnameDrop}」的入侵舰队：残骸场里留下 ${rareDrop} 具稀有残骸 —— 可前往该星系打捞（回站用回收炉解体可得额外战利品）。`,
      'core.weekend.043',
      { p1: gnameDrop, p2: rareDrop },
    )
  }
  const isk = 0
  const wreck = r.flagshipKilled?.wreck ?? 0
  const wreckItemId = weekendRareWreckIdFor(spec.cardId, ctx)
  const granted = weekendGrantRewards(state, {
    isk,
    wreck,
    blackBox: r.flagshipKilled !== undefined,
    blackBoxItemId: weekendBlackBoxItemIdOf(state.weekendEvent, ctx),
    ...(wreckItemId !== undefined ? { wreckItemId } : {}),
  })
  const gname = ctx.galaxies.get(involved.galaxyId)?.name ?? involved.galaxyId
  const evNow = state.weekendEvent
  if (evNow !== undefined) {
    if (r.flagshipKilled !== undefined) {
      noteReward(evNow, undefined, { wreck: granted.wreck, blackBox: granted.blackBox })
      if (granted.blackBox > 0) evNow.flagshipBlackBox = true
    }
  }
  if (r.reclaimed !== undefined) {
    if (r.reclaimed.allClear) {
      addLog(
        state,
        'trade',
        `✦ 全部占领区夺回：「${gname}」是最后一处 —— 夺回奖励与全清额外奖励按玩家的投入比例结算，活动结束时统一发放。`,
        'core.weekend.002',
        { p1: gname },
      )
    } else {
      addLog(
        state,
        'trade',
        `✦ 夺回「${gname}」：夺回奖励按玩家在该星系的投入比例结算，活动结束时统一发放。`,
        'core.weekend.001',
        { p1: gname },
      )
    }
  }
  if (r.flagshipKilled !== undefined) {
    const box = granted.blackBox
    const sharePct = Math.round(weekendFlagshipSharesOf(evNow).player * 100)
    addLog(
      state,
      'trade',
      box
        ? `✦ 玩家击沉入侵旗舰：母舰血量归零 —— 旗舰黑匣 ×1 ＋ 稀有残骸 ×${granted.wreck} 已存入物品仓库。`
        : `✦ 玩家击沉入侵旗舰：母舰血量归零 —— 稀有残骸 ×${granted.wreck} 已存入物品仓库；玩家输出占比 ${sharePct}% 未过半，旗舰黑匣未爆。`,
      box ? 'core.weekend.003' : 'core.weekend.016',
      { p1: granted.wreck, p2: sharePct },
    )
  }
  return { galaxyId: involved.galaxyId, kind: involved.kind, gain: r.progressGain, isk: granted.isk, wreck: granted.wreck, note: r.note }
}
