import { useEffect, useRef, useState } from 'react'
import type { PreparationSquadKind } from '@whale/core'
import type { GameEngine } from '../game/engine'

export function usePreparationSquad(engine: GameEngine, kind: PreparationSquadKind, fallback: () => string[]) {
  const [picked, setPicked] = useState(() => engine.preparationSquad(kind, fallback()))
  const previous = useRef({ picked, kind, state: engine.state })
  useEffect(() => {
    if (previous.current.kind !== kind || previous.current.state !== engine.state) {
      const restored = engine.preparationSquad(kind, fallback())
      previous.current = { picked: restored, kind, state: engine.state }
      setPicked(restored)
      return
    }
    if (previous.current.picked === picked) return
    previous.current = { picked, kind, state: engine.state }
    engine.rememberPreparationSquad(kind, picked)
  }, [engine, kind, picked, engine.state])
  return [picked, setPicked] as const
}
