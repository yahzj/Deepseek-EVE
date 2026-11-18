import type { ReactNode } from 'react'
import { bmGateNote, marketLockNote, marketQuote, marketTrend } from '@whale/core'
import type { MarketGoodDef } from '@whale/core'
import { MarketGoodHover, marketGoodDisplayName as goodDisplayName } from '../../ui/marketGoodHover'
import type { PageProps } from '../../pages/common'
import { isk } from '../../pages/common'
import { fmtInt } from '../../i18n/fmt'
import { Glyph, ICO_TONES } from '../../ui/Glyphs'
import { MarkStar } from '../../ui/marks'
import { tr } from '../../i18n/locale'
import { myStockOf, earliestSellRemaining, fmtClock } from './readouts'
import { kindTextOf } from './filters'


function GoodHover({
  engine,
  good,
  children,
}: {
  engine: PageProps['engine']
  good: MarketGoodDef
  children: ReactNode
}) {
  return <MarketGoodHover ctx={engine.ctx} good={good} as="li" className="app-inv-row app-mkt-row">{children}</MarketGoodHover>
}

export function GoodRow({
  engine,
  good,
  onSelect,
  selected,
}: {
  engine: PageProps['engine']
  good: MarketGoodDef
  onSelect?: (key: string) => void
  selected?: boolean
}) {
  const state = engine.state
  const quote = marketQuote(state, engine.ctx, good.key)
  const trend = marketTrend(state, good.key)
  const holdings = myStockOf(state, good)
  const lockNote = marketLockNote(state, good) ?? bmGateNote(state, good)
  const lockShow = lockNote !== null ? tr(lockNote.textId, lockNote.params) : null
  const life = good.rarity !== 'common' ? earliestSellRemaining(engine, good.key) : undefined
  const name = goodDisplayName(engine.ctx, good.key)
  const clickable = onSelect !== undefined

  return (
    <GoodHover engine={engine} good={good}>
      <div
        className={`app-inv-main app-mkt-row-click${selected ? ' is-sel' : ''}`}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => onSelect!(good.key) : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect!(good.key)
                }
              }
            : undefined
        }
      >
        <div className="app-mkt-name-line">
          <MarkStar engine={engine} kind="goods" id={good.key} />
          <span className="app-inv-name">{name}</span>
          <span className="app-chip is-dim">{kindTextOf(engine.ctx, good)}</span>
          {good.kind === 'blueprint' ? (
            <>
              {state.learnedRecipes.includes(good.refId) ? (
                <span className="app-chip is-learned" title={tr("ui.MarketPage.024")}>
                  {tr("ui.MarketPage.025")}
                </span>
              ) : null}
              {(state.blueprintStock[good.refId] ?? 0) > 0 ? (
                <span className="app-chip is-stock" title={tr("ui.MarketPage.026")}>
                  {tr("ui.MarketPage.027")}{(state.blueprintStock[good.refId] ?? 0).toLocaleString('zh-CN')}
                </span>
              ) : null}
            </>
          ) : null}
          {good.rarity === 'rare' ? <span className="app-chip is-rare">{tr("ui.IndustryPage.035")}</span> : null}
          {good.rarity === 'exotic' ? <span className="app-chip is-exotic">{tr("ui.MarketPage.028")}</span> : null}
          {lockShow ? (
            <span className="app-chip is-exotic" title={lockShow}>
              <span className="app-ico">
                <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
              </span>
              {lockShow}
            </span>
          ) : null}
        </div>
        <div className="app-inv-count">
          <span className="app-mkt-quote">
            {tr("ui.MarketPage.029")} <b className="app-gold">{quote.buy !== undefined ? isk(quote.buy) : '—'}</b>
            <span className={trend > 0 ? 'app-trend-up' : trend < 0 ? 'app-trend-down' : 'app-trend-flat'}>
              {trend > 0 ? ' ▲' : trend < 0 ? ' ▼' : ' ·'}
            </span>
          </span>
          <span className="app-mkt-quote">
            {tr("ui.MarketPage.030")} <b className={quote.sell !== undefined ? 'app-price-sell' : ''}>{quote.sell !== undefined ? isk(quote.sell) : tr("ui.MarketPage.032")}</b>
            {quote.sellQty > 1 ? ` ×${quote.sellQty.toLocaleString('zh-CN')}` : ''}
          </span>
          {life !== undefined ? (
            <span className="app-chip app-life-chip">
              <span className="app-ico">
                <Glyph name="ico-clock" size={11} color={ICO_TONES['ico-clock']} />
              </span>
              {fmtClock(life)}
            </span>
          ) : null}
          {/* ⟪文案调整 2026-10-04⟫ 库存去处按现行账本说明，并随语言切换取词。 */}
          <span className="app-dim" title={tr('ui.MarketPage.023')}>
            {' '}
            {tr('ui.MarketPage.126', { n: fmtInt(holdings) })}
          </span>
          {quote.sell === undefined && good.rarity !== 'common' ? (
            <span className="app-dim">{tr('ui.MarketPage.127')}</span>
          ) : null}
        </div>
      </div>
    </GoodHover>
  )
}
