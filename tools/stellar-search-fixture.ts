/** 星系与战损卡格验收门槛；新合成档，不读取个人存档。 */
import type { GameState } from '@whale/core'
import { buildSimContext } from '@whale/data'
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
