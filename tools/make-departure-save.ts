/** 独立合成离港阶段验收档；node --import tsx tools/make-departure-save.ts，不读个人档。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COMMS_MESSAGES, buildSimContext } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { injectCommandFleetAllShipsFixture } from './command-fleet-all-ships-fixture'
import { notePreparationSquad } from '../packages/core/src/preparationSquads'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
import { fitModule } from '../packages/core/src/equipment'

const ctx = buildSimContext()
const state = createInitialState({ nowWallMs: Date.now(), seed: 20261102 })
injectCommandFleetAllShipsFixture(state)
state.character.name = '离港流程验收'
state.shipId = 'sandcat'
assert(state.fleet[state.shipId])
assert(notePreparationSquad(state, 'combat', [state.shipId]))
assert(fitModule(state, 'mod-salvager-1', ctx, { shipId: state.shipId }).ok)
for (const item of ctx.items.values()) if (item.kind === 'mineral') state.warehouse.items[item.id] = 100000
const built = [...ctx.stations.values()][0]!
state.stationSites[built.id] = { stage: built.tiers.length, delivered: {} }
state.wormholeStock = [{ id: 'departure-entry', seed: 19, depth: 1, family: 'A', archetype: 'balanced', foundAtGameMs: 0, expeditionRules: 2 }]
state.commsDelivered = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, 0]))
state.commsRead = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, true]))
state.commsPopups = []
const text = serializeSaveFile(state)
const loaded = loadSaveFile(text).state
assert.equal(loaded.departure, undefined)
assert.equal(loaded.mining.active, false)
assert.equal(loaded.expedition.active, false)
assert.equal(loaded.dockedSite, null)
const directory = resolve('docs/test-saves')
mkdirSync(directory, { recursive: true })
const target = resolve(directory, 'test-save-departure-20261102.json')
writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' })
console.log(JSON.stringify({ target, mainShip: state.shipId, builtStation: built.id, personalSaveRead: false, departed: false }, null, 2))
