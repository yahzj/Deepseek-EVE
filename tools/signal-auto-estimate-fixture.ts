/** 信号自动估算的合法合成舰队，不读取个人档。 */
import assert from 'node:assert/strict'
import { buildSimContext, COMMS_MESSAGES } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { fitModule, adjustDroneLoad, cpuOverloadText } from '../packages/core/src/equipment'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { wormholeAdmission } from '../packages/core/src/wormhole'
import { FIRST_TASKS } from '../packages/core/src/firstTasks'

export const SIGNAL_AUTO_PROFILES = ['guns', 'survey', 'mixed', 'unarmed'] as const
export type SignalAutoProfile = typeof SIGNAL_AUTO_PROFILES[number]
export function signalAutoFixture(profile: SignalAutoProfile = 'mixed', fullTech = false) {
  const ctx = buildSimContext(), state = createInitialState({ nowWallMs: Date.now(), seed: 20261102 })
  state.modeChosen = true
  state.onboarding.step = 99
  state.wallet.isk = 1e9
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, 5]))
  state.research!.levels = Object.fromEntries([...ctx.matterTech!.values()].map(node => [node.id, fullTech ? node.maxLevel : 0]))
  state.research!.levels['mt-explore-signal-auto-t3'] = 3
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  state.commsDelivered = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, 0]))
  state.commsRead = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, true]))
  state.commsPopups = []
  state.resupplyFromWarehouse = true
  for (const item of ctx.items.values()) if (item.kind === 'ammo' || item.id.startsWith('repairkit-') || item.kind === 'drone') state.warehouse.items[item.id] = 10000
  const defs = profile === 'guns' ? Array<string>(4).fill('sh-hammerhead') : profile === 'mixed'
    ? ['sh-hammerhead', 'sh-hammerhead', 'sh-nautilus', 'sh-wh-g-destroyer'] : Array<string>(4).fill('sh-nautilus')
  const roster = defs.map(defId => {
    const uid = addShipToFleet(state, defId)
    const high = defId === 'sh-hammerhead' ? ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-miner-2', 'mod-salvager-2']
      : defId === 'sh-wh-g-destroyer' ? ['mod-shieldfield-2', 'mod-lock-2', 'mod-miner-2', 'mod-salvager-2']
        : [profile === 'unarmed' ? 'mod-salvager-2' : 'mod-laser-2', 'mod-miner-2', 'mod-salvager-2']
    for (const id of [...high, 'mod-shield-ext-2', 'mod-hullrep-2', 'mod-cargo-2']) {
      state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
      const result = fitModule(state, id, ctx, { shipId: uid })
      assert(result.ok, `${profile}/${defId}/${id}:${result.error}`)
    }
    if (profile !== 'unarmed') assert(adjustDroneLoad(state, ctx, defId === 'sh-wh-g-destroyer' ? 'drone-repair-mil' : 'drone-scout', 2, uid).ok)
    assert.equal(cpuOverloadText(state, ctx, uid), null)
    return uid
  })
  const budget = commandBudgetOf(state, ctx, roster, true), admission = wormholeAdmission(ctx, roster)
  assert(budget.ok); assert(admission.ok)
  state.wormholeStock = Array.from({ length: 10 }, (_, i) => ({ id: `estimate-signal-${i}`, seed: 19 + i, depth: 1,
    family: (['A', 'C', 'D', 'E', 'G'] as const)[i % 5]!, archetype: 'balanced' as const, foundAtGameMs: 0 }))
  return { state, ctx, roster, budget, admission }
}
