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
  /** 标题文字后的提示标记（撮合与星标说明；2026-09-13 船长口径） */
  hint?: ReactNode
  right: ReactNode
  rows: MarketGoodDef[]
  /** 空态文案（缺省为搜索/筛选无匹配商品；周期性缺货的渠道另传提示）。 */
  empty?: string
  selKey?: string | null
  onSelect?: (key: string) => void
}) {
  return (
    // is-fill + 去掉列表自身 max-height 帽：列表交给 Panel body 二级内滚（一级页不滚）
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
