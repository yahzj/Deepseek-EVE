/** 探针（用完即删）：离线窗口里多出来的那条日志到底是什么。 */
import { createInitialState } from '../../packages/core/src/state'
import { simulateOffline } from '../../packages/core/src/simulation'
import { FIRST_TASKS, TASK_FIND_HUMANS } from '../../packages/core/src/firstTasks'
import { makeTestCtx } from '../../packages/core/tests/helpers'

const state = createInitialState({ nowWallMs: 1_000, seed: 1 })
const ctx = makeTestCtx()
for (const def of FIRST_TASKS) state.importantTasks[def.id] = { done: true }
state.importantTasks[TASK_FIND_HUMANS] = { done: false }
const before = state.logs.length
simulateOffline(state, 1_000, 1_000 + 600_000, ctx)
console.log('新增日志（共', state.logs.length - before, '条）：')
for (const l of state.logs.slice(before)) console.log(`  [${l.kind}] ${l.textId ?? '(无 id)'} :: ${l.text}`)
