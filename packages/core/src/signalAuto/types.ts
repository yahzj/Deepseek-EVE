import type { WormholeAutoTechFactors } from '../wormholeAuto'

/** 出发时冻结的估算结果；不保存地图、战斗或另一份游戏状态。 */
export interface SignalAutoEstimate {
  version: 1
  tech: WormholeAutoTechFactors
  capability: { turns: number; scanRadius: number; miners: number; salvagers: number; holdM3: number }
  layers: Array<{ depth: number; completion: number; combatRatio: number; guardPassed: boolean }>
  depthReached: number
  ordinaryUsedM3: number
  gains: Array<{ itemId: string; units: number }>
  cores: Array<{ type: 'gamma' | 'beta' | 'alpha'; n: number }>
}
