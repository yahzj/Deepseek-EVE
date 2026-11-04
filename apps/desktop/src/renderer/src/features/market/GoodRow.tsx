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

/* ═══════════════ 单个商品行（行情 + 买卖 + 手动挂单） ═══════════════ */

/**
 * **商品行名（按语言）**（**2026-09-30 批 5**）。
 *
 * 为什么不能只调 `goodName`：**AI 核心四档没有"物品行"可查**（走 `state.aiCores` 账本），
 * `goodName` 对它们只能回落中文原串 ⇒ 英文界面下市场那行一直是「基础 AI 核心」。
 * 数据侧给了 `aiCoreGoodNameId(refId)` ⇒ 有 id 就走 `tr`；其余（物品/装备/舰船/蓝图）**逐字仍是 `goodName`**。
 */
/**
 * 商品行悬停（全站统一富卡皮肤）：装备/物品/舰船/蓝图/AI 核心各自组装
 * 标题 + 参数表 + 描述——与仓库/货仓/手册列表同一悬浮视觉。
 */
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
  // 2026-09-10 船长：行内不再显示「站内库存」（空间站库存池，玩家看的是自己的货）——
  // 改显示**玩家自己**这件东西的库存（舰船按机库同型艘数；其余走 core「自然库存」单点）
  const holdings = myStockOf(state, good)
  /**
   * 声望门槛锁按语言渲染（2026-09-30 批 5）：`marketLockNote` 给 `{ textId, params }`，
   * 由 `tr` 出当前语言；中文侧出的句子与 `note.text` 逐字相同（同一个模板）。
   * 暗市那枚对玩家隐身，共用同一句（`bmGateNote`）。
   */
  const lockNote = marketLockNote(state, good) ?? bmGateNote(state, good)
  const lockShow = lockNote !== null ? tr(lockNote.textId, lockNote.params) : null // 玩家侧统一观感：暗市对玩家隐身，仅显示声望锁指引（与顶船同款）
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
