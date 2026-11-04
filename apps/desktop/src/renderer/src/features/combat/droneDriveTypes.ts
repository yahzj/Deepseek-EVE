import type { DroneModel, DroneSortie } from './droneArt'

export interface DroneDriveState {
  foeSizes: number[]
  foeTags?: string[]
  mySizes?: number[]
  meSize: number
  farM: number
  nearM: number
  wings: Array<{ key?: string; owner?: string; artId: string; model: DroneModel; show: number; st?: DroneSortie; deck: boolean; foe?: string; rangeBuff?: boolean }>
  meAnchors: Map<string, { x: number; y: number }>
}
