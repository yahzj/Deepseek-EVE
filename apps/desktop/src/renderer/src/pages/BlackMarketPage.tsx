import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { blackMarketNextRefresh, blackMarketUnlocked } from '@whale/core'
import type { BlackMarketOffer } from '@whale/core'
import { Glyph } from '../ui/Glyphs'
import { MarketGoodHover, marketGoodDisplayName, marketGoodInfo } from '../ui/marketGoodHover'
import { infoCardContent } from '../ui/shipInfo'
import { crestLabelOf } from '../ui/labelsText'
import { FOE_ACCENT } from '../ui/tones'
import { tr, cmdText, useL10n } from '../i18n/locale'
import { fmtDuration } from '../i18n/fmt'
import { MerchantMonitor } from '../ui/MerchantMonitor'
import type { PageProps } from './common'
import { isk } from './common'

export function BlackMarketPage({ engine, onToast, onBack }: PageProps & { onBack: () => void }) {
  useL10n()
  const board = engine.state.blackMarket
  const [selected, setSelected] = useState<string | null>(null)
  const [ask, setAsk] = useState<{ offer: BlackMarketOffer; day: number } | null>(null)
  const [deal, setDeal] = useState(false)
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const good = selected ? engine.ctx.marketGoods.get(selected) : undefined
  const offer = board?.offers.find((o) => o.goodKey === selected)
  const detailGood = detailKey ? engine.ctx.marketGoods.get(detailKey) : undefined
  const detail = detailGood ? marketGoodInfo(engine.ctx, detailGood, true) : undefined
  const speech = deal ? 'ui.blackMarket.018' : offer?.sold ? 'ui.blackMarket.019' : good?.kind === 'blueprint'
    ? 'ui.blackMarket.017' : good?.playerBuyable === false ? 'ui.blackMarket.016' : good ? 'ui.blackMarket.015' : 'ui.blackMarket.014'
  useEffect(() => { setSelected(null); setAsk(null); setDeal(false); setDetailKey(null) }, [board?.dayWallMs])
  useEffect(() => {
    if (!ask && !detailKey) return
    const previous = trigger.current
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAsk(null); setDetailKey(null) }
      if (e.key !== 'Tab') return
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button')
      if (!buttons?.length) return
      e.preventDefault()
      const index = Array.from(buttons).indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
    }
    window.addEventListener('keydown', close)
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { window.removeEventListener('keydown', close); if (previous?.isConnected) previous.focus() }
  }, [ask, detailKey])
  function buy() {
    if (!ask) return
    const r = engine.buyBlackMarketAt(ask.offer.goodKey, ask.day, ask.offer.price)
    setAsk(null)
    if (r.ok) setDeal(true)
    else onToast(cmdText(r), true)
  }
  if (!blackMarketUnlocked(engine.state)) return <div className="page-stack page-fill">
    <button className="app-btn" onClick={onBack}>{tr('ui.blackMarket.002')}</button><div>{tr('core.blackMarket.001')}</div>
  </div>
  return <div className="page-stack page-fill app-bm-page">
    <header className="app-bm-head">
      <button className="app-btn" onClick={onBack} title={tr('ui.blackMarket.002')}><Glyph name="ico-unfold" size={18} />{tr('ui.blackMarket.002')}</button>
      <h2>{tr('ui.blackMarket.001')}</h2>
      <span className="app-dim">{tr('ui.blackMarket.004', { p1: fmtDuration(Math.max(0, blackMarketNextRefresh(engine.state) - Date.now())) })}</span>
      <span className="app-gold">{isk(engine.state.wallet.isk)} {tr('ui.blackMarket.021')}</span>
    </header>
    <div className="app-bm-split">
      <section className="app-bm-stock" aria-label={tr('ui.blackMarket.003')}>
        <div className="app-bm-cardflow">
          {board?.offers.map((o) => {
            const g = engine.ctx.marketGoods.get(o.goodKey)
            if (!g) return null
            const info = marketGoodInfo(engine.ctx, g, true)
            return <MarketGoodHover key={o.goodKey} ctx={engine.ctx} good={g} hidePrices>
              <article style={{ '--bm-good-tone': info.tone } as CSSProperties} className={`app-bm-card${selected === o.goodKey ? ' is-selected' : ''}${o.sold ? ' is-sold' : ''}`}>
                <div className="app-bm-card-identity">
                  <Glyph name={info.glyph} size={30} color={info.tone} />
                  {info.crest ? <span className="app-bm-crest" aria-label={crestLabelOf(info.crest)} style={{ color: FOE_ACCENT[info.crest] }}>
                    <Glyph name={`fam-${info.crest.toLowerCase()}`} size={13} color="currentColor" />
                  </span> : null}
                  <div className="app-bm-card-meta"><span className={`app-hand-cell-rarity is-r${g.rarityTier}`}>R{g.rarityTier}</span><span className="app-dim">{tr(o.sold ? 'ui.blackMarket.008' : 'ui.blackMarket.007')}</span></div>
                  <span className="app-bm-category app-dim">{info.category}</span>
                </div>
                <button className="app-bm-select" aria-pressed={selected === o.goodKey} onClick={() => { setSelected(o.goodKey); setDeal(false) }}>
                  <span className="app-bm-name">{info.title}</span>
                </button>
                <div className="app-bm-note app-dim">{info.note}</div>
                {/* ⟪文案调整 2026-10-06⟫ 黑市只披露应付售价，不显示基准价和溢价倍率。 */}
                <strong className="app-bm-price"><span className="app-bm-price-amount">{isk(o.price)}</span><span>{tr('ui.blackMarket.021')}</span></strong>
                <div className="app-bm-card-actions">
                  <button className="app-btn app-bm-detail-button" aria-label={tr('ui.blackMarket.024')} onClick={(e) => { trigger.current = e.currentTarget; setSelected(o.goodKey); setDeal(false); setDetailKey(o.goodKey) }}><Glyph name="ico-hint" size={16} /></button>
                  <button className="app-btn app-bm-buy" disabled={o.sold} onClick={(e) => { trigger.current = e.currentTarget; setSelected(o.goodKey); setDeal(false); setAsk({ offer: { ...o }, day: board.dayWallMs }) }}>{tr(o.sold ? 'ui.blackMarket.008' : 'ui.blackMarket.009')}</button>
                </div>
              </article>
            </MarketGoodHover>
          })}
        </div>
        {board?.offers.length ? null : <div className="app-dim">{tr('ui.blackMarket.020')}</div>}
      </section>
      <section className="app-bm-merchant" aria-label={tr('ui.blackMarket.013')}>
        <div className="app-bm-sign">{tr('ui.blackMarket.013')}</div>
        <MerchantMonitor mood={deal ? 'deal' : good ? 'pitch' : 'idle'} />
        {/* ⟪文案调整 2026-10-06⟫ 右栏仅保留商人对白，商品全名在富详情和购买确认中展示。 */}
        <div className="app-bm-speech" aria-live="polite">{tr(speech)}</div>
      </section>
    </div>
    {detail ? <div className="app-modal-mask" onClick={() => setDetailKey(null)}>
      <div ref={dialog} className="app-modal app-bm-detail" role="dialog" aria-modal="true" aria-label={detail.title} onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head app-bm-detail-head"><span>{tr('ui.blackMarket.024')}</span><button className="app-btn" aria-label={tr('ui.FitPage.055')} onClick={() => setDetailKey(null)}><Glyph name="ico-cross" size={18} /></button></div>
        <div className="app-modal-body app-bm-detail-body">{infoCardContent(detail.title, detail.lines, detail.note)}</div>
      </div>
    </div> : null}
    {ask ? <div className="app-modal-mask" onClick={() => setAsk(null)}>
      <div ref={dialog} className="app-modal app-bm-confirm" role="dialog" aria-modal="true" aria-labelledby="bm-confirm-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="bm-confirm-title">{tr('ui.blackMarket.010')}</h3>
        <div>{marketGoodDisplayName(engine.ctx, ask.offer.goodKey)}</div>
        <div className="app-gold">{tr('ui.blackMarket.012', { p1: isk(ask.offer.price) })}</div>
        <div className="app-bm-confirm-actions"><button className="app-btn" autoFocus onClick={() => setAsk(null)}>{tr('ui.blackMarket.011')}</button><button className="app-btn" onClick={buy}>{tr('ui.blackMarket.010')}</button></div>
      </div>
    </div> : null}
  </div>
}
