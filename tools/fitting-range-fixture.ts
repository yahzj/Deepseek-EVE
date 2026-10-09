/** 装配靶场合成档，无个人档输入。
 * 用法：靶场原生冒烟复用；npx tsx tools/fitting-range-fixture.ts <输出绝对路径>生成独立验收档。
 * 输出：可从存档管理导入的v31档；游戏v0.1.0，2026-10-09核对。
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { addShipToFleet, applyWeekendCompensation, createInitialState, FIRST_TASKS, fitModule, repairDeprecatedModules, serializeSaveFile } from '@whale/core'
import { buildSimContext } from '@whale/data'

export function fittingRangeFixture(now = Date.now()) {
  const ctx = buildSimContext(), state = createInitialState({ nowWallMs: now, seed: 20261009 })
  state.modeChosen = true
  state.character.name = '靶场验收'
  state.standingClawbackDone = true
  state.wallet.isk = 1e7
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  const uid = addShipToFleet(state, 'sh-wh-e-carrier')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  for (const id of ['mod-laser-3', 'mod-alien-acid-launcher', 'mod-drone-launch-3', 'mod-alien-pressure-chamber']) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    const fitted = fitModule(state, id, ctx)
    assert(fitted.ok, fitted.error)
  }
  state.fleet[uid]!.droneLoad = { 'drone-jawclaw': 3 }
  for (const id of ctx.commsMessages.keys()) { state.commsDelivered![id] = 0; state.commsRead![id] = true }
  state.commsPopups = []
  repairDeprecatedModules(state, ctx)
  applyWeekendCompensation(state, now)
  return serializeSaveFile(state, now)
}
if (process.argv[1]?.endsWith('fitting-range-fixture.ts')) {
  const output = process.argv[2]
  assert(output && isAbsolute(output), '请指定独立输出文件的绝对路径，不允许覆盖个人save.json')
  assert(!output.toLowerCase().endsWith('save.json'), '不允许覆盖个人save.json')
  writeFileSync(output, fittingRangeFixture(), { encoding: 'utf8', flag: 'wx' })
  console.log(output)
}
