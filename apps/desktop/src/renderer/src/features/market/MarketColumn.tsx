import type { ReactNode } from 'react'
import type { MarketGoodDef } from '@whale/core'
import { Panel } from '@whale/ui'
import type { PageProps } from '../../pages/common'
import { tr } from '../../i18n/locale'
import { GoodRow } from './GoodRow'

export function MarketColumn({
  engine,
  title,
  hint,
  right,
  rows,
  empty,
  selKey,
  onSelect,
}: {
  engine: PageProps['engine']
  title: string
  hint?: ReactNode
  right: ReactNode
  rows: MarketGoodDef[]
  empty?: string
  selKey?: string | null
  onSelect?: (key: string) => void
}) {
  return (
    <Panel className="is-fill" title={title} hint={hint} right={right}>
      {rows.length === 0 ? (
        <div className="app-dim app-inv-empty">{empty ?? tr("ui.MarketPage.035")}</div>
      ) : (
        <ul className="app-inv-list">
          {rows.map((good) => (
            <GoodRow key={good.key} engine={engine} good={good} selected={good.key === selKey} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </Panel>
  )
}
