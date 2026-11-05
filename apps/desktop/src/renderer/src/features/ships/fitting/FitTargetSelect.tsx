import { shipDisplayName, shipOperationBlockReason, type GameState, type SimContext } from '@whale/core'
import { tr } from '../../../i18n/locale'
import './fittingOverview.css'

export function FitTargetSelect({ state, ctx, value, onChange }: {
  state: GameState
  ctx: SimContext
  value: string
  onChange: (id: string) => void
}) {
  return <select className="app-select app-fit-target-select" value={value}
    aria-label={tr('ui.fitKpi.003')} data-fit-target-select
    onChange={event => {
      const id = event.target.value
      if (!shipOperationBlockReason(state, ctx, id, 'configure')) onChange(id)
    }}>
    {Object.keys(state.fleet).map(id => {
      const busy = shipOperationBlockReason(state, ctx, id, 'configure') !== null
      return <option key={id} value={id} disabled={busy}>
        {shipDisplayName(state, ctx, id)}{busy ? ` · ${tr('ui.fitOverview.001')}` : ''}
      </option>
    })}
  </select>
}
