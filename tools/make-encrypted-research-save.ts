/** 独立合成研究所首捞与五族开箱验收；node --import tsx tools/make-encrypted-research-save.ts。不读个人档。 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext, COMMS_MESSAGES } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { fitModule, cpuOverloadText } from '../packages/core/src/equipment'
import { wormholeEnter } from '../packages/core/src/wormhole'
import { wormholeMakeGrid } from '../packages/core/src/wormholeGrid'
import { wormholeResearchBox, wormholeEnsureSalvagePiles } from '../packages/core/src/wormholeSalvage'
import { ENCRYPTED_FAMILIES } from '../packages/core/src/encryptedContainer'
import { advanceGame } from '../packages/core/src/engine'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'

const ctx = buildSimContext()
const state = createInitialState({ nowWallMs: Date.now(), seed: 20261103 })
state.modeChosen = true
state.onboarding.step = 99
state.character.name = '研究所首捞验收'
state.wallet.isk = 100_000_000
state.shipId = addShipToFleet(state, 'sh-manatee')
state.moduleBay['mod-salvager-1'] = 1
assert(fitModule(state, 'mod-salvager-1', ctx).ok)
assert.equal(cpuOverloadText(state, ctx, state.shipId), null)
let seed = 0
for (let n = 1; n <= 10000; n++) {
  if (wormholeMakeGrid(n, 8).cells.some(cell => cell.researchLab)) { seed = n; break }
}
assert(seed > 0)
assert(wormholeEnter(state, ctx, [state.shipId], seed, { family: 'A' }).ok)
advanceGame(state, 10000, ctx)
const run = state.wormhole.run!
run.depth = 8
run.grid = wormholeMakeGrid(seed, 8)
const cell = run.grid.cells.find(row => row.researchLab)!
run.grid.pos = { q: cell.q, r: cell.r }
run.grid.visited.push(cell.key)
run.grid.scanned.push(cell.key)
// 只注入深层地点与合法存活条件，不执行首次打捞或拆解。
wormholeEnsureSalvagePiles(state, cell)
for (const family of ENCRYPTED_FAMILIES) state.warehouse.items[`box-encrypted-${family.toLowerCase()}`] = 3
state.commsDelivered = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, 0]))
state.commsRead = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, true]))
state.commsPopups = []
const text = serializeSaveFile(state)
function validate(content: string) {
  const loaded = loadSaveFile(content).state
  const actual = loaded.wormhole.run!.grid!.cells.find(row => row.researchLab)!
  assert(actual)
  assert.equal(loaded.wormhole.run!.depth, 8)
  assert(!(loaded.wormhole.run!.grid!.ruinsRolled ?? []).includes(actual.key))
  assert.deepEqual(loaded.warehouse, state.warehouse)
  assert.equal(loaded.refineRuns.length, 0)
  assert.equal(loaded.departure, undefined)
  assert.equal(loaded.debugQuick, false)
  assert.deepEqual(actual.piles, cell.piles)
  return loaded
}
validate(serializeSaveFile(validate(text)))
const directory = resolve('docs/test-saves')
mkdirSync(directory, { recursive: true })
const path = resolve(directory, 'test-save-encrypted-research-20261103.json')
writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' })
validate(readFileSync(path, 'utf8'))
console.log(JSON.stringify({ path, seed, depth: 8, researchKey: cell.key,
  firstPullNotExecuted: true, expectedFirstBox: wormholeResearchBox(state, ctx, cell), personalSaveRead: false }, null, 2))
