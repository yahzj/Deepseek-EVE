/** debug synth battle null（用完即删） */
import { addShipToFleet, createInitialState, repairDeprecatedModules, type SimContext } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { createPlayerSpec, startBattleFor } from '../packages/core/src/combat'

const ctx = buildSimContext()
const state = createInitialState({ nowWallMs: 0, seed: 1 })
state.wallet.isk = 2e8
addShipToFleet(state, 'sh-tigershark')
state.shipId = 'sh-tigershark'
const e = state.fleet[state.shipId]!
e.fitted = { high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-laser-2', 'mod-missile-2'], mid: [], low: [] }
repairDeprecatedModules(state, ctx as SimContext)
console.log('spec:', createPlayerSpec(state, ctx as SimContext, 'sh-tigershark') ? 'ok' : 'null')
console.log('anomalies 有 hub 吗:', !!ctx.anomalies.get('galaxy-hub') ? 'key err' : 'n/a', ctx.anomalies.size)
