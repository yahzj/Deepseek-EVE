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

export interface SignalAutoEstimate {
  version: 1 | 2
  tech: WormholeAutoTechFactors
  capability: { turns: number; scanRadius: number; miners: number; salvagers: number; holdM3: number }
  layers: SignalAutoLayerProgress[]
  depthReached: number
  ordinaryUsedM3: number
  gains: Array<{ itemId: string; units: number }>
  cores: Array<{ type: 'gamma' | 'beta' | 'alpha'; n: number }>
  report?: SignalAutoReportDetails
}
