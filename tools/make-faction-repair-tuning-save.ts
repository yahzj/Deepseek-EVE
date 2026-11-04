/** 插件调整与修理机生产验收：node --import tsx tools/make-faction-repair-tuning-save.ts；独立合成，不读个人档。 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { injectFactionShipPlugFixture } from './faction-ship-plug-fixture'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { adjustDroneLoad, cpuOverloadText } from '../packages/core/src/equipment'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { notePreparationSquad } from '../packages/core/src/preparationSquads'
import { createPlayerSpec } from '../packages/core/src/combat/player/create'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'

const ctx = buildSimContext()
const state = createInitialState({ nowWallMs: Date.now(), seed: 20261102 })
injectFactionShipPlugFixture(state)
state.character.name = '插件与修理机生产验收'
state.standingsEarned = { ...state.standingsEarned, dsi: 100 }
for (const id of ['fleet-command-basic', 'fleet-command-coordination', 'fleet-command-integration']) {
  state.skills.trained[id] = 5
  state.skills.licenses[id] = true
}
const logi = addShipToFleet(state, 'sh-wh-g-destroyer')
state.warehouse.items['drone-repair-mil'] = 100
state.warehouse.items['repairkit-mil'] = 1000
assert(adjustDroneLoad(state, ctx, 'drone-repair-mil', 2, logi).ok)
assert(notePreparationSquad(state, 'combat', [state.shipId, logi]))
assert(commandBudgetOf(state, ctx, [state.shipId, logi]).ok)
for (const id of ['bp-once-drone-repair-mil', 'bp-drone-repair-mil']) {
  state.blueprintStock[id] = 2
  for (const mat of ctx.blueprints.get(id)!.materials) {
    state.warehouse.items[mat.itemId] = Math.max(state.warehouse.items[mat.itemId] ?? 0, mat.count * 5)
  }
}
const validate = (text: string) => {
  const read = loadSaveFile(text).state
  assert.deepEqual(read.blueprintStock, state.blueprintStock)
  assert.deepEqual(JSON.parse(JSON.stringify(read.fleet)), JSON.parse(JSON.stringify(state.fleet)))
  assert.deepEqual(read.warehouse, state.warehouse)
  assert.equal(read.expedition.active, false)
  assert.equal(read.manufacturingRuns.length, 0)
  assert.equal(read.departure, undefined)
  assert.equal(read.awayGalaxy, null)
  assert.equal(read.debugQuick, false)
  for (const id of Object.keys(read.fleet)) assert.equal(cpuOverloadText(read, ctx, id), null)
  const coating = createPlayerSpec(read, ctx, read.shipId)!
  assert(coating.hp.s > 0)
  return read
}
const text = serializeSaveFile(state)
validate(serializeSaveFile(validate(text)))
const directory = resolve('docs/test-saves')
mkdirSync(directory, { recursive: true })
const target = resolve(directory, 'test-save-faction-repair-tuning-20261102.json')
writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' })
validate(readFileSync(target, 'utf8'))
console.log(JSON.stringify({ target, logi, mainShip: state.shipId, blueprintStock: state.blueprintStock,
  idleAtHome: true, personalSaveRead: false }, null, 2))
