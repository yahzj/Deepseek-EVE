/**
 * 满技能全舰船编队档：npx tsx tools/make-command-fleet-all-ships-save.ts。
 * 无个人档输入；输出docs/test-saves/test-save-command-fleet-all-ships-<时间>.json。
 * 正式装配、序列化、读档后复核，已有同名文件拒绝覆盖。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInitialState } from '../packages/core/src/state'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
import { injectCommandFleetAllShipsFixture, assertCommandFleetAllShipsFixture } from './command-fleet-all-ships-fixture'

console.log('开始从初始状态合成满技能全舰船编队档；不读取或覆盖个人档。')
const now = new Date()
const state = createInitialState({ nowWallMs: now.getTime(), seed: 20261031 })
const notes = injectCommandFleetAllShipsFixture(state)
const text = serializeSaveFile(state, now.getTime())
const back = loadSaveFile(text).state
assertCommandFleetAllShipsFixture(back)
assert.deepEqual(JSON.parse(JSON.stringify(back.fleet)), JSON.parse(JSON.stringify(state.fleet)))
assert.deepEqual(back.skills.trained, state.skills.trained)
assert.deepEqual(back.preparationSquads, state.preparationSquads)
const twice = loadSaveFile(serializeSaveFile(back, now.getTime())).state
assert.deepEqual(twice.fleet, back.fleet)
assert.deepEqual(twice.preparationSquads, back.preparationSquads)
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
const out = resolve('docs/test-saves')
mkdirSync(out, { recursive: true })
const target = resolve(out, `test-save-command-fleet-all-ships-${stamp}.json`)
writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' })
console.log(`已生成并通过两次读档复核：${target}`)
for (const note of notes) console.log(note)
