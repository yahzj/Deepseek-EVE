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
import { blackboxSeenOf } from './blackbox'
import { addWare } from './inventory'
import { isPlugOf } from './plugs'
import { addLog } from './state'
import type { GameState } from './state'
import type { CommsInstanceEntry, CommsRewardLine, SimContext } from './types'
import {
  WEEKEND_BLACKBOX_ITEM_ID,
  weekendGrantRewards,
  weekendRareWreckIdFor,
  noteReward,
} from './weekendBattle'
import {
  weekendBlackBoxSettledOf,
  weekendFamilyNameId,
  weekendFamilyNameZh,
  weekendFoeCardOf,
  weekendLastHitByPlayer,
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
  if (snapshot.blackBox > 0) out.push({ itemId: WEEKEND_BLACKBOX_ITEM_ID, qty: snapshot.blackBox })
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
  const paragraphs = [
    ...(suspicion
      ? [
          `协会要先确认一件事：这次入侵的信号，来自一次在高安启动的信号发射器。发射前后，我们在附近只发现了你的舰船信号。协会不认为这是巧合，已经按规矩从你的声望里扣了 ${HIGH_SEC_PENALTY} 点。这件事协会会继续追查。`,
        ]
      : []),
    `现在，${family}的舰队正在入侵这片空域，落点 ${count} 处，核心是「${coreName}」，标记已经打到星图上。被入侵的星系会有大量${family}舰队活动，请非战斗人员避开危险星系。`,
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
  const subject = `航线通报：${family}入侵已被终结！星域恢复了和平！`
  /**
   * **旗舰战留档那一段**（**2026-09-27 船长令**：「和入侵结束的报告一样，留档玩家的旗舰战记录」）：
   * 有"玩家亲手击沉"的记录才加这一段 ⇒ 结算信里也说得清"旗舰是谁打沉的"（原先只有面板的归属抬头）。
   */
  const kill = snapshot.flagshipPlayerKill
  const paragraphs = [
    hasReward
      ? `${family}的入侵已经结束，「${coreName}」附近的星系已经恢复正常。根据你在清缴行动中的表现，你将获得 ${listText} 等奖励以示鼓励（实物奖励已存入物品仓库）。`
      : `${family}的入侵已经结束，「${coreName}」附近的星系已经恢复正常。本次清缴你没有贡献记录，因此没有奖励。`,
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

/* ═══════════ ⏳ 待删（船长令 2026-09-26：「**备注下，明天删除这个修正，防止之后出错**」；
 *             **2026-09-27 复令：「先不删」**）═══════════════════════════════════════════════════
 *
 * 这一段是**一次性补偿**：给"本批修复上线前打完入侵却没拿到黑匣"的档补发 1 枚。截止时刻写死在过去，
 * 所以**不会**对新场次生效；但它同样是"留在代码里只会是将来出错来源"的一次性修正 ⇒ 原定 2026-09-27 删。
 *
 * 🔴 **2026-09-27 船长复令「先不删」**（起因：截止同日又延到 08:24，玩家得**下次登录**才拿得到那 1 枚）
 * ⇒ **日期不再是删除条件**。真正的判据只有一条：**等该补发的档都登录过、补发落地之后再删**。
 * ⚠ 换言之：**别因为"横幅上写的日期已经过了"就删** —— 要删先问船长。
 *
 * 删除清单：
 * ① 本文件：`WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS` ＋ `compensateMissingWeekendBlackBox`
 *    ＋ 只服务它的私有助手 `hasAnyBlackBox` / `hasAnyPlug`（整段，含头注）；
 * ② `packages/core/src/index.ts`：这两条导出的两行（连同注释）；
 * ③ `apps/desktop/src/renderer/src/game/engine.ts`：`applyLoadLedgerRepairs` 里调用它的那一行
 *    （声望回正是另一条，见 `expedition.ts` 的同类横幅：**要么一起删、要么只删这一行**）；
 * ④ 词条 `core.weekend.040`（`packages/data/src/l10n/table.ts`）＋ 用例
 *    `packages/core/tests/standing-repair-compensation.test.ts` 里"④ 补发黑匣"那一组。
 *
 * 检索口令：`git grep 明日删除`（本批共三处横幅）。
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * **补发黑匣的截止时刻**（**2026-09-26 船长裁定**：「**必须是推送之前打完**」→ 追问「什么时候算推送」
 * 答「**现在**」；**2026-09-27 船长令**：「**补发时间延长到现在**」→ 同日又令「**将8点24之前已经完成的补发**」）。
 *
 * 值 = **2026-09-27 08:24 +08:00**。改动沿革：
 * - 首值 **21:33**：以"修复上线后掉落就正常了"为前提；
 * - **2026-09-26 23:11**（船长令「将之前的补发时间调到现在截止」）：真根因是**那一掷被漏掉了**
 *   （系统性，见 `weekendEvent.weekendTickBoss` 的同日修复），旧前提不成立 ⇒ 21:33~23:11 的场次进补偿面；
 * - **2026-09-27 08:00**（船长令「补发时间延长到现在」）：仍有玩家报"打完入侵没有黑匣" ⇒ 再推到现在；
 * - **2026-09-27 08:24**（船长令「将8点24之前已经完成的补发」）：把截止再放到 08:24，让 08:00~08:24
 *   之间结束的场次也进补偿面。
 *
 * **只补这些修复上线之前打完的入侵**。⚠ 若日后还要补，**改这个常量**（别改成 `Date.now()`：
 * 那会让"以后每一场没掉黑匣的入侵"都被补一遍）。
 */
export const WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS = 1_790_468_640_000

/**
 * **给"打完入侵却没拿到黑匣"的玩家补发 1 枚**（**2026-09-26 船长令**：
 * 「**检查玩家是否已经打完入侵（根据通讯），给所有打完入侵但是没有获取黑匣的玩家补发一个黑匣
 * （必须是推送之前打完，同时也要检查玩家是否已经将黑匣制作成舰船插件）**」）。
 *
 * 判据四条，全部成立才补（读档后调一次；幂等）：
 * 1. **打完的判据 = 通讯**：`state.commsInstance` 里有结算信 `msg-weekend-settle`（船长指定按通讯判）；
 * 2. **推送之前打完**：`weekendLastResult.endedAtWallMs < WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS`；
 * 3. **那一刻没拿到**：快照的 `blackBox === 0`（当场实发数，与结算面板同一把尺）；
 * 4. **至今也没有黑匣痕迹**：没见过黑匣（`blackboxSeenOf` 唯一判据）**且手上没有黑匣实物**
 *    （仓库 ＋ 各船货舱；`blackboxSeen` 是三态的显式 `false` ⇒ 单靠它判不出"实物就在库里"）
 *    **且没有任何舰船插件实物**——船长点名的那条：已经把黑匣做成插件的玩家，说明他当初拿到过黑匣
 *    （老档的 `blackboxSeen` 是后补的，靠它单独判会漏掉这种）。
 *
 * 幂等靠**动作本身**：入库会置位"见过黑匣" ⇒ 第二次调用第 4 条即不成立，天然只补一次。
 * 落点 = 物品仓库 ＋ 一条系统日志（船长裁定「**不发**（信）」⇒ 不投递通讯）。
 *
 * ⚠ **与同文件下面的 `reconcileWeekendBlackBox`（逐 tick 对账）共用同一把钥匙**（`ev.flagshipBlackBox`
 * ＝"这一枚结清了没有"）：本函数付钱时**也把那一格写 `true`**（见函数体末尾）⇒ 两条入口**不可能双发**。
 * 2026-09-28 之前两入口是靠 `WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS` **按时间划界**防重的；
 * 船长当日改判「历史场次凡有留档就补」⇒ 划界撤掉，改共用钥匙。
 * （本常量仍保留：它是"只补推送前打完的场次"这条**自身判据**，与防重无关了。）
 *
 * @returns 真补了才 `true`
 */
export function compensateMissingWeekendBlackBox(state: GameState, ctx: SimContext): boolean {
  if (state.commsInstance?.[WEEKEND_COMMS_SETTLE_ID] === undefined) return false
  const snap = state.weekendLastResult
  if (snap === undefined || snap.endedAtWallMs >= WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS) return false
  if ((snap.blackBox ?? 0) > 0) return false
  if (blackboxSeenOf(state) || hasAnyBlackBox(state)) return false
  if (hasAnyPlug(state, ctx)) return false
  addWare(state, WEEKEND_BLACKBOX_ITEM_ID, 1)
  /**
   * **把"已结清"写在共用钥匙上**（`ev.flagshipBlackBox`）：逐 tick 对账那条入口
   * （`reconcileWeekendBlackBox`）按这一格判"还没结清"，不写就会**双发**。
   * ⚠ 只在"补偿的正是当前那场"时才写（`endedAtWallMs` 对得上），免得给别的场次乱打标记。
   */
  const ev = state.weekendEvent
  if (ev !== undefined && ev.endedAtWallMs === snap.endedAtWallMs) ev.flagshipBlackBox = true
  addLog(
    state,
    'system',
    '入侵补偿：补发旗舰黑匣 ×1（已存入物品仓库）。',
    'core.weekend.040',
  )
  return true
}

/** 黑匣实物在不在手上（仓库 ＋ 各船货舱；补发黑匣的第 4 条判据之一） */
function hasAnyBlackBox(state: GameState): boolean {
  if ((state.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID] ?? 0) > 0) return true
  for (const ship of Object.values(state.fleet)) {
    if ((ship?.cargo?.[WEEKEND_BLACKBOX_ITEM_ID] ?? 0) > 0) return true
  }
  return false
}

/** 玩家手上/船上到底有没有舰船插件实物（补发黑匣的第 4 条判据；只看实物，不看图纸与配方） */
function hasAnyPlug(state: GameState, ctx: SimContext): boolean {
  for (const ship of Object.values(state.fleet)) {
    if (ship === undefined) continue
    if ((ship.plugs ?? []).length > 0) return true
    for (const [id, n] of Object.entries(ship.cargo ?? {})) {
      if (n > 0 && isPlugOf(ctx.modules.get(id))) return true
    }
  }
  for (const [id, n] of Object.entries(state.warehouse.items)) {
    if (n > 0 && isPlugOf(ctx.modules.get(id))) return true
  }
  return false
}

/* ─────────────── 补发入口之二：逐 tick 对账（规则漏发） ─────────────── */

/**
 * **对账补发：把"击杀了 BOSS 却没拿到"的旗舰黑匣补给玩家**（**2026-09-28 船长令**：
 * 「**不需要给本地存档补发，采用工具线上补发**」；同日再令
 * 「**让玩家击杀BOSS就能获得黑匣，取消之前的复杂判定**」）。
 *
 * 判据四条（条条对应船长 2026-09-28 的裁定）：
 * 1. **有留档**：`weekendLastHitByPlayer(ev)` —— 玩家亲手打爆母舰（**唯一判据**，别另拍一套）；
 * 2. **本场已结束**：进行中的场次走正常发放路径（击沉那一刻就发），不在这里抢着发；
 * 3. **没结清**：`!weekendBlackBoxSettledOf(ev)` —— 这一枚还没落到玩家手里；
 * 4. **台账也干净**：`rewardLedger.blackBox === 0`（双保险）。
 *
 * ⚠ **"占比 > 50%"那一条已随爆率表一起取消** ⇒ 现在是「**凡有留档就补**」（船长当日选的口径），
 * 历史场次一并捞回来。
 * ⚠ **与上面那次一次性补偿共用同一把钥匙**（`ev.flagshipBlackBox`）：那个入口判据更宽（按通讯判、
 * 不要求留档），它付钱时也把这一格写 `true` ⇒ 两条入口**不可能双发**；
 * 因此**不再需要**按 `WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS` 划时间界
 * （划界是甲案台账落盘之前的临时办法，2026-09-28 随"历史场次一起放宽"一并撤掉）。
 *
 * 幂等靠**动作本身**：补了就写死 `flagshipBlackBox = true` ⇒ 第 3 条即不成立，第二次调用直接返回。
 * 落点 = 物品仓库 ＋ 一条系统日志（**不投递通讯**，与那次补偿同口径）。
 *
 * @returns 真补了才 `true`
 */
export function reconcileWeekendBlackBox(state: GameState): boolean {
  const ev = state.weekendEvent
  if (ev === undefined) return false
  /** ① 留档（单一判据）：没有"玩家亲手击沉"的记录 ⇒ 不是本工具的事 */
  if (!weekendLastHitByPlayer(ev)) return false
  /** ② 只补已结束的场次 */
  const endedAtWallMs = ev.endedAtWallMs
  if (endedAtWallMs === undefined) return false
  /** ③④ 没结清：结清标记与台账都要空 */
  if (weekendBlackBoxSettledOf(ev)) return false
  if ((ev.rewardLedger?.blackBox ?? 0) > 0) return false
  const granted = weekendGrantRewards(state, { blackBox: true })
  /** 物品契约破损（`addWare` 拒收）⇒ 一枚也没落地：不记账、不打标记，下一拍再试 */
  if (granted.blackBox <= 0) return false
  ev.flagshipBlackBox = true
  noteReward(ev, undefined, { blackBox: granted.blackBox })
  /**
   * **战果快照只补"变了的那一栏"**（`blackBox`）：结算面板与结算信读的就是它 —— 不补，玩家会看到
   * "仓库里多了一枚、面板还写 0"。⚠ 这里**不整张重建**快照：重建会把贡献占比、进度收入那些
   * 与本次补发无关的数按"现在的 state"重算一遍，凭空改写历史读数（补发只该动它补的那一件）。
   */
  const snap = state.weekendLastResult
  if (snap !== undefined && snap.endedAtWallMs === endedAtWallMs) {
    snap.blackBox += granted.blackBox
  }
  addLog(
    state,
    'system',
    `📦 补发：旗舰黑匣 ×${granted.blackBox}（你在本场入侵中亲手击沉了旗舰）——已存入物品仓库。`,
    'core.weekend.039',
    { p1: granted.blackBox },
  )
  return true
}
