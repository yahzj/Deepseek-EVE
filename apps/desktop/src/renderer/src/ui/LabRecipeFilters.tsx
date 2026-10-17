import type { LabRecipeDef } from '@whale/core'
import { tr } from '../i18n/locale'

export type LabFilter = 'all' | NonNullable<LabRecipeDef['category']>
const FILTERS: readonly { key: LabFilter; textId: string }[] = [
  { key: 'all', textId: 'ui.labFilter.001' },
  { key: 'fuel', textId: 'ui.labFilter.002' },
  { key: 'beacon', textId: 'ui.labFilter.003' },
  { key: 'accelerant', textId: 'ui.labFilter.004' },
]

export function LabRecipeFilters({ value, onPick }: { value: LabFilter; onPick: (value: LabFilter) => void }) {
  return <div className="app-subtabs" role="tablist" aria-label={tr('ui.labFilter.005')} style={{ flexWrap: 'wrap' }}>
    {FILTERS.map(row => <button key={row.key} type="button" role="tab" aria-selected={row.key === value}
      className={`app-subtab${row.key === value ? ' is-active' : ''}`} onClick={() => onPick(row.key)}>{tr(row.textId)}</button>)}
  </div>
}
