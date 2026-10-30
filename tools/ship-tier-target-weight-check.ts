/** 舰级选靶权重读数与独立合成验收档，不读取个人档。
 * npx tsx tools/ship-tier-target-weight-check.ts [--save] [--out=目录]
 * 默认写tools/_ui-artifacts/ship-tier-target-weight-20261030；四舰准备就绪但不代开战。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState, addLog } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { fitModule } from '../packages/core/src/equipment'
import { advanceBattleFor, createBattleState, createPlayerSpec } from '../packages/core/src/combat'
import { pickMyUnitTarget, playerTargetWeightOf } from '../packages/core/src/combat/targeting'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
import { weekendFlagshipPrepView, weekendStartFlagshipBattle } from '../packages/core/src/weekendLaunch'

const ctx = buildSimContext()
const now = Date.now()
const out = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'tools/_ui-artifacts/ship-tier-target-weight-20261030')
const state = createInitialState({ nowWallMs: now, seed: 10830 })
state.fleet = {}
state.wallet.isk = 100_000_000
state.standings.dsi = 100
state.standingsEarned = { dsi: 100 }
state.exploredGalaxies = [...ctx.galaxies.keys()]
state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, 3]))
state.importantTasks['first-bounty'] = { done: true, delivered: 0 }
state.resupplyFromWarehouse = true
for (const id of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l', 'repairkit-mil']) state.warehouse.items[id] = 100_000

const ships = ['sh-shrike', 'sh-mako', 'sh-hammerhead', 'sh-xuanwu'].map(defId => addShipToFleet(state, defId))
state.shipId = ships[0]!
for (const uid of ships) {
  const def = ctx.ships.get(state.fleet[uid]!.defId!)!
  for (const mod of ['mod-prop-2', 'mod-shield-pla-2', 'mod-armor-plate-2', ...Array(def.slots!.high).fill('mod-turret-kin-2')]) {
    state.moduleBay[mod] = (state.moduleBay[mod] ?? 0) + 1
    const result = fitModule(state, mod, ctx, { shipId: uid })
    assert(result.ok, `${uid}/${mod}: ${JSON.stringify(result)}`)
  }
}
state.moduleBay['plug-target-beacon'] = 8
state.moduleBay['plug-concealment'] = 8
state.weekendPrepSquad = ships
const coreId = 'galaxy-maw'
state.weekendEvent = { seq: 903, family: 'D', coreId, peripheryIds: ['galaxy-cinder'],
  startedAtWallMs: now, contributed: { [coreId]: 1, 'galaxy-cinder': 1 } }
addLog(state, 'system', '选靶权重合成验收：四舰和补给准备完毕，未代开战，未读取个人档。')
assert(weekendFlagshipPrepView(state, ctx, now), '合成档旗舰准备入口不可用')

const specs = ships.map((uid, index) => ({ ...createPlayerSpec(state, ctx, uid)!, tag: index === 0 ? 'player' : `ally-${index}` }))
const battle = createBattleState(specs[0]!, [], 0, 1000, specs.slice(1))
const draws = 12000
const counts = Object.fromEntries(specs.map(spec => [spec.tag, 0]))
for (let index = 0; index < draws; index++) counts[pickMyUnitTarget(state, battle, specs)!.tag]!++
const totalWeight = specs.reduce((sum, spec) => sum + playerTargetWeightOf(spec), 0)
const readings = specs.map(spec => ({ name: spec.name, shipTier: spec.shipTier,
  weight: playerTargetWeightOf(spec), expected: playerTargetWeightOf(spec) / totalWeight,
  observed: counts[spec.tag]! / draws, selected: counts[spec.tag] }))
for (const row of readings) assert(Math.abs(row.observed - row.expected) < 0.02)
state.rng = { seed: 10830, count: 0 }
const text = serializeSaveFile(state, now)
const back = loadSaveFile(text).state
assert.deepEqual(ships.map(uid => playerTargetWeightOf(createPlayerSpec(back, ctx, uid)!)), [1, 2, 3, 4])
assert(weekendFlagshipPrepView(back, ctx, now))
assert.equal(back.encounter.battle, null)
const smoke = structuredClone(back)
const opened = weekendStartFlagshipBattle(smoke, ctx, now, ships)
assert(opened, '合成档不能通过正式旗舰入口开战')
assert.equal(opened.myFleet?.length, ships.length)
smoke.gameMs = 1000
advanceBattleFor(smoke, ctx, opened, smoke.shipId, 'gravekeeper-flagship')
assert(opened.lastTickGameMs > opened.startedAtGameMs, '正式旗舰战未推进')
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'report.json'), JSON.stringify({ ok: true, syntheticOnly: true, draws, readings,
  saveRoundtrip: true, flagshipOpenedAndAdvanced: true }, null, 2), 'utf8')
if (process.argv.includes('--save')) {
  const path = resolve(out, 'test-save-ship-tier-target-weight-20261030.json')
  writeFileSync(path, text, 'utf8')
  console.log(JSON.stringify({ save: path, ships, unopened: true }))
}
console.log(JSON.stringify({ ok: true, draws, readings, out }))
