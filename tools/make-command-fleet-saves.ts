/** 指挥编队门槛档生成器：npx tsx tools/make-command-fleet-saves.ts。
 * 独立合成当前版本，通过正式装配/保存/读取入口；不读取或覆盖个人档。
 * 输出docs/test-saves/test-save-command-fleet-{locked,unlocked,twelve}-20261030.json。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState, addLog } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { adjustDroneLoad, fitModule } from '../packages/core/src/equipment'
import { notePreparationSquad } from '../packages/core/src/preparationSquads'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'

const ctx = buildSimContext()
const out = resolve('docs/test-saves')
mkdirSync(out, { recursive: true })
for (const scenario of ['locked', 'unlocked', 'twelve'] as const) {
  const state = createInitialState({ nowWallMs: Date.now(), seed: 20261030 })
  state.fleet = {}
  state.modeChosen = true
  state.onboarding = { ...state.onboarding, step: 99 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.importantTasks['first-bounty'] = { done: true, delivered: 0 }
  state.wallet.isk = 100_000_000
  state.standingsEarned = { dsi: scenario === 'locked' ? 19 : 20 }
  state.standings.dsi = state.standingsEarned.dsi!
  for (const id of ctx.skills.keys()) state.skills.trained[id] = 5
  if (scenario !== 'twelve') {
    for (const id of ['fleet-command-basic', 'fleet-command-coordination', 'fleet-command-integration']) delete state.skills.trained[id]
  }
  const ships = Array.from({ length: 13 }, () => addShipToFleet(state, 'sh-shrike'))
  state.shipId = ships[0]!
  state.warehouse.items = { 'ammo-kinetic-l': 100000, 'drone-scout': 500 }
  for (const uid of ships) {
    for (const moduleId of ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-prop-2']) {
      state.moduleBay[moduleId] = (state.moduleBay[moduleId] ?? 0) + 1
      const result = fitModule(state, moduleId, ctx, { shipId: uid })
      assert(result.ok, JSON.stringify(result))
    }
    assert(adjustDroneLoad(state, ctx, 'drone-scout', 1, uid).ok)
  }
  const roster = ships.slice(0, scenario === 'twelve' ? 12 : 1)
  notePreparationSquad(state, 'combat', roster)
  assert(commandBudgetOf(state, ctx, roster).ok)
  if (scenario === 'locked') assert(!commandBudgetOf(state, ctx, ships.slice(0, 2)).ok)
  if (scenario === 'unlocked') assert(commandBudgetOf(state, ctx, ships.slice(0, 2)).ok)
  addLog(state, 'system', `编队验收门槛已注入：累计声望${state.standingsEarned.dsi}，指挥技能${scenario === 'twelve' ? '全满' : '未训练'}；13艘合法装配护卫舰，尚未代为出击。`)
  const text = serializeSaveFile(state)
  const loaded = loadSaveFile(text).state
  assert.deepEqual(loaded.preparationSquads?.combat, roster)
  const file = resolve(out, `test-save-command-fleet-${scenario}-20261030.json`)
  writeFileSync(file, text, 'utf8')
  console.log(file)
}
