import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cleanShipDamage, FIT_PRESET_NAME_MAX, wreckFitDetailOf, type ShipFitPreset, type WreckLogEntry } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { cmdText, tr } from '../i18n/locale'
import { Glyph, toneOf } from '../ui/Glyphs'
import { hoverTipProps } from '../ui/Tooltip'
import { itemHoverContent, moduleHoverContent } from '../ui/shipInfo'
import { rackText } from '../ui/labelsText'
import { ShipDamageMods } from '../ui/ShipDamageMods'

/** 装配卡只读投影，详情按当前目录展示；历史快照不用于重造损毁时的战斗数值。 */
export function WreckFitPanel({ engine, entry }: { engine: GameEngine; entry: WreckLogEntry }): ReactNode {
  const [picked, setPicked] = useState<{ id: string; drone: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [overwrite, setOverwrite] = useState<{ name: string; expected: ShipFitPreset } | null>(null)
  const modal = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const opened = picked !== null || saving
  useEffect(() => {
    if (!opened) return
    const previous = trigger.current
    modal.current?.querySelector<HTMLElement>('input,button')?.focus()
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { setPicked(null); setSaving(false); setOverwrite(null) }
      if (event.key !== 'Tab') return
      const controls = [...(modal.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled)') ?? [])]
      if (!controls.length) return
      event.preventDefault()
      const at = controls.indexOf(document.activeElement as HTMLElement)
      controls[(at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus()
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus() }
  }, [opened])
  const detail = wreckFitDetailOf(engine.ctx, entry)
  const damage = cleanShipDamage(entry.damagePlugs)
  const content = (id: string, drone: boolean): ReactNode => {
    if (drone) {
      const item = engine.ctx.items.get(id)
      return item ? itemHoverContent(item) : <div className="app-warn">{tr('ui.wreckFit.007', { id })}</div>
    }
    const def = engine.ctx.modules.get(id)
    return def ? moduleHoverContent(def) : <div className="app-warn">{tr('ui.wreckFit.007', { id })}</div>
  }
  function save(): void {
    const result = engine.saveWreckFitPresetAt(entry.seq, overwrite?.name ?? name, overwrite?.expected)
    if (result.overwrite) { setOverwrite({ name, expected: result.overwrite }); setError(cmdText(result)); return }
    if (!result.ok) { setError(cmdText(result)); setOverwrite(null); return }
    setSaving(false); setOverwrite(null); setError(''); setNote(tr('ui.wreckFit.006'))
  }
  const card = (id: string | null, index: number, drone = false, count?: number): ReactNode => {
    const def = id ? drone ? engine.ctx.items.get(id) : engine.ctx.modules.get(id) : undefined
    const label = def?.name ?? id ?? tr('ui.FitPage.023')
    const tone = toneOf(drone ? 'drone' : id ? engine.ctx.modules.get(id)?.slot ?? 'plug' : 'support')
    const body = <>
      <span className="app-fit-slot-icon-glyph"><Glyph name={drone ? 'drone' : id ? engine.ctx.modules.get(id)?.slot ?? 'plug' : 'ico-hint'} size={22} color={tone} /></span>
      <span className="app-fit-slot-icon-name">{label}</span>
      <span className="app-fit-slot-icon-sub">{count !== undefined ? `×${count}` : String(index)}</span>
    </>
    return id ? <button type="button" key={`${id}-${index}`} className="app-fit-slot-icon is-filled app-wreck-fit-card"
      data-wreck-fit-id={id} {...hoverTipProps(content(id, drone))} onClick={event => { trigger.current = event.currentTarget; setPicked({ id, drone }) }}>{body}</button>
      : <div key={`empty-${index}`} className="app-fit-slot-icon is-empty app-wreck-fit-card">{body}</div>
  }
  return <div className="app-wreck-fit">
    <div className="app-wreck-fit-head">
      <span className="app-dim">{tr('ui.wreckFit.003')}</span>
      <button type="button" className="app-btn is-small" data-wreck-fit-save onClick={event => {
        trigger.current = event.currentTarget; setSaving(true); setError(''); setNote(''); setOverwrite(null)
      }}><Glyph name="nav-fit" size={16} />{tr('ui.wreckFit.001')}</button>
    </div>
    {(['high', 'mid', 'low'] as const).map(rack => <div key={rack} className="app-wreck-fit-group">
      <div className="app-bay-title">{rackText(rack)}</div>
      <div className="app-fit-icongrid">{detail.slots.filter(slot => slot.rack === rack).map(slot => card(slot.id, slot.index))}</div>
    </div>)}
    {detail.plugs.length || damage ? <div className="app-wreck-fit-group"><div className="app-bay-title">{tr('ui.WreckLog.008')}
      {damage ? <span className="app-ship-damage-count"> {tr('ui.shipDamage.013')} {damage.length}</span> : null}</div>
      <div className="app-fit-icongrid">{detail.plugs.map((plug, at) => card(plug.id, at + 1))}<ShipDamageMods ids={damage} /></div></div> : null}
    {detail.drones.length ? <div className="app-wreck-fit-group"><div className="app-bay-title">{tr('ui.WreckLog.009')}</div>
      <div className="app-fit-icongrid">{detail.drones.map((drone, at) => card(drone.id, at + 1, true, drone.count))}</div></div> : null}
    {note ? <div role="status" className="app-dim">{note}</div> : null}
    {opened ? createPortal(<div className="app-modal-mask" onClick={() => { setPicked(null); setSaving(false); setOverwrite(null) }}>
      <div ref={modal} className="app-modal app-wreck-fit-modal" role="dialog" aria-modal="true"
        aria-label={tr(picked ? 'ui.wreckFit.008' : 'ui.wreckFit.001')} onClick={event => event.stopPropagation()}>
        <div className="app-modal-head"><span>{tr(picked ? 'ui.wreckFit.008' : 'ui.wreckFit.001')}</span>
          <button className="app-btn" aria-label={tr('ui.FitPage.055')} onClick={() => { setPicked(null); setSaving(false); setOverwrite(null) }}><Glyph name="ico-cross" size={18} /></button></div>
        <div className="app-modal-body">
          {picked ? content(picked.id, picked.drone) : <>
            <label className="app-wreck-fit-name">{tr('ui.wreckFit.005')}<input className="app-input" data-wreck-fit-name value={name} maxLength={FIT_PRESET_NAME_MAX}
              onChange={event => { setName(event.target.value); setOverwrite(null); setError('') }} /></label>
            {detail.plugs.length ? <div className="app-dim app-note">{tr('ui.wreckFit.002')}</div> : null}
            {error ? <div role="alert" className="app-warn">{error}</div> : null}
            <div className="app-wreck-fit-actions"><button className="app-btn" onClick={() => { setSaving(false); setOverwrite(null) }}>{tr('ui.blackMarket.011')}</button>
              <button className="app-btn is-primary" data-wreck-fit-confirm onClick={save}>{tr(overwrite ? 'ui.wreckFit.004' : 'ui.wreckFit.001')}</button></div>
          </>}
        </div>
      </div>
    </div>, document.querySelector('.app-root') ?? document.body) : null}
  </div>
}
