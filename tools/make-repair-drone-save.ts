/** 独立合成后勤与修理无人机测试档；不读个人档，不代出战。 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext, COMMS_MESSAGES } from '@whale/data'
import { sustainFixture, DEFENSIVE_MIX_PROFILE } from './enemy-formation-sustain'
import { adjustDroneLoad, cpuOverloadText } from '../packages/core/src/equipment'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { createPlayerSpec } from '../packages/core/src/combat/player/create'
import { FIRST_TASKS } from '../packages/core/src/firstTasks'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'

export function repairDroneFixture() {
  const ctx = buildSimContext()
  const { state, roster } = sustainFixture(ctx, DEFENSIVE_MIX_PROFILE, 20261101)
  const logi = roster.find(id => state.fleet[id]!.defId === 'sh-wh-g-destroyer')!
  state.savedAtWallMs = Date.now()
  state.character.startedAtWallMs = state.savedAtWallMs
  state.warehouse.items['drone-repair-mil'] = 100
  for (const [id, count] of Object.entries(state.fleet[logi]!.droneLoad ?? {})) assert(adjustDroneLoad(state, ctx, id, -count, logi).ok)
  assert(adjustDroneLoad(state, ctx, 'drone-repair-mil', 2, logi).ok)
  assert(!adjustDroneLoad(state, ctx, 'drone-repair-mil', 1, logi).ok)
  for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  state.commsDelivered = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, 0]))
  state.commsRead = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, true]))
  state.commsPopups = []
  for (const id of roster) assert.equal(cpuOverloadText(state, ctx, id), null)
  const spec = createPlayerSpec(state, ctx, logi)!
  assert.equal(spec.repairOutputBonusPct, .5)
  assert.equal(spec.weapons.filter(w => w.repairDrone).length, 2)
  assert.equal(spec.weapons.find(w => w.repairDrone)!.repairDrone!.armor, 23)
  assert(commandBudgetOf(state, ctx, roster).ok)
  return { state, ctx, roster, logi }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/make-repair-drone-save.ts')) {
  const { state, ctx, roster, logi } = repairDroneFixture()
  const text = serializeSaveFile(state)
  function validate(content: string) {
    const read = loadSaveFile(content).state
    assert.deepEqual(JSON.parse(JSON.stringify(read.fleet)), JSON.parse(JSON.stringify(state.fleet)))
    assert.deepEqual(read.preparationSquads, state.preparationSquads)
    assert.deepEqual(read.warehouse, state.warehouse)
    assert.equal(read.awayGalaxy, null)
    assert.equal(read.debugQuick, false)
    assert.equal(read.expedition.active, false)
    assert.equal(read.encounter.active, false)
    assert.equal(read.hauling.active, false)
    assert.equal(read.wormhole.run, null)
    for (const id of roster) assert.equal(cpuOverloadText(read, ctx, id), null)
    return read
  }
  const first = validate(text)
  validate(serializeSaveFile(first))
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const p = (type: string) => parts.find(row => row.type === type)!.value
  const stamp = `${p('year')}${p('month')}${p('day')}-${p('hour')}${p('minute')}${p('second')}`
  mkdirSync(resolve('docs/test-saves'), { recursive: true })
  const target = resolve(`docs/test-saves/test-save-repair-drone-${stamp}.json`)
  writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' })
  validate(readFileSync(target, 'utf8'))
  console.log(JSON.stringify({ target, logi, roster, budget: commandBudgetOf(first, ctx, roster), drones: first.fleet[logi]!.droneLoad, idleAtHome: true, personalSaveUntouched: true }, null, 2))
}
