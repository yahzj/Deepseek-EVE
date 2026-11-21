import type { ReactNode } from 'react'
import type { AiCoreType } from '@whale/core'
import { aiEfficiency, usableAiCoresOf } from '@whale/core'
import { aiCoreText } from './labelsText'
import type { GameEngine } from '../game/engine'

export function AiCoreSelect({
  engine,
  value,
  onPick,
  titleReady,
  titleEmpty,
  emptyLabel,
}: {
  engine: GameEngine
  value: AiCoreType | null
  onPick: (t: AiCoreType) => void
  titleReady: string
  titleEmpty: string
  emptyLabel: string
}): ReactNode {
  const state = engine.state
  const usable = usableAiCoresOf(state)
  return (
    <select
      className="app-select"
      value={usable.length === 0 ? '' : (value ?? '')}
      onChange={(e) => onPick(e.target.value as AiCoreType)}
      disabled={usable.length === 0}
      title={usable.length === 0 ? titleEmpty : titleReady}
    >
      {usable.length === 0 ? (
        <option value="">{emptyLabel}</option>
      ) : (
        usable.map((t) => (
          <option key={t} value={t}>
            {aiCoreText(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）
          </option>
        ))
      )}
    </select>
  )
}
