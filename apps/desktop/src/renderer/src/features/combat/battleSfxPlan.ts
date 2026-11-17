import type { BattleFx } from '@whale/core'

import type { SfxCueId } from '../../game/audio/cues'
import { boltFlightMs, explosionDelayMs } from './attackTiming'

export interface PlannedCue {
  cue: SfxCueId
  delayMs: number
}

const FIRE_BY_TYPE: Record<BattleFx['type'], SfxCueId> = {
  kinetic: 'combat-fire-kinetic',
  explosive: 'combat-fire-explosive',
  plasma: 'combat-fire-plasma',
}

function isDroneShot(fx: BattleFx): boolean {
  return fx.src === 'drone'
}

export function planBattleFx(fx: BattleFx): PlannedCue[] {
  if (fx.repair || fx.web === true || fx.blink === true || fx.acidBurst === true) return []
  if (fx.droneDown === true) {
    return fx.side === 'foe' ? [{ cue: 'combat-foe-down', delayMs: 0 }] : []
  }
  if (fx.pd === true) return []

  const out: PlannedCue[] = []
  const flightMs = boltFlightMs(fx.type, fx.src, fx.artId)

  if (!isDroneShot(fx)) {
    if (fx.side === 'me') out.push({ cue: FIRE_BY_TYPE[fx.type] ?? 'combat-fire', delayMs: 0 })
    else out.push({ cue: 'combat-foe-fire', delayMs: 0 })
  }

  if (fx.hit === true) {
    out.push({ cue: fx.side === 'me' ? 'combat-hit' : 'combat-hurt', delayMs: flightMs })
  } else if (fx.side === 'me' && !isDroneShot(fx)) {
    out.push({ cue: 'combat-miss', delayMs: flightMs })
  }
  return out
}

export function killExplosionDelayMs(killerType: BattleFx['type'] | undefined): number {
  return explosionDelayMs(killerType)
}
