

export interface DroneLossReport {
  revived?: number
  returnedToSupply?: Record<string, number>
  battleStartedAtGameMs: number
  rate: number
  total: number
  recovered: number
  gone: number
  survivors?: number
  rows: Array<{ id: string; name: string; value: number; lost: number; back: number; gone: number }>
}

export type BattleReportSource = 'expedition' | 'encounter' | 'wormhole' | 'ai'

export type BattleBreakReason = 'hull' | 'timeout' | 'cannot-engage' | 'manual'

export interface BattleReportRecord {
  battleStartedAtGameMs: number
  source: BattleReportSource
  outcome: 'win' | 'lose' | 'break'
  breakReason?: BattleBreakReason
  durMs: number
  stats: { meShots: number; meHits: number; meDmg: number; foeShots: number; foeHits: number }
  shipsLost: string[]
  myUnits: Array<{ name: string; s: number; a: number; h: number; sMax: number; aMax: number; hMax: number }>
  foe: { alive: number; total: number; hpFrac: number }
  foeMounts?: readonly string[]
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  ammoUsed: { kin: number; exp: number; pla: number }
  dronesGone: number
  summary: string
  summaryId?: string
  summaryParams?: Readonly<Record<string, string | number>>
}
