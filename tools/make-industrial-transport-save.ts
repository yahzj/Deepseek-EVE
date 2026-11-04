/** 独立合成运输护航门槛档：npx tsx tools/make-industrial-transport-save.ts，不读取个人档。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext, COMMS_MESSAGES } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { injectCommandFleetAllShipsFixture } from './command-fleet-all-ships-fixture'
import { notePreparationSquad } from '../packages/core/src/preparationSquads'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
import { haulFleetLoadOf } from '../packages/core/src/hauling/load'

export function industrialTransportFixture() {
  const ctx = buildSimContext()
  const state = createInitialState({ nowWallMs: Date.now(), seed: 20261101 })
  injectCommandFleetAllShipsFixture(state)
  const ids = Object.keys(state.fleet)
  const select = (role: 'industrial' | 'hauler' | 'armed') => ids.find(id => ctx.ships.get(state.fleet[id]!.defId ?? id)?.role === role)!
  const roster = [...new Set([select('hauler'), select('industrial'), select('armed')])]
  state.shipId = roster[0]!
  notePreparationSquad(state, 'combat', roster)
  assert(commandBudgetOf(state, ctx, roster).ok)
  for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  state.commsDelivered = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, 0]))
  state.commsRead = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, true]))
  state.commsPopups = []
  const cap = haulFleetLoadOf(state, ctx, roster).capacityM3
  assert(cap > 0)
  return { state, ctx, roster, cap }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/make-industrial-transport-save.ts')) {
  const { state, roster, cap } = industrialTransportFixture()
  const text = serializeSaveFile(state)
  const loaded = loadSaveFile(text).state
  assert.deepEqual(loaded.preparationSquads, state.preparationSquads)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
  const directory = resolve('docs/test-saves')
  mkdirSync(directory, { recursive: true })
  const target = resolve(directory, `test-save-industrial-transport-${stamp}.json`)
  writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ target, roster, capacityM3: cap, untouchedPersonalSave: true }, null, 2))
}
