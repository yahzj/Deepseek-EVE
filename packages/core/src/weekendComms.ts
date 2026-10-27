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

/** 预警信 id（固定 ⇒ 每场覆盖） */
export const WEEKEND_COMMS_WARN_ID = 'msg-weekend-warn'
/** 结算信 id（固定 ⇒ 每场覆盖） */
export const WEEKEND_COMMS_SETTLE_ID = 'msg-weekend-settle'
/** 发件方：深空工业协会 · 航线安全（危险星区与编队活动提示，与 `msg-ender-warning` 同部门） */
export const WEEKEND_COMMS_FACTION_ID = 'dshi'
export const WEEKEND_COMMS_DEPT_ID = 'dept-route-safety'

/**
 * 族名（**唯一登记处已移到 `weekendEvent.ts`** —— 悬赏侧与战斗侧也要取它
 * （`weekendBounty` / `weekendBattle`），而那两个模块被本文件反过来 import
 * ⇒ 族名表放那里，三个消费方才能共用而不绕成循环依赖）。
 *
 * 本文件只**转发**这两个函数：`index.ts` 与渲染层都从 `@whale/core` 取，对外接口不变。
 */
export { weekendFamilyNameId, weekendFamilyNameZh } from './weekendEvent'

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
  /**
   * **黑匣按快照里记的那一件报名字**（**2026-10-02 船长令「甲」**）：光环期显示「光环旗舰黑匣」、
   * 墨潮期显示「墨潮旗舰黑匣」。缺省（本批之前结束的老场次）⇒ 落款墨潮匣 ——
   * 那正是玩家当时真正到手的那一件（**不回改历史读数**）。
   */
  if (snapshot.blackBox > 0) {
    out.push({ itemId: snapshot.blackBoxItemId ?? WEEKEND_BLACKBOX_ITEM_ID, qty: snapshot.blackBox })
  }
  return out
}

/**
 * **预警信**（活动开局那一拍送达）：落点处数 = 全部占领区（核心 ＋ 外围）；核心星系按名字写进正文。
 *
 * **两副正文**（**2026-10-01 船长令**：「**如果玩家在高安使用信号发射器，触发入侵的通讯会在开头
 * 怀疑玩家，并在文本中说扣玩家的声望。**」）：
 * - **默认**（每周自己爆发 / 默认路点火）⇒ 两段：实况 ＋ 招募（`core.weekend.011` / `.012`）；
 * - **高安点火那一场** ⇒ 前面加一段质问（`core.weekend.044`），说清"只发现了你的舰船信号"与
 *   **扣了 `HIGH_SEC_PENALTY` 点声望**。
 *
 * 船长同日对措辞的两条口径：① 只写**怀疑**（「我们在附近只发现了你的舰船信号」式），**不写**"登记在
 * 你名下"这类确凿证据；② 裁定「**按 B**」⇒ 原实况段同时改成能接住质问的承接口气（去掉侦查叙述与
 * 「就在刚刚」，战况四件事一件不少；见 `core.weekend.011` 的 `⟪文案调整 2026-10-01⟫`）。
 *
 * ⚠ 判据 = **事件上的留痕** `beaconHighSec`（点火那一刻写进 `state.weekendEvent`，存档同字段往返）
 * ⇒ 读档、离线跨场、每拍补发都走同一份数据，这里**不另判一次**位置或安等。
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
  /** 这一场是不是玩家在高安点的火（决定要不要加质问段 ＋ 喂 `p4`） */
  const suspicion = ev.beaconHighSec === true
  // ⟪文案调整 2026-10-04⟫ 高安点火保持怀疑与实扣，战况段不承诺常规安全等级仍有效。
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
    atGameMs: 0, // 投递时由 `deliverCommsInstance` 盖章
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
  // ⟪文案调整 2026-10-04⟫ 官方结算只说明本场结束与实发，不承诺整个星域安全。
  const subject = `航线通报：${family}入侵结束`
  /**
   * **旗舰战留档那一段**（**2026-09-27 船长令**：「和入侵结束的报告一样，留档玩家的旗舰战记录」）：
   * 有"玩家亲手击沉"的记录才加这一段 ⇒ 结算信里也说得清"旗舰是谁打沉的"（原先只有面板的归属抬头）。
   */
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
