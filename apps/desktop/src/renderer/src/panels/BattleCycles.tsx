import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { ChevronDown, List, Pin } from 'lucide-react'
import type { BattleDeviceCycleView, BattleWeaponCycleView } from '@whale/core'
import { tr } from '../i18n/locale'
import { TIP_DELAY_MS } from '../ui/Tooltip'
import { DMG_COLOR } from '../ui/tones'
import '../styles-battle-cycles.css'

export type { BattleDeviceCycleView, BattleWeaponCycleView } from '@whale/core'

interface BattleCyclesProps {
  weapons: readonly BattleWeaponCycleView[]
  devices: readonly BattleDeviceCycleView[]
}

type CycleRow = BattleWeaponCycleView | BattleDeviceCycleView
type OpenMode = 'closed' | 'hover' | 'pinned'

const STATE_IDS: Record<CycleRow['state'], string> = {
  ready: 'ui.battleCycles.006', reload: 'ui.battleCycles.007', 'no-ammo': 'ui.battleCycles.008',
  lost: 'ui.battleCycles.009', down: 'ui.battleCycles.010', active: 'ui.battleCycles.011',
  cooldown: 'ui.battleCycles.012', waiting: 'ui.battleCycles.013', 'no-stock': 'ui.battleCycles.014',
  stopped: 'ui.battleCycles.015', used: 'ui.battleCycles.016',
}

function ownerGroups<T extends CycleRow>(rows: readonly T[]): Array<{ tag: string; name: string; rows: T[] }> {
  const groups = new Map<string, { tag: string; name: string; rows: T[] }>()
  for (const row of rows) {
    let group = groups.get(row.ownerTag)
    if (!group) { group = { tag: row.ownerTag, name: row.ownerName, rows: [] }; groups.set(row.ownerTag, group) }
    group.rows.push(row)
  }
  return [...groups.values()]
}

function seconds(ms: number): string {
  return Number.isFinite(ms) && ms >= 0 ? `${(Math.ceil(ms / 100) / 10).toFixed(1)}s` : '-'
}

function CycleLine({ row, weapon = false }: { row: CycleRow; weapon?: boolean }) {
  const w = row as BattleWeaponCycleView
  const d = row as BattleDeviceCycleView
  const label = weapon && w.src === 'base' ? tr('ui.battleCycles.023') : row.label
  const state = tr(STATE_IDS[row.state])
  const progressing = row.state === 'reload' || row.state === 'active' || row.state === 'cooldown' || row.state === 'ready'
  const timed = row.state === 'reload' || row.state === 'cooldown' && (row.cycleMs > 0 || row.remainingMs > 0)
    || row.state === 'active' && row.remainingMs > 0
  const percent = progressing && Number.isFinite(row.percent) ? Math.min(100, Math.max(0, row.percent)) : 0
  const alive = weapon && w.aliveCount !== undefined ? tr('ui.battleCycles.019', { p1: w.aliveCount, p2: row.count }) : ''
  const target = !weapon && (d.targetName || d.targetTag) ? tr('ui.battleCycles.017', { p1: d.targetName || d.targetTag! }) : ''
  const slow = !weapon && d.kind === 'web' && d.effectPct !== undefined && Number.isFinite(d.effectPct)
    ? tr('ui.battleCycles.018', { p1: Math.round(d.effectPct * 10) / 10 }) : ''
  const details = [target, slow].filter(Boolean).join(' · ')
  const name = `${label}${row.count > 1 && !alive ? ` ×${row.count}` : ''}`
  const cycle = row.cycleMs > 0 ? seconds(row.cycleMs) : '-'
  const remaining = timed ? seconds(row.remainingMs) : '-'
  const tone = weapon && w.damageType ? { '--bc-weapon-tone': DMG_COLOR[w.damageType] } as CSSProperties : undefined

  return <div className={`app-bc-row is-${row.state}`} data-cycle-id={row.id} data-owner-tag={row.ownerTag}
    data-ship-id={row.shipId} data-device-kind={!weapon ? d.kind : undefined} data-cycle-state={row.state}
    data-battle-weapon-cycle={weapon ? row.id : undefined} data-battle-device-cycle={!weapon ? row.id : undefined}
    data-target-tag={!weapon ? d.targetTag : undefined} style={tone}>
    <div className="app-bc-name" title={name}>
      <span className="app-bc-label">{name}</span>
      {alive ? <span className="app-bc-alive">{alive}</span> : null}
    </div>
    <span className="app-bc-time" title={tr('ui.battleCycles.003')}>{cycle}</span>
    {weapon ? <span className="app-bc-time" title={tr('ui.battleCycles.004')}>{remaining}</span> : null}
    <div className="app-bc-progress">
      <span className="app-bc-state" title={[state, details].filter(Boolean).join(' · ')}>
        {state}{!weapon && timed ? ` · ${remaining}` : ''}
      </span>
      <span className="app-bc-track" role="progressbar" aria-label={`${row.ownerName}: ${label}`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={state}>
        <i className="app-bc-fill" style={{ width: `${percent}%` }} />
      </span>
    </div>
    {!weapon ? <span className="app-bc-target" data-target-tag={d.targetTag} title={details || undefined}>{details}</span> : null}
  </div>
}

/** 武器弹出列表不参与战场高度分配；装置只消费真实周期，不在页面重算机制。 */
export function BattleCycles({ weapons, devices }: BattleCyclesProps) {
  const [mode, setMode] = useState<OpenMode>('closed')
  const root = useRef<HTMLDivElement>(null)
  const scope = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelId = useId()
  const open = mode !== 'closed'
  const weaponGroups = ownerGroups(weapons)
  const deviceGroups = ownerGroups(devices)

  const cancelHover = (): void => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
  }
  const close = (): void => { cancelHover(); setMode('closed') }
  const togglePin = (): void => { cancelHover(); setMode(current => current === 'pinned' ? 'closed' : 'pinned') }
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!event.repeat) togglePin()
    }
  }

  useEffect(() => () => cancelHover(), [])
  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if ((open || timer.current !== null) && !scope.current?.contains(event.target as Node)) close()
    }
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || !open && timer.current === null) return
      event.preventDefault()
      event.stopPropagation()
      if (panel.current?.contains(document.activeElement)) trigger.current?.focus()
      close()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  useLayoutEffect(() => {
    const host = root.current
    const button = trigger.current
    if (!host || !button) return
    const screen = host.closest<HTMLElement>('.app-battle-screen') ?? host.closest<HTMLElement>('.app-root')
    if (!screen) return
    // offset 尺寸与布局父链均在旋转前逻辑空间中，不读物理视口宽高。
    const topOf = (element: HTMLElement): number => {
      let top = 0
      for (let node: HTMLElement | null = element; node && node !== screen; node = node.offsetParent as HTMLElement | null) top += node.offsetTop
      return top
    }
    const measure = (): void => {
      const bottom = topOf(button) + button.offsetHeight
      const controls = screen.querySelector<HTMLElement>('.app-battle-controls')
      const boundary = controls ? topOf(controls) : screen.clientHeight
      const popupHeight = Math.max(0, Math.min(320, screen.clientHeight * 0.5, boundary - bottom - 8))
      const deviceHeight = Math.max(0, Math.min(104, screen.clientHeight * 0.16))
      for (const [key, value] of [['--bc-popup-height', `${popupHeight}px`], ['--bc-device-height', `${deviceHeight}px`], ['--bc-popup-top', `${button.offsetHeight}px`]]) {
        if (host.style.getPropertyValue(key) !== value) host.style.setProperty(key, value)
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(screen)
    observer.observe(host)
    observer.observe(button)
    const dock = host.closest<HTMLElement>('.app-bts-topdock')
    if (dock) observer.observe(dock)
    return () => observer.disconnect()
  }, [])

  return <div ref={root} className="app-battle-cycles" data-battle-cycles>
    <div ref={scope} className="app-bc-weapons" onPointerEnter={event => {
      if (event.pointerType !== 'mouse' || !window.matchMedia('(any-hover: hover)').matches || mode !== 'closed') return
      cancelHover()
      timer.current = setTimeout(() => { timer.current = null; setMode(current => current === 'closed' ? 'hover' : current) }, TIP_DELAY_MS)
    }} onPointerLeave={event => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      cancelHover()
      if (mode === 'hover' && !panel.current?.contains(document.activeElement)) close()
    }} onBlur={event => {
      if (mode === 'hover' && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) close()
    }}>
      <button ref={trigger} type="button" className="app-btn is-small app-bc-trigger" aria-expanded={open}
        data-battle-weapons-trigger aria-controls={panelId} aria-pressed={mode === 'pinned'} onClick={togglePin} onKeyDown={keyDown}>
        <List size={16} aria-hidden="true" /><span>{tr('ui.battleCycles.001')}</span>
        {mode === 'pinned' ? <Pin size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      <div ref={panel} id={panelId} className="app-bc-popup" hidden={!open} role="region" aria-label={tr('ui.battleCycles.001')}
        tabIndex={0} data-battle-weapons-popup data-pinned={mode === 'pinned'}>
        <div className="app-bc-columns" aria-hidden="true">
          <span>{tr('ui.MapPage.001')}</span><span>{tr('ui.battleCycles.003')}</span>
          <span>{tr('ui.battleCycles.004')}</span><span>{tr('ui.battleCycles.005')}</span>
        </div>
        {weaponGroups.length ? weaponGroups.map(group => <section key={group.tag} className="app-bc-group" data-weapon-owner={group.tag}>
          <div className="app-bc-owner" title={group.name}>{group.name}</div>
          {group.rows.map(row => <CycleLine key={row.id} row={row} weapon />)}
        </section>) : <div className="app-bc-empty">{tr('ui.battleCycles.020')}</div>}
      </div>
    </div>
    {deviceGroups.length ? <section className="app-bc-devices" aria-label={tr('ui.battleCycles.002')}>
      <div className="app-bc-device-heading">{tr('ui.battleCycles.002')}</div>
      <div className="app-bc-device-scroll" tabIndex={0} role="region" aria-label={tr('ui.battleCycles.002')}>
        {deviceGroups.map(group => <section key={group.tag} className="app-bc-group" data-device-owner={group.tag}>
          <div className="app-bc-owner" title={group.name}>{group.name}</div>
          {group.rows.map(row => <CycleLine key={row.id} row={row} />)}
        </section>)}
      </div>
    </section> : null}
  </div>
}
