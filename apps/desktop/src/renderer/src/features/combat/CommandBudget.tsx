import { useEffect, useId, useRef, useState } from 'react'
import { Users, X } from 'lucide-react'
import { commandBudgetOf, combatRosterOf, fleetDefOf, shipCommandCostOf, shipDisplayName, shipOperationBlockReason } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { cmdText, tr } from '../../i18n/locale'
import { ShipSprite } from '../../ui/ShipSprite'

export function CommandBudget({ engine, ships, special = false }: { engine: GameEngine; ships: readonly string[]; special?: boolean }) {
  const view = commandBudgetOf(engine.state, engine.ctx, ships, special)
  return <div className={view.ok ? 'app-dim app-note' : 'app-warn app-note'} data-command-budget>
    {tr('ui.command.002', { p1: view.cost, p2: view.capacity, p3: ships.length, p4: view.maxShips })}
    {!view.ok ? <div>{cmdText(view)}</div> : null}
  </div>
}

/** 常驻小队只在停靠且无出勤时编辑，名单直接复用准备偏好保存入口。 */
export function CombatSquadControl({ engine }: { engine: GameEngine }) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const state = engine.state
  const roster = combatRosterOf(state)
  const busy = state.awayGalaxy !== null || state.expedition.active || state.encounter.active || state.mining.active || state.salvaging.active || state.hauling.active || state.transit.active || state.standby.active || state.sideTasks.deliver !== null
  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); triggerRef.current?.focus() }
  }, [open])
  return <div className="app-command-control">
    <button ref={triggerRef} className="app-btn is-small" disabled={busy} onClick={() => setOpen(true)} title={busy ? tr('ui.command.004') : undefined} data-command-squad-trigger><Users size={15} aria-hidden /> {tr('ui.command.001')}</button>
    <CommandBudget engine={engine} ships={roster} />
    {open ? <div className="app-modal-mask" onClick={() => setOpen(false)}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="app-modal app-modal-wide app-command-modal" onClick={event => event.stopPropagation()}>
      <div className="app-modal-head"><span id={titleId}>{tr('ui.command.001')}</span><button className="app-btn is-small" aria-label={tr('ui.App.086')} title={tr('ui.App.086')} onClick={() => setOpen(false)}><X size={16} aria-hidden /></button></div>
      <div className="app-modal-body"><CommandBudget engine={engine} ships={roster} />
        <ul className="app-wh-cards">{Object.keys(state.fleet).map(id => {
          const on = roster.includes(id)
          const blocked = id === state.shipId ? null : shipOperationBlockReason(state, engine.ctx, id, 'configure')
          return <li key={id}><label className={`app-wh-card${on ? ' is-picked' : ''}`}>
            <input type="checkbox" checked={on} data-command-ship={id} disabled={busy || id === state.shipId || !!blocked && !on} onChange={() => {
              const next = on ? roster.filter(uid => uid !== id) : [...roster, id]
              if (next.length <= commandBudgetOf(state, engine.ctx, next).maxShips) engine.rememberPreparationSquad('combat', next)
            }} />
            <span className="app-wh-card-art" aria-hidden><ShipSprite shipId={fleetDefOf(state, engine.ctx, id)?.id} size={110} /></span>
            <span className="app-wh-card-name" title={shipDisplayName(state, engine.ctx, id)}>{shipDisplayName(state, engine.ctx, id)}</span>
            <span>{tr('ui.command.003')} {shipCommandCostOf(fleetDefOf(state, engine.ctx, id))}</span>
            {blocked ? <span className="app-dim">{cmdText(blocked)}</span> : null}
          </label></li>
        })}</ul>
      </div></div></div> : null}
  </div>
}
