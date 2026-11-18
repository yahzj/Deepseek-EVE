import type { GameState } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { addLog, DEFAULT_PILOT_NAME } from './state'
import { sequentialPrefixDone, firstTasksMarkSeen } from './firstTasks'
import { grantStartRewardsForCurrent } from './firstRewards'

export const ONB_AWAKEN = 0
export const ONB_DONE = 99

export const TASK_FIND_HUMANS = 'find-humans'

export function publishFindHumans(state: GameState): void {
  if (state.importantTasks[TASK_FIND_HUMANS]) return
  state.importantTasks[TASK_FIND_HUMANS] = { done: false }
  addLog(state, 'info', '◆ 重要任务发布「寻找人类」：完成方法未知——立足已稳，该往更深处打听了。', 'core.onboarding.001')
}

export function publishFindHumansWhenReady(state: GameState): boolean {
  if (state.importantTasks[TASK_FIND_HUMANS]) return false
  if (state.onboarding.step !== ONB_DONE) return false
  if (!sequentialPrefixDone(state)) return false
  publishFindHumans(state)
  return true
}

function finishPrologue(state: GameState, ctx?: SimContext): void {
  if (state.onboarding.step !== ONB_DONE) state.onboarding.step = ONB_DONE
  firstTasksMarkSeen(state)
  if (ctx) grantStartRewardsForCurrent(state, ctx)
}

export function beginAfterAwaken(state: GameState, ctx?: SimContext): CommandResult {
  if (state.onboarding.step !== ONB_AWAKEN) {
    return { ok: false, error: '当前不在序章演出阶段。', errorId: 'core.onboarding.002' }
  }
  finishPrologue(state, ctx)
  addLog(state, 'info', '自检完成——信息库重启，第一份简报已落在导航「通讯」里。', 'core.onboarding.003')
  return { ok: true }
}

export function skipPrologue(state: GameState, ctx?: SimContext): CommandResult {
  if (state.onboarding.step !== ONB_AWAKEN) {
    return { ok: false, error: '序章演出已结束。', errorId: 'core.onboarding.004' }
  }
  if (state.character.name === DEFAULT_PILOT_NAME) state.character.name = 'PRTS'
  finishPrologue(state, ctx)
  addLog(state, 'info', '序章演出已跳过——开始新的航程。', 'core.onboarding.005')
  return { ok: true }
}

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
