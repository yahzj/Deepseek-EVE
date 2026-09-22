/**
 * 序章·苏醒（2026-09-05 船长拍板；**2026-09-17 教程重做后只剩"演出 ＋ 收尾"**）。
 *
 * 船长 2026-09-17 原话：「**我希望将现有教程重做，改成以重要任务的形式发布在任务中心，让玩家自由选择完成。**
 * 教程将被拆分成以下几个任务系列：'第一次完成悬赏'，'第一次采集矿物'…**每个'第一次'的任务完成后就会有
 * 一则通讯告诉玩家一些相关的情报**」⇒ 旧的**线性七步**（采集→交付→出售→修复→试炼→技能→分身）、
 * 步骤机、顶部引导条、跳过教程**一并退场**；教程内容改由任务中心的 13 条「第一次」任务承载
 * （见 `firstTasks.ts` ＋ `data/src/firstTaskMessages.ts`）。
 *
 * 本模块现在只剩三件事：
 * - **序章演出**（`ONB_AWAKEN` = 0；渲染层 `PrologueScreen`：黑屏→醒来→自检→呼号）；
 * - 演出结束（或玩家跳过）⇒ `ONB_DONE`（**2026-09-20 起不再在这里发布「寻找人类」**，见下条）；
 * - **贯穿任务「寻找人类」的发布闸门** ＋ 它的阶段目标（全部星系探索完毕记一次里程碑，2026-09-10 船长定）。
 *
 * ⚠ 老档迁移（`save.ts`）：`step` 只认 0 与 99——老档的 -1（未开始）／0.5（简报）／1..8（七步中）
 * 一律读成 99（不再有步骤机；其「第一次」任务由一次性判定补记）。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { addLog, DEFAULT_PILOT_NAME } from './state'
import { sequentialPrefixDone, firstTasksMarkSeen } from './firstTasks'
import { grantStartRewardsForCurrent } from './firstRewards'

/** 序章演出中（渲染层 `PrologueScreen` 推进；演出期间不做任何任务判定） */
export const ONB_AWAKEN = 0
/** 序章已完成（老档与经典开局一律按此读档） */
export const ONB_DONE = 99

/**
 * 贯穿任务「寻找人类」：**「第一次」顺序段（前 11 条）完成后发布**，永久无法完成
 * （**2026-09-20 船长第三道令**：「完成 11 …后，就可以将寻找人类和第一次长途运输以及 第一次虫洞
 * 同时显示给玩家」——更早那句「寻找人类的任务只在完成所有第一次任务后才出现」**已据此作废**；
 * 再早的口径「序章结束时发布」（2026-09-05 船长：「正常发布，不告诉做法」）**只作废"发布时机"这一半**；
 * "正常发布 ＋ 不告诉做法 ＋ 完成方法未知"照旧）。
 */
export const TASK_FIND_HUMANS = 'find-humans'

/** 发布「寻找人类」（幂等）：只由 `publishFindHumansWhenReady` 调用 */
export function publishFindHumans(state: GameState): void {
  if (state.importantTasks[TASK_FIND_HUMANS]) return
  state.importantTasks[TASK_FIND_HUMANS] = { done: false }
  addLog(state, 'info', '◆ 重要任务发布「寻找人类」：完成方法未知——立足已稳，该往更深处打听了。', 'core.onboarding.001')
}

/**
 * **「寻找人类」发布闸门**（引擎每拍调用，幂等）：三条件齐了才发布——
 * ① 序章演出已结束（演出盖住全屏，此刻发布没意义，与 `comms.ts` 的"开场信"同款判据）；
 * ② 「第一次」的**顺序段（前 11 条）一条不剩**（`firstTasks.sequentialPrefixDone`）；
 * ③ 还没发布过。
 *
 * ⚠ **2026-09-20 船长第三道令改判**：「**完成 11 · 第一次指派 AI 副船后，就可以将寻找人类和
 * 第一次长途运输以及 第一次虫洞同时显示给玩家。寻找人类位于顶部。**」
 * ⇒ 旧口径「**只在完成所有第一次任务后才出现**」（同日第二道令）**作废**：发布点从"13 条全完成"
 * 提前到"前 11 条完成"，与末段并列批（长途运输 ＋ 虫洞）**同一拍**出现。
 * 其余口径照旧：正常发布、不告诉做法、完成方法未知（老档已发布的不会被收回）。
 *
 * 为什么是"每拍现算"而不是"挂在第 11 条完成那一刻"：判据全在 `state` 上（`importantTasks[id].done`），
 * 现算 ⇒ 老档、异常中断、将来新增条目都能自愈（与 `achievements` 的现算补发同一套路）。
 *
 * ⚠ **2026-09-22 船长 Excel 改序**：顺序段仍是 11 条，但**收尾那条从「第一次指派 AI 副船」变成
 * 「第一条船」**（技能 / AI 副船前移到生产之前）⇒ 判据与代码不变，揭示时点顺延三步。
 */
export function publishFindHumansWhenReady(state: GameState): boolean {
  if (state.importantTasks[TASK_FIND_HUMANS]) return false
  if (state.onboarding.step !== ONB_DONE) return false
  if (!sequentialPrefixDone(state)) return false
  publishFindHumans(state)
  return true
}

/** 序章收尾（幂等）：步骤落 99（**发布「寻找人类」改由发布闸门负责**，见上）＋ 记一笔"当前那条「第一次」已提示过"
 *  ＋（**2026-09-21 船长令**）把**第一条**的起手道具发掉——`ctx` 可选：给不了就跳过（当前第一条没写
 *  `startReward`，故不影响任何一条现状；日后给第一条补起手道具时，渲染层那条调用已把 ctx 传进来）。 */
function finishPrologue(state: GameState, ctx?: SimContext): void {
  if (state.onboarding.step !== ONB_DONE) state.onboarding.step = ONB_DONE
  /**
   * **导航「任务中心」推进提醒的起点**（**2026-09-20 船长令**：「每推进一阶段第一次任务时…进行提醒」）：
   * 序章收尾时把"当前那一条"（= 第一次扫描）记为已提示——开场信本来就会指路「待办清单在任务中心」
   * ⇒ 提醒留给**之后的每一次推进**（完成一条 ⇒ 下一条顶上 ⇒ 徽标亮）。老档不经过这里（step 已 99）
   * ⇒ 仍是首帧亮一次（与赏金那条「老档默认亮起提示」同款）。
   */
  firstTasksMarkSeen(state)
  if (ctx) grantStartRewardsForCurrent(state, ctx)
}

/**
 * 渲染层：序章演出完成（呼号落定）⇒ 序章结束（原先还要进"简报态"读教程，2026-09-17 起简报信
 * 直接躺进收件箱，不再锁页面）。
 */
export function beginAfterAwaken(state: GameState, ctx?: SimContext): CommandResult {
  if (state.onboarding.step !== ONB_AWAKEN) {
    return { ok: false, error: '当前不在序章演出阶段。', errorId: 'core.onboarding.002' }
  }
  finishPrologue(state, ctx)
  addLog(state, 'info', '自检完成——信息库重启，第一份简报已落在导航「通讯」里。', 'core.onboarding.003')
  return { ok: true }
}

/** 渲染层：跳过序章演出（未及起名 ⇒ 呼号落默认 PRTS）；与演完等价，不发放任何奖励 */
export function skipPrologue(state: GameState, ctx?: SimContext): CommandResult {
  if (state.onboarding.step !== ONB_AWAKEN) {
    return { ok: false, error: '序章演出已结束。', errorId: 'core.onboarding.004' }
  }
  if (state.character.name === DEFAULT_PILOT_NAME) state.character.name = 'PRTS'
  finishPrologue(state, ctx)
  addLog(state, 'system', '序章演出已跳过——开始新的航程。', 'core.onboarding.005')
  return { ok: true }
}

/** 「寻找人类」阶段目标：探索全部星系（里程碑只记一次）。
 *  2026-09-10 船长定：给这条贯穿任务加上可追踪目标——**探索全部星系、寻找人类踪迹**；
 *  达成时写一条日志，任务本身仍为进行中（完成方法未知，见 TASK_FIND_HUMANS 的原始口径）。
 *  廉价检查：未发布/已完成/已记里程碑时立即返回。 */
export function advanceFindHumans(state: GameState, ctx: SimContext): void {
  const task = state.importantTasks[TASK_FIND_HUMANS]
  if (!task || task.done || task.allExplored === true) return
  for (const g of ctx.galaxies.keys()) {
    if (!state.exploredGalaxies.includes(g)) return
  }
  task.allExplored = true
  addLog(
    state,
    'info',
    '◆ 寻找人类：全部星系的深空扫描已完成——没有人类信号，只有更多残骸与沉默。也许线索不在这片星域，也许它藏得更深。',
  )
}
