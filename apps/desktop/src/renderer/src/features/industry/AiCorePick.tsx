import { type ReactNode } from 'react'
import { aiEfficiency, countAiCore, type AiCoreType } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { aiCoreText } from '../../ui/labelsText'
import { tr } from '../../i18n/locale'

export function AiCorePick({
  engine,
  suffix,
  core,
  usableCores,
  onPick,
  pilotNote = false,
}: {
  engine: GameEngine
  suffix: string
  core: AiCoreType | null
  usableCores: readonly AiCoreType[]
  onPick: (t: AiCoreType) => void
  pilotNote?: boolean
}): ReactNode {
  const state = engine.state
  const ctx = engine.ctx
  return (
    <div className="hud-row wrap hud-aipick">
      <label className="hud-label" htmlFor={`hud-ai-core-${suffix}`}>
        {tr('ui.hud.148')}
      </label>
      <select
        id={`hud-ai-core-${suffix}`}
        className="hud-select"
        value={core ?? ''}
        onChange={(e) => onPick(e.target.value as AiCoreType)}
        disabled={usableCores.length === 0}
        title={tr('ui.hud.048')}
        aria-describedby={`hud-ai-stock-${suffix}`}
      >
        {usableCores.length === 0 ? (
          <option value="">{tr('ui.hud.049')}</option>
        ) : (
          usableCores.map((t) => (
            <option key={t} value={t}>
              {aiCoreText(t)} · {Math.round(aiEfficiency(state, ctx, t) * 100)}%
            </option>
          ))
        )}
      </select>
      {/* 剩余数量：core 既有取数口 `countAiCore`（＝核心库剩余；起炉会消耗一枚） */}
      <span className="hud-chip" id={`hud-ai-stock-${suffix}`}>
        {core !== null ? tr('ui.hud.149', { p1: countAiCore(state, core) }) : tr('ui.hud.049')}
      </span>
      {pilotNote ? <span className="hud-chip">{tr('ui.hud.050')}</span> : null}
    </div>
  )
}
