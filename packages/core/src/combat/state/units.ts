import type { DamageResists } from '../../types'

export interface BattleUnitRt {
  tag: string
  side: 'me' | 'foe'
  name: string
  hp: import('../../combatMath').Hp3
  hpMax?: { s: number; a: number; h: number }
  foeShipId?: string
  downAtMs?: number
  weapons: number[]
  enteredAtMs?: number
  stealthUntilMs?: number
}

export interface BattleWebDebuff {
  byTag: string
  slowMul: number
  noThruster: true
  noEvasion: true
  rangeDownM: number
  atMs: number
}

export interface BattleFoeWebDebuff {
  byTag: string
  slowMul: number
  noThruster: true
  noEvasion: true
  atMs: number
}

export interface BattleFx {
  seq: number
  atMs: number
  side: 'me' | 'foe'
  tag: string
  to?: string
  type: 'kinetic' | 'explosive' | 'plasma'
  src?: 'turret' | 'missile' | 'laser' | 'drone' | 'base'
  repair?: { armor: number; hull: number; droneIndex: number }
  acidBurst?: true
  artId?: string
  web?: true
  blink?: true
  speedX?: number
  hit: boolean
  dmg?: number
  droneDown?: boolean;
  pd?: boolean
}

export interface DronePoolEntry {
  launched?: boolean
  launchRequeued?: true
  owner?: string
  s: number
  a: number
  h: number
  alive: boolean
  artId?: string
  evasion: number
  resists?: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists }
  inHangar?: boolean
  readyAtMs?: number
  maxS?: number
  maxA?: number
  maxH?: number
}

export interface BattleRepairUnit {
  moduleId: string
  kitId: string
  free?: boolean
  armorPerPulse: number
  hullPerPulse: number
  stopped: boolean
  nextPulseAtMs?: number
}

export interface BattleRepairLedger {
  units: BattleRepairUnit[]
  kits: Record<string, number>
  nextPulseAtMs?: number
  pulses: number
  kitsUsed: number
  kitsUsedByType?: Record<string, number>
}

export interface BattleRepairDroneLedger {
  pulses: number
  kitsUsed: number
  kitsUsedByType: Record<string, number>
}

export interface BattleShieldChargeLedger {
  streams: BattleShieldFieldStream[]
  pulses: number
}

export interface BattleShieldFieldStream {
  modelId: string
  pct: number
  ms: number
  nextPulseAtMs?: number
}

export interface BattleShieldFieldLedger {
  streams: BattleShieldFieldStream[]
  pulses: number
}
