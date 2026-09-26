/**
 * **周末入侵 · 两封通讯**（2026-09-25 · 船长给了文案并令「落码吧」）。
 *
 * 船长口径（照抄要点）：
 * 1. 「**每场都发，但是覆盖上一次的**」⇒ 两封信各用**固定 id**（`msg-weekend-warn` / `msg-weekend-settle`），
 *    每场把 `state.commsInstance` 里那一条**整条替换**（正文与奖励清单换成新一场的）；
 * 2. 结算信的跳转「**显示详细奖励，点击后弹出类似虫洞撤离的结算界面**」⇒ 两封信都带跳转按钮，
 *    结算那封的按钮是**弹面板**（`action: 'weekendSummary'`），面板读 `state.weekendLastResult`；
 * 3. 文案由船长给稿、经办人按"不出现括号备注"的口径润色；**奖励清单不用备注括起来**，
 *    而是作为清单里的一项（`commsInstance.rewards` 结构化存下，界面按语言拼串）。
 *
 * ⚠ 文案 id 全在 `l10n/table.ts`（`core.weekend.010~015` 正文 · `020~023` 族名）；
 * 这里同时给一份**中文原文**（core 侧兜底，界面按 id 重新渲染 ⇒ 中英各自成句）。
 */
import { deliverCommsInstance } from './comms'
import type { GameState } from './state'
import type { CommsInstanceEntry, CommsRewardLine, SimContext } from './types'
import {
  WEEKEND_BLACKBOX_ITEM_ID,
  weekendRareWreckIdFor,
} from './weekendBattle'
import { weekendFoeCardOf } from './weekendEvent'
import type { WeekendEventState, WeekendResultSnapshot } from './weekendEvent'

/** 预警信 id（固定 ⇒ 每场覆盖） */
export const WEEKEND_COMMS_WARN_ID = 'msg-weekend-warn'
/** 结算信 id（固定 ⇒ 每场覆盖） */
export const WEEKEND_COMMS_SETTLE_ID = 'msg-weekend-settle'
/** 发件方：深空工业协会 · 航线安全（危险星区与编队活动提示，与 `msg-ender-warning` 同部门） */
export const WEEKEND_COMMS_FACTION_ID = 'dshi'
export const WEEKEND_COMMS_DEPT_ID = 'dept-route-safety'

/**
 * **族名的中文全称**（通讯文案用；族字母只是简称）。
 * 口径与残骸族名同源（`wreckGroups.ts`：海盗 / 异形生物 / 鱿烬亡军 / 墨潮帮）；
 * 英文同 `WRECK_FAMILY_EN`（Pirate / Alien / Deadarmy / Ink Tide），两侧都在
 * `l10n/table.ts` 的 `core.weekend.020~023` 里逐族登记（界面按 `p1Id` 取译名）。
 */
const WEEKEND_FAMILY_NAME_ZH: Readonly<Record<string, string>> = {
  A: '海盗',
  C: '异形生物',
  G: '鱿烬亡军',
  H: '墨潮帮',
}
const WEEKEND_FAMILY_NAME_ID: Readonly<Record<string, string>> = {
  A: 'core.weekend.020',
  C: 'core.weekend.021',
  G: 'core.weekend.022',
  H: 'core.weekend.023',
}

/** 族名中文全称（未知族回落到「X 族」） */
export function weekendFamilyNameZh(family: string): string {
  return WEEKEND_FAMILY_NAME_ZH[family] ?? `${family} 族`
}

/** 族名文案 id（未知族 ⇒ undefined ⇒ 调用方不写 `p1Id`，界面直接用中文原文） */
export function weekendFamilyNameId(family: string): string | undefined {
  return WEEKEND_FAMILY_NAME_ID[family]
}

/** 一笔奖励 → 中文原文（界面另有按语言拼串的同款逻辑；两边读的是同一份 `rewards`） */
function rewardLineZh(ctx: SimContext, line: CommsRewardLine): string {
  if (line.isk !== undefined) return `${line.isk.toLocaleString('zh-CN')} 信用点`
  const id = line.itemId ?? ''
  const name = ctx.items.get(id)?.name ?? id
  return `${name} ×${line.qty ?? 1}`
}

/** 逐笔奖励拼成一句清单（顿号分隔；空清单 = 空串） */
function rewardListZh(ctx: SimContext, lines: readonly CommsRewardLine[]): string {
  return lines.map((l) => rewardLineZh(ctx, l)).join('、')
}

/** 快照 → 结构化奖励清单（**与实发同源**：只用快照里的合计，不另算一遍） */
export function weekendRewardLinesOf(snapshot: WeekendResultSnapshot): CommsRewardLine[] {
  const out: CommsRewardLine[] = []
  if (snapshot.wreck > 0 && snapshot.wreckItemId !== undefined) {
    out.push({ itemId: snapshot.wreckItemId, qty: snapshot.wreck })
  }
  if (snapshot.isk > 0) out.push({ isk: snapshot.isk })
  if (snapshot.blackBox > 0) out.push({ itemId: WEEKEND_BLACKBOX_ITEM_ID, qty: snapshot.blackBox })
  return out
}

/**
 * **预警信**（活动开局那一拍送达）：落点处数 = 全部占领区（核心 ＋ 外围）；核心星系按名字写进正文。
 */
export function weekendWarnCommsOf(
  state: GameState,
  ctx: SimContext,
  ev: WeekendEventState,
): CommsInstanceEntry {
  const family = weekendFamilyNameZh(ev.family)
  const familyId = weekendFamilyNameId(ev.family)
  const coreName = ctx.galaxies.get(ev.coreId)?.name ?? ev.coreId
  const count = ev.peripheryIds.length + 1
  const subject = `航线警告：${family}入侵`
  const paragraphs = [
    `就在刚刚，协会检测到大量非法舰队信号。经观测员核实，确定是${family}的舰队正在入侵这片空域，落点 ${count} 处，核心是「${coreName}」。标记已经打到星图上。被入侵的星系会有大量${family}舰队活动，请非战斗人员避开危险星系。`,
    `但如果你想为协会出一份力，或者单纯想赚上一笔，我们也欢迎你加入清缴入侵舰队的行列。战役结束后，协会会统一按各位的贡献发放报酬。`,
  ]
  return {
    id: WEEKEND_COMMS_WARN_ID,
    factionId: WEEKEND_COMMS_FACTION_ID,
    deptId: WEEKEND_COMMS_DEPT_ID,
    kind: '提示',
    atGameMs: 0, // 投递时由 `deliverCommsInstance` 盖章
    subject,
    subjectId: 'core.weekend.010',
    paragraphs,
    bodyIds: ['core.weekend.011', 'core.weekend.012'],
    params: {
      seq: ev.seq,
      p1: family,
      ...(familyId !== undefined ? { p1Id: familyId } : {}),
      p2: count,
      p3: coreName,
    },
    hint: { text: '星图 · 被占星系有红色发光与旗标', page: 'map' },
  }
}

/**
 * **结算信**（贡献奖入账那一拍送达；正文里的奖励清单 = 实发）。
 * 零贡献（`rewards` 为空）⇒ 走船长定的变体句。
 */
export function weekendSettleCommsOf(
  state: GameState,
  ctx: SimContext,
  snapshot: WeekendResultSnapshot,
): CommsInstanceEntry {
  const family = weekendFamilyNameZh(snapshot.family)
  const familyId = weekendFamilyNameId(snapshot.family)
  const coreName = ctx.galaxies.get(snapshot.coreId)?.name ?? snapshot.coreId
  const rewards = weekendRewardLinesOf(snapshot)
  const listText = rewardListZh(ctx, rewards)
  const hasReward = rewards.length > 0
  /**
   * **本期按贡献拿到的协会声望**（**2026-09-26 船长令**：「关于入侵的结算界面和结束通讯处，
   * 需要提及玩家获得了多少声望」）——读数与实发同源（都在 `weekendSettleAndGrant` 那一拍算出、
   * 写进 `WeekendResultSnapshot.standing`）；**0 点不加这一段**（没有贡献的场次说了也没用）。
   */
  const standing = snapshot.standing ?? 0
  const standingLine = `本次入侵按你在清缴行动中的贡献，协会为你记入「深空工业协会」声望 +${standing}。`
  const subject = `航线通报：${family}入侵已被终结！星域恢复了和平！`
  const paragraphs = [
    hasReward
      ? `${family}的入侵已经结束，「${coreName}」附近的星系已经恢复正常。根据你在清缴行动中的表现，你将获得 ${listText} 等奖励以示鼓励。`
      : `${family}的入侵已经结束，「${coreName}」附近的星系已经恢复正常。本次清缴你没有贡献记录，因此没有奖励。`,
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

/**
 * **每拍同步两封信**（幂等 · 自愈）：引擎每拍调一次即可。
 *
 * - 预警：有**活的入侵**且存档里那一封的 `seq` 不是本场 ⇒ 投递/覆盖；
 * - 结算：有**战果快照**且那一封的 `seq` 不是本场 ⇒ 投递/覆盖。
 *
 * 为什么按 `seq` 判而不是"投过就不管"：① 船长要"每场都发但覆盖上一次"；
 * ② 玩家离线跨过开局/结束点、或老档第一次载入时，这里会把该补的信补上（读档不重发、跨场必重发）。
 */
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

/** 结算面板要用的"这一场打的那张旗舰卡"的稀有残骸 id（快照缺省时兜底解析；解析不到 = undefined） */
export function weekendSnapshotWreckItemId(
  snapshot: WeekendResultSnapshot,
  ctx: SimContext,
): string | undefined {
  return snapshot.wreckItemId ?? weekendRareWreckIdFor(weekendFoeCardOf(snapshot.family, 'flagship'), ctx)
}
