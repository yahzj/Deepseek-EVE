import { useEffect, useRef, useState } from 'react'
import { blackMarketNextRefresh, blackMarketUnlocked } from '@whale/core'
import type { BlackMarketOffer } from '@whale/core'
import { Glyph } from '../ui/Glyphs'
import { MarketGoodHover, marketGoodDisplayName } from '../ui/marketGoodHover'
import { tr, cmdText, useL10n } from '../i18n/locale'
import { fmtDuration } from '../i18n/fmt'
import { AsciiMerchant } from '../ui/AsciiMerchant'
import type { PageProps } from './common'
import { isk } from './common'

export function BlackMarketPage({ engine, onToast, onBack }: PageProps & { onBack: () => void }) {
  useL10n()
  const board = engine.state.blackMarket
  const [selected, setSelected] = useState<string | null>(null)
  const [ask, setAsk] = useState<{ offer: BlackMarketOffer; day: number } | null>(null)
  const [deal, setDeal] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const good = selected ? engine.ctx.marketGoods.get(selected) : undefined
  const offer = board?.offers.find((o) => o.goodKey === selected)
  const speech = deal ? 'ui.blackMarket.018' : offer?.sold ? 'ui.blackMarket.019' : good?.kind === 'blueprint'
    ? 'ui.blackMarket.017' : good?.playerBuyable === false ? 'ui.blackMarket.016' : good ? 'ui.blackMarket.015' : 'ui.blackMarket.014'
  useEffect(() => { setSelected(null); setAsk(null); setDeal(false) }, [board?.dayWallMs])
  useEffect(() => {
    if (!ask) return
    const previous = trigger.current
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAsk(null)
      if (e.key !== 'Tab') return
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button')
      if (!buttons?.length) return
      e.preventDefault()
      const index = Array.from(buttons).indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
    }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close); if (previous?.isConnected) previous.focus() }
  }, [ask])
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
            return <MarketGoodHover key={o.goodKey} ctx={engine.ctx} good={g}>
              <article className={`app-bm-card${selected === o.goodKey ? ' is-selected' : ''}${o.sold ? ' is-sold' : ''}`}>
                <button className="app-bm-select" aria-pressed={selected === o.goodKey} onClick={() => { setSelected(o.goodKey); setDeal(false) }}>
                  <Glyph name={g.kind === 'ship' ? 'nav-ship' : g.kind === 'aicore' ? 'nav-ai' : g.kind === 'blueprint' ? 'nav-industry' : g.kind === 'module' ? 'nav-fit' : 'nav-items'} size={32} />
                  <span className="app-bm-name">{marketGoodDisplayName(engine.ctx, g.key)}</span>
                  <span className="app-dim">R{g.rarityTier} · {tr(o.sold ? 'ui.blackMarket.008' : 'ui.blackMarket.007')}</span>
                </button>
                <span className="app-dim">{tr('ui.blackMarket.005', { p1: isk(o.basePrice) })}</span>
                <span className="app-bm-premium">{tr('ui.blackMarket.006', { p1: o.multiplier })}</span>
                <strong className="app-bm-price">{isk(o.price)} {tr('ui.blackMarket.021')}</strong>
                <button className="app-btn" disabled={o.sold} onClick={(e) => { trigger.current = e.currentTarget; setSelected(o.goodKey); setDeal(false); setAsk({ offer: { ...o }, day: board.dayWallMs }) }}>{tr(o.sold ? 'ui.blackMarket.008' : 'ui.blackMarket.009')}</button>
              </article>
            </MarketGoodHover>
          })}
        </div>
        {board?.offers.length ? null : <div className="app-dim">{tr('ui.blackMarket.020')}</div>}
      </section>
      <section className="app-bm-merchant" aria-label={tr('ui.blackMarket.013')}>
        <div className="app-bm-sign">{tr('ui.blackMarket.013')}</div>
        <AsciiMerchant mood={deal ? 'deal' : good ? 'pitch' : 'idle'} />
        <div className="app-bm-speech" aria-live="polite">{tr(speech)}</div>
        {good ? <div className="app-bm-picked app-dim">{marketGoodDisplayName(engine.ctx, good.key)}</div> : null}
      </section>
    </div>
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
