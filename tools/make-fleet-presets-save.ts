/** node工具依赖由tsx加载；npx tsx tools/make-fleet-presets-save.ts。
 * 从全新状态生成两套不同主控/顺序的预设，不读个人档；独占创建输出，拒绝覆盖。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { addShipToFleet, COMMAND_SKILLS, loadSaveFile, saveFleetPreset, serializeSaveFile } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { blackMarketTestSave } from './black-market-test-fixture'

const now = Date.now()
const state = loadSaveFile(blackMarketTestSave(now)).state
const ctx = buildSimContext()
state.fleet = {}
const ids = Array.from({ length: 3 }, () => addShipToFleet(state, 'sh-shrike'))
state.onboarding.step = 99
for (const skill of COMMAND_SKILLS) state.skills.trained[skill.id] = 5
state.shipId = ids[0]!
state.preparationSquads = { combat: [ids[0]!, ids[2]!, ids[1]!] }
assert(saveFleetPreset(state, ctx, '三舰编队').ok)
state.shipId = ids[1]!
state.preparationSquads.combat = [ids[1]!, ids[0]!]
assert(saveFleetPreset(state, ctx, '双舰编队').ok)
const text = serializeSaveFile(state, now)
const first = loadSaveFile(text).state
const second = loadSaveFile(serializeSaveFile(first, now)).state
assert.deepEqual(first.fleetPresets, state.fleetPresets)
assert.deepEqual(second.fleetPresets, state.fleetPresets)
assert.deepEqual(second.preparationSquads, state.preparationSquads)
const stamp = new Date(now + 8 * 3_600_000).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const directory = resolve('docs/test-saves')
mkdirSync(directory, { recursive: true })
const file = resolve(directory, `test-save-fleet-presets-${stamp}.json`)
writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' })
console.log(file)
