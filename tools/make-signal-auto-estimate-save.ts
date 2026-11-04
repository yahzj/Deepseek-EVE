/** 独立停港门槛档，禁止读取个人档；正式装配及两轮读档。 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { signalAutoFixture } from './signal-auto-estimate-fixture'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
const { state, roster, budget } = signalAutoFixture('mixed', true)
const validate = (text: string) => {
  const read = loadSaveFile(text).state
  assert.deepEqual(JSON.parse(JSON.stringify(read.fleet)), JSON.parse(JSON.stringify(state.fleet)))
  assert.deepEqual(read.wormholeStock, state.wormholeStock)
  assert.equal(read.wormholeAuto?.length ?? 0, 0)
  assert.equal(read.wormhole.run, null)
  assert.equal(read.debugQuick, false)
  return read
}
const text = serializeSaveFile(state)
validate(serializeSaveFile(validate(text)))
const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(Date.now())
const part = (key: string) => parts.find(row => row.type === key)!.value
const stamp = `${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}${part('second')}`
mkdirSync(resolve('docs/test-saves'), { recursive: true })
const target = resolve(`docs/test-saves/test-save-signal-auto-estimate-${stamp}.json`)
writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' })
validate(readFileSync(target, 'utf8'))
console.log(JSON.stringify({ target, roster, budget, personalSaveUntouched: true, idleAtHome: true }, null, 2))
