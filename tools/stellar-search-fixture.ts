/** 星系与战损卡格验收门槛；新合成档，不读取个人存档。 */
import { addShipToFleet, advancePlanetary, advanceStellarSearch, beginStellarSearch, discoverPlanetHumans,
  preparePlanetBase, startPlanetBuild, surveyPlanet, type GameState } from '@whale/core'
import { buildPlanetCatalog, buildSimContext } from '@whale/data'
import { injectWreckFitTestState } from './wreck-fit-test-fixture'

export function injectStellarSearchTestState(state: GameState): string[] {
  injectWreckFitTestState(state)
  state.character.name = '深空星系验收'
  state.planetary = { planets: {}, runtimeVersion: 1 }
  state.modeChosen = true
  state.exploredGalaxies = [...buildSimContext().galaxies.keys()]
  state.importantTasks['find-humans'] = { done: false }
  for (const [id, n] of Object.entries({ 'part-frame': 2400, 'part-circuit': 2400, 'part-lens': 2100,
    'part-coolant': 600, 'part-drone-neural': 1200, 'part-qchip': 1200 })) state.warehouse.items[id] = n
  state.wallet.isk = 10_000_000
  state.fleet[state.shipId]!.plugs = ['plug-cpu-core', 'plug-cpu-core', 'plug-cpu-core']
  state.fleet[state.shipId]!.damagePlugs = ['speed', 'range', 'cargo']
  state.wreckLog![0]!.damagePlugs = ['speed', 'range']
  return ['未预先取得星系或探测机，仓库提供3架制造材料；实际制造和搜索由玩家执行。',
    '主控普通插件装满并带3战损，沉船记录有2战损；三界面同区卡格和详情可直接验收。']
}

/** 船长2026-10-08要求：即用合成档，原流程档保留；只在测试档补齐门槛。 */
export function injectStellarReadyTestState(state: GameState): string[] {
  injectStellarSearchTestState(state)
  const catalog = buildPlanetCatalog(), ctx = buildSimContext()
  state.character.name = '星系建设即用测试'
  state.debugQuick = true
  state.wallet.isk = 100_000_000
  for (const id of ['deep-space-probing', 'advanced-deep-space-probing', 'stellar-archive', 'probe-assembly',
    'materials', 'component-standardization']) state.skills.trained[id] = 5
  state.warehouse.items['deep-space-probe'] = 30
  for (const seed of [0, 1, 12, 19, 22, 55]) {
    const launched = beginStellarSearch(state, 'specified', String(seed))
    if (!launched.ok) throw new Error(`ready-search:${seed}:${launched.reason}`)
    advanceStellarSearch(state, 1000)
  }
  state.warehouse.items['deep-space-probe'] = 30
  for (const m of ctx.blueprints.get('bp-deep-space-probe')!.materials) state.warehouse.items[m.itemId] = m.count * 20
  state.warehouse.items['min-tritanium'] = 100_000
  state.warehouse.items['repairkit-civ'] = 10_000
  state.warehouse.items['part-coolant'] += 10_000
  addShipToFleet(state, 'sh-manatee')
  addShipToFleet(state, 'sh-manatee')
  const base = state.planetary!.planets['system-v1-0-p2']!
  const construction = state.planetary!.planets['system-v1-0-p1']!
  for (const p of [base, construction]) {
    surveyPlanet(state, catalog, p.id, 3)
    const prepared = preparePlanetBase(p, catalog)
    if (!prepared.ok) throw new Error(`ready-prepare:${p.id}:${prepared.reason}`)
    p.colony!.items['min-tritanium'] = 30_000
    p.colony!.items['part-coolant'] = 5000
    p.colony!.items['repairkit-civ'] = 5000
    p.colony!.credits = 2_000_000
    p.colony!.supplies = { food: 3000, water: 3000, medicine: 3000, metal: 3000, parts: 3000, research: 3000 }
    p.colony!.pauseEvents = true
  }
  for (const id of ['power', 'power', 'base', 'cryo', 'housing', 'housing', 'nutrition', 'water', 'maintenance', 'research', 'industry']) {
    const index = base.cells.findIndex(c => !c.obstacle && !c.building)
    const result = startPlanetBuild(base, catalog, index, id)
    if (!result.ok) throw new Error(`ready-build:${id}:${result.reason}`)
  }
  advancePlanetary(state, 30 * 60000, catalog)
  const humans = discoverPlanetHumans(state, ctx, catalog, base.id)
  if (!humans.ok) throw new Error(`ready-humans:${humans.reason}`)
  state.commsPopups = []
  return ['六类星系坐标0、1、12、19、22、55已保存；30架探测机，四项专属技能与两项材料技能满级。',
    'system-v1-0-p2已建成生存基地，system-v1-0-p1备好本地建材；其余星球保留勘探操作。',
    '六名人类保持休眠，两艘海牛运输舰、1亿信用点、20架探测机基础制造材料与仓库建材。',
    '测试档开启1秒化制造／搜索；星球工程仍按现行时间推进，随机基地事件暂时关闭，可在面板恢复。',
    '全新合成档，原流程档不覆盖；加载前手动备份个人进度。']
}
