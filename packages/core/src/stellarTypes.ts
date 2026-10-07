import type { PlanetState } from './planetTypes'

export type StellarSystemKind = 'single' | 'binary' | 'white-dwarf' | 'neutron' | 'black-hole' | 'rogue'
export type StellarPlanetKind = 'rocky' | 'desert' | 'ice' | 'ocean' | 'lava' | 'temperate' | 'gas'
export interface StellarBody {
  planetId: string
  ordinal: number
  kind: StellarPlanetKind
  orbit: number
  x: number
  y: number
}
export interface StellarSystem {
  id: string
  generationVersion: number
  seed: number
  kind: StellarSystemKind
  starClass: 'yellow' | 'orange' | 'red' | 'blue' | 'white' | 'neutron' | 'black-hole' | 'none'
  stars: { x: number; y: number; radius: number }[]
  bodies: StellarBody[]
  routeMinutes: number
  developed?: boolean
}
export interface StellarSearch {
  seq: number
  mode: 'random' | 'specified'
  seed: number
  durationMs: number
  progressMs: number
  paused: boolean
}
export interface StellarState {
  systems: Record<string, StellarSystem>
  search?: StellarSearch
  searchSeq: number
  autoSearch: boolean
  stoppedReason?: 'capacity' | 'probe-stock'
}
export interface GeneratedStellarSystem {
  system: StellarSystem
  planets: PlanetState[]
}
