import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cleanShipDamage, SHIP_DAMAGE_DEFS, SHIP_DAMAGE_PENALTY, type ShipDamageKind } from '@whale/core'
import { tr } from '../i18n/locale'
import { Glyph } from './Glyphs'
import { hideTip, hoverTipProps } from './Tooltip'
import { infoCardContent } from './shipInfo'
import '../styles-ship-damage.css'

/** 船长 2026-10-07 确认：战损与普通插件同格展示，详情沿用富卡及弹层。 */
export function ShipDamageMods({ ids }: { ids?: readonly ShipDamageKind[] }) {
  const [picked, setPicked] = useState<ShipDamageKind | null>(null)
  const modal = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const dialogId = useId()
  const damage = cleanShipDamage(ids)
  const pct = `${Math.round(SHIP_DAMAGE_PENALTY * 100)}%`
  const cards = (damage ?? []).map(id => {
    const def = SHIP_DAMAGE_DEFS.find(row => row.id === id)!
    const name = tr(def.nameId)
    return { id, name, content: infoCardContent(name, [], tr(def.descriptionId, { pct }), tr('ui.shipDamage.014')) }
  })
  const selected = cards.find(card => card.id === picked)
  useEffect(() => {
    if (!selected) {
      if (picked !== null) setPicked(null)
      return
    }
    const previous = trigger.current
    const focusModal = (): void => { modal.current?.querySelector<HTMLButtonElement>('button')?.focus() }
    focusModal()
    const keepFocus = (event: FocusEvent): void => {
      if (modal.current && !modal.current.contains(event.target as Node)) focusModal()
    }
    document.addEventListener('focusin', keepFocus)
    return () => {
      document.removeEventListener('focusin', keepFocus)
      if (previous?.isConnected) previous.focus()
    }
  }, [picked, selected?.id])
  if (!damage) return null
  return <>
    {cards.map(({ id, name, content }) => {
      const tip = hoverTipProps(content)
      return <button key={id} type="button"
        className="app-fit-slot-icon is-filled app-ship-damage-card" data-ship-damage data-damage-kind={id}
        aria-label={`${tr('ui.shipDamage.013')}: ${name}; -${pct}`} aria-haspopup="dialog"
        aria-expanded={selected?.id === id} aria-controls={selected?.id === id ? dialogId : undefined}
        {...tip} onClick={event => { tip.onMouseLeave(); hideTip(); trigger.current = event.currentTarget; setPicked(id) }}>
        <span className="app-fit-slot-icon-glyph" aria-hidden="true"><Glyph name="plug" size={22} /><Glyph name="ico-hint" size={16} /></span>
        <span className="app-fit-slot-icon-name">{name}</span>
        <span className="app-fit-slot-icon-sub">-{pct}</span>
      </button>
    })}
    {selected ? createPortal(<div className="app-modal-mask app-ship-damage-mask" onClick={() => setPicked(null)}>
      <div ref={modal} id={dialogId} className="app-modal app-ship-damage-modal" role="dialog" aria-modal="true"
        aria-labelledby={`${dialogId}-title`} onClick={event => event.stopPropagation()} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPicked(null) }
          if (event.key === 'Tab') { event.preventDefault(); modal.current?.querySelector<HTMLButtonElement>('button')?.focus() }
        }}>
        <div className="app-modal-head"><span id={`${dialogId}-title`}>{selected.name}</span>
          <button type="button" className="app-btn" aria-label={tr('ui.FitPage.055')} onClick={() => setPicked(null)}><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="app-modal-body">{selected.content}</div>
      </div>
    </div>, document.querySelector('.app-root') ?? document.body) : null}
  </>
}
