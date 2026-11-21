import type { PlayerStationState } from './types'
import type { PlayerStationPopulation } from './populationTypes'
import type { StationTraining } from './training'
import type { StationRefining } from './refining'
import type { StationMining } from './mining'
import type { StationResearch } from './research'
import type { StationDevelopment } from './development'
import type { StationAcademy } from './academy'
import type { StationManufacturing } from './manufacturing'
import type { StationCrew } from './crew'
import type { StationSecurity } from './security'
import type { StationCampaign } from './campaign'

/** 正式第二阶段只存运行账，库存/真实舰船仍在GameState原位置。 */
export interface PlayerStationGame {
  version: 1
  discovered: boolean
  active: boolean
  station: PlayerStationState
  population: PlayerStationPopulation
  training: StationTraining
  refining: StationRefining
  mining: StationMining
  research: StationResearch
  development: StationDevelopment
  academy: StationAcademy
  manufacturing: StationManufacturing
  crew: StationCrew
  security: StationSecurity
  campaign: StationCampaign
  /** 真实副船任务锁；训练、人口运输、采矿、守备及外派不得重复占用。 */
  shipLocks: Record<string, 'population' | 'mining' | 'training' | 'security'>
  /** 主体/来源耗材由实际副船运输，物资只在该航单或原仓库一处。 */
  delivery?: { shipId: string; target: 'body' | 'source' | 'recovery' | 'return'; cargo: Record<string, number>; progressMs: number; durationMs: number }
  /** 保护返送后停在来源站的实际副船，仍占船，真实空返或人口接续后离开。 */
  sourceShips?: string[]
  rewardedReportId: number
  guardServiceMs: number
  history: { refiningPeak: number; manufacturingPeak: number; crewGrowthPeak: number; escortsReturned: number; defensesWon: number }
}
