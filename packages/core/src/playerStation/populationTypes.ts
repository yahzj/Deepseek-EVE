import type { PlayerStationBill } from './types'

export type PopulationPhase = 'loading' | 'outbound' | 'processing' | 'boarding' | 'inbound' | 'receiving' | 'safety-return' | 'empty-home'
export type PopulationStatus = 'dormant' | 'processing' | 'waiting' | 'aboard' | 'receiving' | 'protected' | 'resident'
export interface PopulationTrip {
  shipId: string
  phase: PopulationPhase
  progressMs: number
  /** 本地航段位置，0为玩家站，120000为来源站；转向不传送。 */
  positionMs: number
  slots: number
  people: number[]
  protectedQueue: number[]
  cargo: Record<string, number>
  active?: number
  safety: boolean
}
export interface PlayerStationPopulation {
  version: 1
  people: { status: PopulationStatus; receiveMs: number }[]
  sourceMaterials: Record<string, number>
  plan?: { shipId: string; remaining: number; stopped: boolean }
  trip?: PopulationTrip
}
export interface PopulationHost {
  sourceKnown(): boolean
  reception(): { ready: boolean; capacity: number }
  ship(id: string): { available: boolean; auxiliary: boolean; location: 'home' | 'source' | 'elsewhere'; freeM3: number } | undefined
  claimShip(id: string): boolean
  releaseShip(id: string, location: 'home' | 'source'): void
  available(id: string): number
  itemName?(id: string): string
  take(bill: PlayerStationBill): boolean
  give(bill: PlayerStationBill): void
}
export type PopulationAction = { kind: 'start'; shipId: string; count: number } | { kind: 'stop' }
export type PopulationReason = 'source' | 'facilities' | 'capacity' | 'ship' | 'materials' | 'busy' | 'invalid-count' | 'no-plan'
