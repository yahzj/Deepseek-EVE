

export type FoeMountId =
  | 'foe-mount-charge-pirate'
  | 'foe-mount-charge-swarm-t1'
  | 'foe-mount-charge-swarm-t2'
  | 'foe-mount-charge-swarm-t3'
  | 'foe-mount-charge-swarm-t4'
  | 'foe-mount-drone-range-x4'
  | 'foe-mount-gun-range-x1-5'
  | 'foe-mount-titan-range-x1-5'
  | 'foe-mount-capture-web'
  | 'foe-mount-support-call'
  | 'foe-mount-gyro-stabilizer'
  | 'foe-mount-hull-repair'
  | 'foe-mount-revive-escort'
  | 'foe-mount-ink-range-debuff'
  | 'foe-mount-d-range-debuff'
  | 'foe-mount-corona-blink'
  | 'foe-mount-corona-overlay-drive'
  | 'foe-mount-corona-flash-overload'
  | 'foe-mount-corona-standby-shield'
  | 'foe-mount-corona-focus-array'
  | 'foe-mount-corona-overlay-beacon'
  | 'foe-mount-d-rebirth-protocol'
  | 'foe-mount-d-mausoleum-armor'
  | 'foe-mount-d-coating-armor'
  | 'foe-mount-d-shield-capacitor'
  | 'foe-mount-d-reconstruction'
  | 'foe-mount-c-acid-charge'
  | 'foe-mount-c-acid-shield'
  | 'foe-mount-c-hiveback-charge'
  | 'foe-mount-c-broodmother-charge'
  | 'foe-mount-c-brood-control'
  | 'foe-mount-c-hiveback-hatchery'
  | 'foe-mount-c-broodmother-hatchery'

export interface FoeMountDef {
  acidShieldDamageMul?: number
  broodControl?: { gunDmgMul: number; droneDmgMul: number; droneRangeBonusPct: number }
  hatchery?: { cycleMs: number; stock: number | 'unlimited'; fleet?: true }
  fleetSpeedRamp?: { rampMs: number; maxBonusPct: number }
  id: FoeMountId
  name: string
  en?: string
  charge?: {
    mul: number
    cooldownMs: number
    triggerMarginM?: number
    webImmune?: true
  }
  droneRangeOnHit?: { mul: number }
  gunRangeOnHit?: { mul: number; effectTextId?: string; noticeTextId?: string }
  web?: { slowMul: number; noThruster: true; noEvasion: true; rangeDownM: number }
  rangeDebuff?: { pct: number; strength?: number }
  blink?: { distanceM: number; cooldownMs: number }
  overlayDrive?: { stepMs: number; floorMs: number; dmgMul: number }
  flashOverload?: { healShield: true; hullCostPct: number }
  standbyShield?: { resistPct: number; delayMs: number }
  focusArray?: { rampMs: number; rangeBonusPct?: number; antiDroneBonusPct?: number }
  rebirthProtocol?: { repairMs: number; armorTotalPct: number; hullTotalPct: number }
  mausoleumArmor?: { hpMul: number; resistPct: number }
  coatingArmor?: { resistAdd: number; cap: number; durationMs: number }
  shieldCapacitor?: { rangeMul: number; reloadMul: number; damageMul: number }
  supportCall?: { delaySec: number; threatMul: number }
  evasionBonus?: { add: number }
  repairPulse?: { everyMs: number; armor: number; hull: number }
  reviveEscort?: {
    everyMs: number
    all?: true
    count?: number
    priorityShipIds?: readonly string[]
    allowedShipIds?: readonly string[]
    activeClock?: true
  }
  summonEscort?: {
    everyMs: number
    count: number
    shipId: string
    activeClock?: true
    formationSlots?: true
  }
  note?: string
}

export type FoeSupportBranch = 'inside' | 'outside'
