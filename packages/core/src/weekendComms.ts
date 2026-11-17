import { deliverCommsInstance } from './comms'
import { HIGH_SEC_PENALTY } from './consumables'
import type { GameState } from './state'
import type { CommsInstanceEntry, CommsRewardLine, SimContext } from './types'
import {
  WEEKEND_BLACKBOX_ITEM_ID,
  weekendRareWreckIdFor,
} from './weekendBattle'
import {
  weekendFamilyNameId,
  weekendFamilyNameZh,
  weekendFoeCardOf,
} from './weekendEvent'
import type { WeekendEventState, WeekendResultSnapshot } from './weekendEvent'

export const WEEKEND_COMMS_WARN_ID = 'msg-weekend-warn'
export const WEEKEND_COMMS_SETTLE_ID = 'msg-weekend-settle'
export const WEEKEND_COMMS_FACTION_ID = 'dshi'
export const WEEKEND_COMMS_DEPT_ID = 'dept-route-safety'

export { weekendFamilyNameId, weekendFamilyNameZh } from './weekendEvent'

function rewardLineZh(ctx: SimContext, line: CommsRewardLine): string {
  if (line.isk !== undefined) return `${line.isk.toLocaleString('zh-CN')} 信用点`
  const id = line.itemId ?? ''
  const name = ctx.items.get(id)?.name ?? id
  return `${name} ×${line.qty ?? 1}`
}

function rewardListZh(ctx: SimContext, lines: readonly CommsRewardLine[]): string {
  return lines.map((l) => rewardLineZh(ctx, l)).join('、')
}

export function weekendRewardLinesOf(snapshot: WeekendResultSnapshot): CommsRewardLine[] {
  const out: CommsRewardLine[] = []
  if (snapshot.wreck > 0 && snapshot.wreckItemId !== undefined) {
    out.push({ itemId: snapshot.wreckItemId, qty: snapshot.wreck })
  }
  if (snapshot.isk > 0) out.push({ isk: snapshot.isk })
  if (snapshot.blackBox > 0) {
    out.push({ itemId: snapshot.blackBoxItemId ?? WEEKEND_BLACKBOX_ITEM_ID, qty: snapshot.blackBox })
  }
  return out
}

export function weekendWarnCommsOf(
  _state: GameState,
  ctx: SimContext,
  ev: WeekendEventState,
): CommsInstanceEntry {
  const family = weekendFamilyNameZh(ev.family)
  const familyId = weekendFamilyNameId(ev.family)
  const coreName = ctx.galaxies.get(ev.coreId)?.name ?? ev.coreId
  const count = ev.peripheryIds.length + 1
  const subject = `航线警告：${family}入侵`
  const suspicion = ev.beaconHighSec === true
  const paragraphs = [
    ...(suspicion
      ? [
          `飞行员，这次入侵与高安空域启动的信号发射器有关。发射前后，附近只检测到你的舰船信号，协会有理由怀疑你参与其中。已按规定扣除 ${HIGH_SEC_PENALTY} 点可支配声望，调查仍会继续。`,
        ]
      : []),
    `目前，${family}舰队已进入 ${count} 处星系，核心位于「${coreName}」。占领范围已在星图标明。非战斗作业请避开这些星系，原有安全等级不代表入侵期间仍然安全。`,
    `清缴行动正在进行。有作战准备的飞行员可以参与，出击前先查看各星系敌情。协会按贡献结算报酬，在本场行动结束后统一发放。`,
  ]
  return {
    id: WEEKEND_COMMS_WARN_ID,
    factionId: WEEKEND_COMMS_FACTION_ID,
    deptId: WEEKEND_COMMS_DEPT_ID,
    kind: '提示',
    atGameMs: 0,
    subject,
    subjectId: 'core.weekend.010',
    paragraphs,
    bodyIds: [...(suspicion ? ['core.weekend.044'] : []), 'core.weekend.011', 'core.weekend.012'],
    params: {
      seq: ev.seq,
      p1: family,
      ...(familyId !== undefined ? { p1Id: familyId } : {}),
      p2: count,
      p3: coreName,
      ...(suspicion ? { p4: HIGH_SEC_PENALTY } : {}),
    },
    hint: { text: '星图 · 被占星系有红色发光与旗标', page: 'map' },
  }
}

export function weekendSettleCommsOf(
  _state: GameState,
  ctx: SimContext,
  snapshot: WeekendResultSnapshot,
): CommsInstanceEntry {
  const family = weekendFamilyNameZh(snapshot.family)
  const familyId = weekendFamilyNameId(snapshot.family)
  const coreName = ctx.galaxies.get(snapshot.coreId)?.name ?? snapshot.coreId
  const rewards = weekendRewardLinesOf(snapshot)
  const listText = rewardListZh(ctx, rewards)
  const hasReward = rewards.length > 0
  const standing = snapshot.standing ?? 0
  const standingLine = `本次入侵按你在清缴行动中的贡献，协会为你记入「深空工业协会」声望 +${standing}。`
  const subject = `航线通报：${family}入侵结束`
  const kill = snapshot.flagshipPlayerKill
  const paragraphs = [
    hasReward
      ? `${family}本场入侵已结束，「${coreName}」附近解除占领。你的清缴报酬为 ${listText}，已按记录发放；实物在物品仓库，信用点进钱包。各项明细可在结算记录查看。`
      : `${family}本场入侵已结束，「${coreName}」附近解除占领。本场没有你的可结算奖励记录，未发放报酬。详细战况可查看结算记录。`,
    ...(kill !== undefined ? ['你在本期的旗舰战中亲手击沉了入侵旗舰。'] : []),
    ...(standing > 0 ? [standingLine] : []),
  ]
  return {
    id: WEEKEND_COMMS_SETTLE_ID,
    factionId: WEEKEND_COMMS_FACTION_ID,
    deptId: WEEKEND_COMMS_DEPT_ID,
    kind: '提示',
    atGameMs: 0,
    subject,
    subjectId: 'core.weekend.013',
    paragraphs,
    bodyIds: [
      hasReward ? 'core.weekend.014' : 'core.weekend.015',
      ...(kill !== undefined ? ['core.weekend.042'] : []),
      ...(standing > 0 ? ['core.weekend.037'] : []),
    ],
    params: {
      seq: snapshot.seq,
      p1: family,
      ...(familyId !== undefined ? { p1Id: familyId } : {}),
      p2: coreName,
      p3: listText,
      ...(standing > 0 ? { p4: String(standing) } : {}),
    },
    hint: { text: '查看详细奖励', action: 'weekendSummary' },
    rewards,
  }
}

export function weekendSyncComms(
  state: GameState,
  ctx: SimContext,
  _nowWallMs = Date.now(),
): { warned: boolean; settled: boolean } {
  const out = { warned: false, settled: false }
  const ev = state.weekendEvent
  if (ev !== undefined && ev.endedAtWallMs === undefined) {
    const cur = state.commsInstance?.[WEEKEND_COMMS_WARN_ID]
    if (cur === undefined || cur.params?.['seq'] !== ev.seq) {
      deliverCommsInstance(state, ctx, weekendWarnCommsOf(state, ctx, ev))
      out.warned = true
    }
  }
  const snap = state.weekendLastResult
  if (snap !== undefined) {
    const cur = state.commsInstance?.[WEEKEND_COMMS_SETTLE_ID]
    if (cur === undefined || cur.params?.['seq'] !== snap.seq) {
      deliverCommsInstance(state, ctx, weekendSettleCommsOf(state, ctx, snap))
      out.settled = true
    }
  }
  return out
}

export function weekendSnapshotWreckItemId(
  snapshot: WeekendResultSnapshot,
  ctx: SimContext,
): string | undefined {
  return snapshot.wreckItemId ?? weekendRareWreckIdFor(weekendFoeCardOf(snapshot.family, 'flagship'), ctx)
}
