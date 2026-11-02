/** 独立停港档：新版力场/阵列/修理机，禁止读取个人档。 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fleetSupportFixture } from './fleet-support-fixture'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
const { state, ctx, roster, logi } = fleetSupportFixture()
const text = serializeSaveFile(state)
const validate = (content: string) => {
  const read = loadSaveFile(content).state
  assert.deepEqual(JSON.parse(JSON.stringify(read.fleet)), JSON.parse(JSON.stringify(state.fleet)))
  assert.deepEqual(read.preparationSquads, state.preparationSquads)
  assert.equal(read.awayGalaxy, null)
  assert.equal(read.hauling.active, false)
  assert.equal(read.encounter.active, false)
  assert.equal(read.expedition.active, false)
  assert.equal(read.debugQuick, false)
  assert(commandBudgetOf(read, ctx, roster).ok)
  return read
}
validate(serializeSaveFile(validate(text)))
const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(Date.now())
const p = (key: string) => parts.find(row => row.type === key)!.value
const stamp = `${p('year')}${p('month')}${p('day')}-${p('hour')}${p('minute')}${p('second')}`
mkdirSync(resolve('docs/test-saves'), { recursive: true })
const target = resolve(`docs/test-saves/test-save-fleet-support-${stamp}.json`)
writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' })
validate(readFileSync(target, 'utf8'))
console.log(JSON.stringify({ target, logi, roster, budget: commandBudgetOf(state, ctx, roster), personalSaveUntouched: true, idleAtHome: true }, null, 2))
