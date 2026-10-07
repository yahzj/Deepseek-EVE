/** 星球闭门长期读数：npx tsx tools/planetary-balance-check.ts；不写档，无个人数据。 */
import { createInitialState, advancePlanetary, allocatePlanetPower, wakePlanetPopulation, planetColonyView, planetEnvironmentOf, startPlanetBuild } from '@whale/core'
import { buildPlanetCatalog } from '@whale/data'
import { injectPlanetaryRuntimeTestState } from './planetary-runtime-fixture'

const catalog = buildPlanetCatalog()
const state = createInitialState({ seed: 7, nowWallMs: 0 })
injectPlanetaryRuntimeTestState(state)
for (const p of Object.values(state.planetary!.planets)) {
  p.colony!.sleeping = 1
  allocatePlanetPower(p, catalog)
  if (!wakePlanetPopulation(p, catalog, 1).ok) throw new Error('单人口基础保障不成立')
  const index = p.cells.findIndex(c => !c.obstacle && !c.building)
  startPlanetBuild(p, catalog, index, 'maintenance')
}
const beforeWallet = state.wallet.isk
const beforeRng = { ...state.rng }
advancePlanetary(state, 24 * 3600000, catalog)
for (const p of Object.values(state.planetary!.planets)) {
  const c = p.colony!, env = planetEnvironmentOf(p, catalog)!
  if (c.awake + c.sleeping !== 1) throw new Error('长期人口不守恒')
  console.log(JSON.stringify({ planet: p.id, environment: env, supplies: c.supplies, crisis: c.crisis,
    awake: c.awake, sleeping: c.sleeping, view: planetColonyView(p, catalog) }))
}
if (state.wallet.isk !== beforeWallet || JSON.stringify(state.rng) !== JSON.stringify(beforeRng)) throw new Error('星球修改外部经济或全局随机流')
console.log('24小时星球演算：人口守恒、材料非负、普通经济与随机流隔离通过；不是正式开放收益配平。')
