/** 逐炮齐射合成战斗档，不读个人档。用法由per-gun-browser-check与验收生成器调用。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-05 · 最后跑过2026-10-05。
 */
import assert from 'node:assert/strict'
import { addShipToFleet, advanceGame, createInitialState, FIRST_TASKS, fitModule, serializeSaveFile, startExpedition } from '@whale/core'
import { buildSimContext } from '@whale/data'

export function perGunTestSave(now = Date.now()) {
  const ctx = buildSimContext(), state = createInitialState({ nowWallMs: now, seed: 105105 })
  state.modeChosen = true
  state.character.name = '逐炮验收'
  state.standingClawbackDone = true
  state.standingsEarned = { dsi: 200 }
  state.wallet.isk = 1e10
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  const uid = addShipToFleet(state, 'sh-dunkleosteus')
  state.shipId = uid
  for (const id of ctx.skills.keys()) state.skills.trained[id] = 3
  state.moduleBay['mod-turret-kin-1'] = 6
  for (let i = 0; i < 6; i++) assert(fitModule(state, 'mod-turret-kin-1', ctx).ok)
  state.warehouse.items['ammo-kinetic-l'] = 100000
  advanceGame(state, 1, ctx, { nowWallMs: now })
  const result = startExpedition(state, 'ink-harass', ctx)
  assert(result.ok, result.error)
  for (let i = 0; i < 5000 && state.expedition.phase !== 'battle'; i++) advanceGame(state, 1000, ctx, { nowWallMs: now })
  assert.equal(state.expedition.phase, 'battle')
  assert(state.expedition.battle)
  for (const id of state.commsDelivered ? Object.keys(state.commsDelivered) : []) state.commsRead![id] = true
  for (const id of ctx.commsMessages.keys()) { state.commsDelivered![id] = 0; state.commsRead![id] = true }
  state.commsPopups = []
  return serializeSaveFile(state, now)
}
