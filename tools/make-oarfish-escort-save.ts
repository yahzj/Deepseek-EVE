/** 皇带鱼五舰护航合成档；只读取定义与初始状态，不读取个人档、不代出发。 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext, COMMS_MESSAGES } from '@whale/data'
import { sustainFixture } from './enemy-formation-sustain'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { installPlug } from '../packages/core/src/plugs'
import { fitModule, cpuOverloadText } from '../packages/core/src/equipment'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { notePreparationSquad } from '../packages/core/src/preparationSquads'
import { cargoCapacityM3Of } from '../packages/core/src/inventory'
import { FIRST_TASKS } from '../packages/core/src/firstTasks'
import { haulFleetLoadOf } from '../packages/core/src/hauling/load'
import { startHauling } from '../packages/core/src/hauling'
import { spawnIndustrialEncounter } from '../packages/core/src/encounters/industrial'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'

const ctx = buildSimContext()
const cargoM3 = 1_527_660
const { state, roster: escorts } = sustainFixture(ctx, {
  id: 'two-gun-mixed', name: '皇带鱼＋2锤头鲨＋后勤＋电子',
  fleet: ['sh-hammerhead', 'sh-hammerhead', 'sh-wh-g-destroyer', 'sh-wh-d-frigate'],
  defensiveSupport: true, rangeEwModules: 1,
}, 20261101)
const now = Date.now()
state.savedAtWallMs = now
state.character.startedAtWallMs = now
const emperor = addShipToFleet(state, 'sh-colossal')
state.shipId = emperor
for (const mod of ctx.modules.values()) state.moduleBay[mod.id] = 100
for (const item of ctx.items.values()) {
  if (item.kind === 'ammo' || item.id.startsWith('repairkit-')) state.warehouse.items[item.id] = 1_000_000
}
assert(installPlug(state, ctx, 'plug-low-bay', emperor).ok)
for (const id of [...Array<string>(4).fill('mod-cargo-proto'), 'mod-turret-civ', 'mod-turret-civ',
  'mod-hullrep-1', 'mod-shield-ext-1', 'mod-shield-ext-1']) {
  assert(fitModule(state, id, ctx, { shipId: emperor }).ok, id)
}
const roster = [emperor, ...escorts]
assert(notePreparationSquad(state, 'combat', roster))
for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
state.commsDelivered = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, 0]))
state.commsRead = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, true]))
state.commsPopups = []

function validate(candidate: typeof state) {
  assert.equal(candidate.shipId, emperor)
  assert.deepEqual(candidate.preparationSquads, state.preparationSquads)
  assert.deepEqual(JSON.parse(JSON.stringify(candidate.fleet)), JSON.parse(JSON.stringify(state.fleet)))
  assert.deepEqual(candidate.skills.trained, state.skills.trained)
  assert.deepEqual(candidate.warehouse, state.warehouse)
  assert.equal(Object.keys(candidate.fleet).length, 5)
  const budget = commandBudgetOf(candidate, ctx, roster)
  assert(budget.ok)
  assert.equal(budget.cost, 110)
  assert.equal(budget.capacity, 125)
  for (const id of roster) assert.equal(cpuOverloadText(candidate, ctx, id), null)
  assert.equal(cargoCapacityM3Of(candidate, ctx, emperor), cargoM3)
  assert.equal(candidate.awayGalaxy, null)
  assert.equal(candidate.dockedSite, null)
  assert.equal(candidate.debugQuick, false)
  for (const job of [candidate.hauling, candidate.mining, candidate.transit, candidate.expedition,
    candidate.encounter, candidate.standby, candidate.salvaging]) assert.equal(job.active, false)
  assert.equal(candidate.wormhole.run, null)
  assert.deepEqual(candidate.aiAssignments, {})
  assert.deepEqual(candidate.shipReturns, {})
  return { budget, load: haulFleetLoadOf(candidate, ctx, roster, cargoM3) }
}

validate(state)
const text = serializeSaveFile(state, now)
const loaded = loadSaveFile(text).state
const { budget, load } = validate(loaded)
validate(loadSaveFile(serializeSaveFile(loaded, now)).state)
// 只在副本验证正式运输与遇袭入口，交付档仍停港、未开始作业。
const probe = loadSaveFile(text).state
assert(startHauling(probe, null, 'site-cinder', ctx, cargoM3).ok)
assert.equal(probe.hauling.fleetLeg!.loadedM3, cargoM3)
assert(spawnIndustrialEncounter(probe, ctx, { galaxyId: 'galaxy-cinder', shipId: emperor, kind: '停留' }))
assert.equal(probe.encounter.pirate!.targetThreat, 196)
assert.equal(probe.encounter.pirate!.card.waves!.length, 3)

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(now)
const part = (type: string) => parts.find(row => row.type === type)!.value
const stamp = `${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}${part('second')}`
const directory = resolve('docs/test-saves')
mkdirSync(directory, { recursive: true })
const target = resolve(directory, `test-save-oarfish-escort-${stamp}.json`)
writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' })
validate(loadSaveFile(readFileSync(target, 'utf8')).state)
console.log(JSON.stringify({ target, roster: roster.map(id => ({ id, name: ctx.ships.get(state.fleet[id]!.defId!)!.name })),
  budget, emperorCapacityM3: cargoM3, fleetCapacityM3: load.capacityM3, suggestedCargoM3: cargoM3,
  targetThreat: probe.encounter.pirate!.targetThreat, waves: probe.encounter.pirate!.card.waves!.length,
  idleAtHome: true, untouchedPersonalSave: true, readBackValidated: true }, null, 2))
