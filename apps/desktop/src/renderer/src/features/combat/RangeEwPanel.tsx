import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Radio, ChevronDown } from '../../ui/layoutIcons'
import { playerRangeEwOf, rangeEwPreviewOf, rangeEwSignalTargetOf, type AnomalyDef, type GameState, type SimContext,
  type BattleState,
  type RangeEwPart, type RangeEwContest, type RangeEwView } from '@whale/core'
import { tr } from '../../i18n/locale'
import './rangeEw.css'

const n = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
function Parts({ rows }: { rows: readonly RangeEwPart[] }) {
  return <ul className="app-ew-parts">{rows.map(row => <li key={row.id}>
    <b>{row.name}</b><span>{tr('ui.rangeEw.013', { p1: n(row.base), p2: n(row.extra),
      p3: n(row.equipment), p4: n(row.equipmentMul), p5: n(row.total) })}</span>
  </li>)}</ul>
}

/** 摘要不依赖悬停；详情按需展开，不挤压战场。 */
export function RangeEwPanel({ view, expected = false, loadDetails }: { view: RangeEwContest; expected?: boolean; loadDetails?: () => RangeEwView | undefined }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const advantage = view.net > 0 ? tr('ui.rangeEw.004', { p1: n(view.net) })
    : view.net < 0 ? tr('ui.rangeEw.005', { p1: n(-view.net) }) : tr('ui.rangeEw.006')
  const effect = view.meCut > 0 ? tr('ui.rangeEw.008', { p1: n(view.meCut * 100) })
    : view.foeCut > 0 ? tr('ui.rangeEw.007', { p1: n(view.foeCut * 100) }) : tr('ui.rangeEw.009')
  return <div className="app-ew" data-range-ew ref={root}>
    {!expected ? <span className="app-ew-status" role="status" aria-atomic="true">{tr('ui.rangeEw.001')} · {tr(view.net > 0 ? 'ui.rangeEw.004' : view.net < 0 ? 'ui.rangeEw.005' : 'ui.rangeEw.006', { p1: '' })}</span> : null}
    <button ref={trigger} type="button" className="app-btn is-small app-ew-trigger" aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen(value => !value)} title={tr(expected ? 'ui.rangeEw.017' : 'ui.rangeEw.001')}>
      <Radio size={14} aria-hidden="true" /><b>{tr(expected ? 'ui.rangeEw.017' : 'ui.rangeEw.001')}</b>
      <span>{tr('ui.rangeEw.002')} {n(view.meStrength)} / {tr('ui.rangeEw.003')} {n(view.foeStrength)}</span>
      <span>{advantage}</span><span className={view.meCut > 0 ? 'app-warn' : ''}>{effect}</span>
      {open ? <ChevronDown size={14} aria-hidden="true" /> : null}
    </button>
    {open ? <RangeEwBattleDetail id={panelId} view={view} loadDetails={loadDetails} expected={expected} /> : null}
  </div>
}

export function RangeEwBattleDetail({ id, view, loadDetails, expected = false }: { id?: string; view: RangeEwContest; loadDetails?: () => RangeEwView | undefined; expected?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = panel.current
    if (!host || !expected) return
    let scroll = host.parentElement
    while (scroll && !['auto', 'scroll'].includes(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement
    if (!scroll) return
    const measure = () => host.style.setProperty('--ew-detail-height', `${Math.max(0, Math.min(300, scroll.clientHeight - 16))}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [expected])
  const full = loadDetails?.() ?? { ...view, weapons: [] }
  return <div ref={panel} id={id} className="app-ew-detail" role="region" tabIndex={0} aria-label={tr('ui.rangeEw.001')}>
      <div className="app-ew-sides"><section><b>{tr('ui.rangeEw.002')} {n(full.meStrength)}</b><Parts rows={full.me} /></section>
        <section><b>{tr('ui.rangeEw.003')} {n(full.foeStrength)}</b><Parts rows={full.foe} /></section></div>
      <div className="app-ew-ranges"><span>{tr('ui.rangeEw.014')} → {tr(expected ? 'ui.rangeEw.016' : 'ui.rangeEw.015')}</span>
        {full.weapons.map(row => <div key={`${row.side}:${row.id}:${row.beforeM}:${row.currentM}`}><span>{row.owner} · {row.label}{row.count > 1 ? ` ×${row.count}` : ''}</span>
          <span>{n(row.beforeM)} → {n(row.currentM)} m · -{n(row.reduction * 100)}%{row.floorLimited ? ` · ${tr('ui.rangeEw.020')}` : ''}</span></div>)}</div>
  </div>
}

export function RangeEwFleet({ state, ctx, ids }: { state: GameState; ctx: SimContext; ids: readonly string[] }) {
  const rows = playerRangeEwOf(state, ctx, ids)
  return <details className="app-ew-fleet"><summary>{tr('ui.rangeEw.010')} {n(rows.reduce((sum, row) => sum + row.total, 0))}</summary>
    <Parts rows={rows} /></details>
}

/** 未知目标不建档、不抽敌卡；已知目标仅在点开后生成只读预览。 */
export function RangeEwPreview({ state, ctx, card, ids, wormhole }: {
  state: GameState; ctx: SimContext; card?: AnomalyDef; ids?: readonly string[]; wormhole?: NonNullable<BattleState['wormhole']>
}) {
  const [open, setOpen] = useState(false)
  if (!card) return <span className="app-dim">{tr('ui.rangeEw.018')}</span>
  return <div className="app-ew-preview">
    <button type="button" className="app-btn is-small" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Radio size={14} aria-hidden="true" /> {tr('ui.rangeEw.017')}
    </button>
    {open ? rangeEwPreviewOf(state, ctx, card, ids, wormhole).map(row => <section key={`${row.wave}:${row.phase}`}>
      <b>{row.wave + 1} / {card.waves?.length ?? 1} · {tr(row.phase === 'opening' ? 'ui.rangeEw.021' : row.phase === 'inside' ? 'ui.rangeEw.022' : 'ui.rangeEw.023')}</b><RangeEwPanel view={row.view} expected loadDetails={() => row.view} />
    </section>) : null}
  </div>
}

export function SignalRangeEwPreview({ state, ctx }: { state: GameState; ctx: SimContext }) {
  const target = rangeEwSignalTargetOf(state, ctx)
  return target ? <RangeEwPreview state={state} ctx={ctx} {...target} /> : null
}
