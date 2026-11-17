

export interface WeekendEventState {
  seq: number
  startedAtWallMs: number
  endedAtWallMs?: number
  coreId: string
  peripheryIds: string[]
  family: string
  contributed: Record<string, number>
  beaconHighSec?: boolean
  beaconLit?: boolean
  flagshipAtWallMs?: number
  flagshipDown?: 'player' | 'octopus'
  flagshipPlayerKill?: {
    atWallMs: number
    runId: number
    waveIdx?: number
    downAtGameMs: number
  }
  flagshipBlackBox?: boolean
  flagshipHpMax?: number
  flagshipHpDone?: number
  flagshipHpRecovered?: number
  octopusHpDone?: number
  flagshipRunId?: number
  flagshipSettledRuns?: number[]
  bossTickWallMs?: number
  octopusHoldUntilWallMs?: number
  windowEndHoldUntilWallMs?: number
  prizePaidAtWallMs?: number
  rewardLedger?: {
    isk: number
    wreck: number
    blackBox: number
    byGalaxy: Record<string, { isk: number; wreck: number }>
  }
  reclaimPending?: { isk: number; wreck: number }
  reclaimPaid?: string[]
  assaultDraws?: number
  autoLoopGalaxyId?: string
}

export interface WeekendResultSnapshot {
  seq: number
  family: string
  coreId: string
  endedAtWallMs: number
  flagshipOutcome: 'player' | 'octopus' | 'window'
  share: number
  tier: 'A' | 'B' | 'C' | 'D' | 'none'
  galaxies: Array<{ galaxyId: string; put: number; progress: number; reclaimed: boolean; isk: number; wreck: number }>
  flagship?: { hpMax: number; hpDone: number; defeated: boolean; playerFrac?: number; octopusFrac?: number }
  flagshipPlayerKill?: { atWallMs: number; waveIdx?: number }
  progressPct?: number
  progressIsk?: number
  standing?: number
  isk: number
  wreck: number
  blackBox: number
  wreckItemId?: string
  blackBoxItemId?: string
}

export interface WeekendAmbushPick {
  cardId: string
  strengthMul: number
  threat: number
}

export interface WeekendFlagshipView {
  shown: boolean
  atWallMs?: number
  deadlineWallMs?: number
  down?: 'player' | 'octopus'
}

export interface WeekendTickResult {
  started: boolean
  flagshipShown: boolean
  flagshipAnchored: boolean
  flagshipDown?: 'player' | 'octopus'
  ended: boolean
  encounterRolls: Array<{ galaxyId: string; chance: number }>
}

export interface WeekendBossPoolView {
  hpMax: number
  hpDone: number
  hpLeft: number
  octopusDone: number
  playerFrac: number
  octopusFrac: number
}
