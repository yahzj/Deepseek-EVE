import { LabRecipeFilters, type LabFilter } from '../../ui/LabRecipeFilters'
import { Panel } from '@whale/ui'
import { useState, type ReactNode } from 'react'
import type { GameEngine } from '../../game/engine'
import '../../styles-unbox-ledger.css'
import { AiSlotText } from '../../ui/aiSlots'
import { HintIcon } from '../../ui/Hint'
import type { PageProps } from '../../pages/common'
import { tr } from '../../i18n/locale'
import { LabCard } from './LabCard'

export function LabPanel({
  engine,
  onToast,
  onGotoMarket,
  onNeedMaterial,
  onGotoPlugExchange,
}: {
  engine: GameEngine
  onToast: PageProps['onToast']
  onGotoMarket?: (goodKey: string) => void
  onNeedMaterial?: (itemId: string) => void
  onGotoPlugExchange?: () => void
}): ReactNode {
  const state = engine.state
  const [filter, setFilter] = useState<LabFilter>('all')
  const recipes = [...engine.ctx.labRecipes.values()].filter(r => filter === 'all' || r.category === filter)
  const runs = engine.labRunViews()
  return (
    <Panel
      className="is-fill"
      title={tr('ui.lab.001')}
      hint={<HintIcon tip={tr('ui.lab.024')} />}
      right={
        <>
          <span className="app-dim">{tr('ui.lab.024')}</span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      <div className="app-win-body">
        <LabRecipeFilters value={filter} onPick={setFilter} />
        {recipes.length === 0 ? <div className="app-dim app-inv-empty">{tr('ui.lab.018')}</div> : null}
        <div className="app-belt-grid">
          {recipes.map((r) => (
            <LabCard
              key={r.id}
              recipe={r}
              engine={engine}
              onToast={onToast}
              onGotoMarket={onGotoMarket}
              onNeedMaterial={onNeedMaterial}
              onGotoPlugExchange={onGotoPlugExchange}
              runs={runs.filter((v) => v.recipeId === r.id)}
            />
          ))}
        </div>
      </div>
    </Panel>
  )
}
