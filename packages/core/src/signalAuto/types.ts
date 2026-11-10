import type { WormholeAutoTechFactors } from '../wormholeAuto'

export type SignalAutoReturnReason = 'guard' | 'budget' | 'max-depth'

export interface SignalAutoGuardBattle {
  cardId: string
  outcome: 'victory' | 'defeat' | 'timeout' | 'unavailable'
  durationMs: number
}

export interface SignalAutoLayerProgress {
  depth: number
  completion: number
  /** 版本1的解析比值；版本2不再用比值决定能否通过。 */
  combatRatio?: number
  guardBattle?: SignalAutoGuardBattle
  guardPassed: boolean
}

export interface SignalAutoLayerReport extends SignalAutoLayerProgress {
  turns: number
  gains: Array<{ itemId: string; units: number }>
}

export interface SignalAutoReportDetails {
  guardRules?: 2
  availableTurns: number
  spentTurns: number
  returnReason: SignalAutoReturnReason
  layers: SignalAutoLayerReport[]
}

/** 出发时冻结的估算结果；不保存地图、战斗或另一份游戏状态。 */
export interface SignalAutoEstimate {
  version: 1 | 2
  tech: WormholeAutoTechFactors
  capability: { turns: number; scanRadius: number; miners: number; salvagers: number; holdM3: number }
  layers: SignalAutoLayerProgress[]
  depthReached: number
  ordinaryUsedM3: number
  gains: Array<{ itemId: string; units: number }>
  cores: Array<{ type: 'gamma' | 'beta' | 'alpha'; n: number }>
  /** 新快照的逐层返航报告数据；缺省表示兼容较早的估算快照。 */
  report?: SignalAutoReportDetails
}
