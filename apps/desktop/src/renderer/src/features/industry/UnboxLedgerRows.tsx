import { type ReactNode } from 'react'
import type { GameEngine } from '../../game/engine'
import type { UnboxBatchRecord } from '../../game/unboxLedger'
import '../../styles-unbox-ledger.css'
import { InfoHover, ItemHover, ModuleHover } from '../../ui/shipInfo'
import { blueprintHoverLines } from '../../ui/marketGoodHover'
import { fmtInt } from '../../i18n/fmt'
import { tr } from '../../i18n/locale'



export function UnboxLedgerRows({ engine, record }: { engine: GameEngine; record?: UnboxBatchRecord }): ReactNode {
  const rows = record?.outputs ?? []
  if (rows.length === 0) return <div className="app-dim app-unbox-ledger-empty">{tr('ui.IndustryPage.150')}</div>
  return (
    <ul className="app-inv-list app-unbox-ledger-rows">
      {rows.map(({ itemId: id, units }) => {
        const item = engine.ctx.items.get(id)
        const module = engine.ctx.modules.get(id)
        const blueprint = engine.ctx.blueprints.get(id) ?? engine.ctx.shipBlueprints.get(id)
        const label = item?.name ?? module?.name ?? blueprint?.name ?? id
        const content = item
          ? <ItemHover item={item} nameOf={(itemId) => engine.ctx.items.get(itemId)?.name}>{label}</ItemHover>
          : module
            ? <ModuleHover mod={module}>{label}</ModuleHover>
            : blueprint
              ? <InfoHover {...blueprintHoverLines(engine.ctx, blueprint)}>{label}</InfoHover>
              : <span>{label}</span>
        return (
          <li className="app-inv-row app-unbox-ledger-row" key={id}>
            <span className="app-unbox-ledger-name">{content}</span>
            <strong className="app-unbox-ledger-qty">×{fmtInt(units)}</strong>
          </li>
        )
      })}
    </ul>
  )
}
