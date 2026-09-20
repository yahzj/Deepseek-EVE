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
 * - 演出结束（或玩家跳过）⇒ `ONB_DONE`，并**发布贯穿任务「寻找人类」**；
 * - 「寻找人类」的阶段目标：全部星系探索完毕记一次里程碑（2026-09-10 船长定）。
 *
 * ⚠ 老档迁移（`save.ts`）：`step` 只认 0 与 99——老档的 -1（未开始）／0.5（简报）／1..8（七步中）
 * 一律读成 99（不再有步骤机；其「第一次」任务由一次性判定补记）。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { addLog, DEFAULT_PILOT_NAME } from './state'

/** 序章演出中（渲染层 `PrologueScreen` 推进；演出期间不做任何任务判定） */
export const ONB_AWAKEN = 0
/** 序章已完成（老档与经典开局一律按此读档） */
export const ONB_DONE = 99

/** 贯穿任务「寻找人类」：序章结束时发布，永久无法完成（船长 2026-09-05：正常发布，不告诉做法） */
export const TASK_FIND_HUMANS = 'find-humans'

/** 发布「寻找人类」（幂等）：序章结束时调用 */
export function publishFindHumans(state: GameState): void {
  if (state.importantTasks[TASK_FIND_HUMANS]) return
  state.importantTasks[TASK_FIND_HUMANS] = { done: false }
  addLog(state, 'info', '◆ 重要任务发布「寻找人类」：完成方法未知——先在这座城市活下去，再慢慢打听。', 'core.onboarding.001')
}

/** 序章收尾（幂等）：步骤落 99 ＋ 发布贯穿任务 */
function finishPrologue(state: GameState): void {
  if (state.onboarding.step !== ONB_DONE) state.onboarding.step = ONB_DONE
  publishFindHumans(state)
}

/**
 * 渲染层：序章演出完成（呼号落定）⇒ 序章结束（原先还要进"简报态"读教程，2026-09-17 起简报信
 * 直接躺进收件箱，不再锁页面）。
 */
export function beginAfterAwaken(state: GameState): CommandResult {
  if (state.onboarding.step !== ONB_AWAKEN) {
    return { ok: false, error: '当前不在序章演出阶段。', errorId: 'core.onboarding.002' }
  }
  finishPrologue(state)
  addLog(state, 'info', '自检完成——信息库重启，第一份简报已落在导航「通讯」里。', 'core.onboarding.003')
  return { ok: true }
}

/** 渲染层：跳过序章演出（未及起名 ⇒ 呼号落默认 PRTS）；与演完等价，不发放任何奖励 */
export function skipPrologue(state: GameState): CommandResult {
  if (state.onboarding.step !== ONB_AWAKEN) {
    return { ok: false, error: '序章演出已结束。', errorId: 'core.onboarding.004' }
  }
  if (state.character.name === DEFAULT_PILOT_NAME) state.character.name = 'PRTS'
  finishPrologue(state)
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
