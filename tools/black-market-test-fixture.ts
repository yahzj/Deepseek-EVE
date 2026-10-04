/** 黑市全新合成档夹具，供生成器与浏览器回归共同读取。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-04 · 最后跑过2026-10-04。
 */
import { createInitialState, ensureBlackMarket, FIRST_TASKS, serializeSaveFile, advanceGame } from '@whale/core'
import { buildSimContext } from '@whale/data'

/** 从全新初始档生成，只补黑市门槛；不读取个人档。 */
export function blackMarketTestSave(now = Date.now(), standing = 100): string {
  const ctx = buildSimContext()
  const state = createInitialState({ nowWallMs: now, seed: 10403 })
  state.modeChosen = true
  state.character.name = '黑市验收'
  state.wallet.isk = 1000000000000
  state.standingsEarned = { dsi: standing }
  state.standings.dsi = 0
  state.standingClawbackDone = true
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  advanceGame(state, 1, ctx, { nowWallMs: now })
  for (const id of ctx.commsMessages.keys()) {
    state.commsDelivered![id] = 0
    state.commsRead![id] = true
  }
  for (const id of Object.keys(state.commsDelivered ?? {})) state.commsRead![id] = true
  state.commsPopups = []
  ensureBlackMarket(state, ctx, now)
  return serializeSaveFile(state, now)
}
