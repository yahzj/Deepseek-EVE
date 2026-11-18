import { useEffect, useRef } from 'react'
import type { BattleFx, BattleState } from '@whale/core'

import type { SfxCueId } from '../../game/audio/cues'
import { rerollBgmVariant } from '../../game/audio/music'
import { playCue } from '../../game/audio/player'
import { battleFxArrivals } from './battleFxCursor'
import type { BattleFxCursor } from './battleFxCursor'
import { killExplosionDelayMs, planBattleFx } from './battleSfxPlan'

interface Track {
  battle: BattleState
  deadFoes: Set<string>
  deadMe: Set<string>
  ended: 'me' | 'foe' | null
  lastHitType: Map<string, BattleFx['type']>
}

function createTrack(battle: BattleState): Track {
  const track: Track = {
    battle,
    deadFoes: new Set(),
    deadMe: new Set(),
    ended: battle.ended,
    lastHitType: new Map(),
  }
  for (const unit of Object.values(battle.units)) {
    if (unit.hp.s + unit.hp.a + unit.hp.h > 0) continue
    if (unit.side === 'foe') track.deadFoes.add(unit.tag)
    else track.deadMe.add(unit.tag)
  }
  return track
}

export function useBattleSfx({
  battle,
  visible,
  enabled = true,
}: {
  battle: BattleState | null
  visible: boolean
  enabled?: boolean
}): void {
  const cursorRef = useRef<BattleFxCursor>({ seq: -1 })
  const trackRef = useRef<Track | null>(null)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const audibleRef = useRef(false)

  const clearPending = (): void => {
    for (const id of timersRef.current) clearTimeout(id)
    timersRef.current.clear()
  }

  const schedule = (cue: SfxCueId, delayMs: number): void => {
    if (delayMs <= 0) {
      if (audibleRef.current) playCue(cue)
      return
    }
    const id = setTimeout(() => {
      timersRef.current.delete(id)
      if (audibleRef.current) playCue(cue)
    }, delayMs)
    timersRef.current.add(id)
  }

  useEffect(() => {
    if (!enabled) {
      audibleRef.current = false
      clearPending()
      return
    }
    audibleRef.current = visible
    if (battle === null) {
      clearPending()
      const track = trackRef.current
      trackRef.current = null
      if (track !== null && track.ended === null) playCue('combat-lose')
      return
    }
    let track = trackRef.current
    if (track === null || track.battle !== battle) {
      clearPending()
      if (track !== null && track.battle !== battle && visible) rerollBgmVariant('bgm-battle')
      track = createTrack(battle)
      trackRef.current = track
      cursorRef.current = { seq: -1 }
    }
    if (battle.ended !== null && track.ended === null) {
      track.ended = battle.ended
      if (visible) playCue(battle.ended === 'me' ? 'combat-win' : 'combat-lose')
    }
    const { events } = battleFxArrivals(cursorRef.current, battle)
    if (visible) {
      for (const fx of events) {
        if (!fx.repair && fx.side === 'me' && fx.hit && fx.to !== undefined) track.lastHitType.set(fx.to, fx.type)
        for (const planned of planBattleFx(fx)) schedule(planned.cue, planned.delayMs)
      }
    }
    for (const unit of Object.values(battle.units)) {
      const dead = unit.hp.s + unit.hp.a + unit.hp.h <= 0
      if (!dead) continue
      if (unit.side === 'foe') {
        if (track.deadFoes.has(unit.tag)) continue
        track.deadFoes.add(unit.tag)
        if (visible) schedule('combat-foe-down', killExplosionDelayMs(track.lastHitType.get(unit.tag)))
      } else if (!track.deadMe.has(unit.tag)) {
        track.deadMe.add(unit.tag)
        if (visible) schedule('combat-me-down', 0)
      }
    }
  })

  useEffect(
    () => () => {
      clearPending()
      audibleRef.current = false
      const track = trackRef.current
      trackRef.current = null
      if (track !== null && track.ended === null) playCue('combat-lose')
    },
    [],
  )
}
