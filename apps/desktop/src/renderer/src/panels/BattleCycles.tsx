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

function CycleLine({ row, ownerMark, weapon = false }: { row: CycleRow; ownerMark: string; weapon?: boolean }) {
  const w = row as BattleWeaponCycleView
  const d = row as BattleDeviceCycleView
  const label = weapon && w.src === 'base' ? tr('ui.battleCycles.023') : row.label
  const state = tr(STATE_IDS[row.state])
  const progressing = row.state === 'reload' || row.state === 'active' || row.state === 'cooldown' || row.state === 'ready'
  const cycle = Number.isFinite(row.cycleMs) && row.cycleMs > 0
  const remaining = Number.isFinite(row.remainingMs) && row.remainingMs >= 0
  const timed = remaining && (cycle && (row.state === 'reload' || row.state === 'cooldown')
    || row.state === 'active' && row.remainingMs > 0)
  const track = cycle && remaining && progressing && (row.state !== 'active' || row.remainingMs > 0)
  const percent = progressing && Number.isFinite(row.percent) ? Math.min(100, Math.max(0, row.percent)) : 0
  const alive = weapon && w.aliveCount !== undefined ? tr('ui.battleCycles.019', { p1: w.aliveCount, p2: row.count }) : ''
  const target = !weapon && (d.targetName || d.targetTag) ? tr('ui.battleCycles.017', { p1: d.targetName || d.targetTag! }) : ''
  const slow = !weapon && d.kind === 'web' && d.effectPct !== undefined && Number.isFinite(d.effectPct)
    ? tr('ui.battleCycles.018', { p1: Math.round(d.effectPct * 10) / 10 }) : ''
  const count = alive || (row.count > 1 ? `×${row.count}` : '')
  const meters = (value: number): string => Number.isFinite(value) && value >= 0 ? value.toLocaleString() : '-'
  const range = weapon ? `${meters(w.minM)}~${meters(w.maxM)}m` : ''
  const detail = [`${ownerMark} ${row.ownerName}`, `${label}${count ? ` ${count}` : ''}`, range,
    `${tr('ui.battleCycles.003')}: ${cycle ? seconds(row.cycleMs) : '-'}`,
    `${tr('ui.battleCycles.004')}: ${timed ? seconds(row.remainingMs) : '-'}`,
    `${tr('ui.battleCycles.005')}: ${state}`, target, slow].filter(Boolean).join('\n')
  const tone = { '--bc-tone': weapon && w.damageType ? DMG_COLOR[w.damageType] : 'rgb(var(--wui-accent))' } as CSSProperties

  return <div className={`app-bts-reload app-bc-row is-${row.state}`} title={detail} aria-label={detail}
    tabIndex={0} role="group" data-cycle-id={row.id} data-owner-tag={row.ownerTag}
    data-ship-id={row.shipId} data-device-kind={!weapon ? d.kind : undefined} data-cycle-state={row.state}
    data-cycle-count={row.count} data-cycle-ms={row.cycleMs} data-remaining-ms={row.remainingMs}
    data-min-m={weapon ? w.minM : undefined} data-max-m={weapon ? w.maxM : undefined}
    data-battle-weapon-cycle={weapon ? row.id : undefined} data-battle-device-cycle={!weapon ? row.id : undefined}
    data-target-tag={!weapon ? d.targetTag : undefined} style={tone}>
    <i className="app-bts-reload-dot" aria-hidden="true" />
    {!weapon ? <span className="app-bc-owner-mark">{ownerMark}</span> : null}
    <span className="app-bts-reload-name app-bc-label">{label}</span>
    {weapon || count ? <span className="app-bc-count">{count}</span> : null}
    {weapon ? <span className="app-bc-range">{range}</span> : null}
    {track ? <span className="app-bts-reload-track" role="progressbar" aria-label={`${row.ownerName}: ${label}`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}
      aria-valuetext={timed ? `${state} · ${seconds(row.remainingMs)}` : state}>
      <i className="app-bts-reload-fill" style={{ width: `${percent}%` }} />
    </span> : <span className="app-bts-reload-track is-untimed" aria-hidden="true" />}
    <span className="app-bts-reload-ms">{timed ? `${track ? '' : `${state} · `}${seconds(row.remainingMs)}` : state}</span>
  </div>
}

/** 武器弹出列表不参与战场高度分配；装置只消费真实周期，不在页面重算机制。 */
export function BattleCycles({ weapons, devices }: BattleCyclesProps) {
  const [mode, setMode] = useState<OpenMode>('closed')
  const root = useRef<HTMLDivElement>(null)
  const scope = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const deviceScroll = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelId = useId()
  const open = mode !== 'closed'
  const weaponGroups = ownerGroups(weapons)
  const ownerMarks = new Map([...new Set([...weapons, ...devices].map(row => row.ownerTag))].map((tag, index) => [tag, `#${index + 1}`]))
  const hasDevices = devices.length > 0

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
    const host = deviceScroll.current
    if (!host) return
    const wheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.metaKey || host.scrollWidth <= host.clientWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!Number.isFinite(delta) || delta === 0) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientWidth : 1
      host.scrollLeft += delta * unit
      event.preventDefault()
      event.stopPropagation()
    }
    let touch: { id: number; x: number; y: number; left: number; inverse: DOMMatrix } | null = null
    const start = (event: TouchEvent): void => {
      if (event.touches.length !== 1) { touch = null; return }
      const point = event.touches[0]!
      const app = host.closest<HTMLElement>('.app-root')
      touch = { id: point.identifier, x: point.clientX, y: point.clientY, left: host.scrollLeft,
        inverse: new DOMMatrix(app ? getComputedStyle(app).transform : undefined).inverse() }
    }
    const move = (event: TouchEvent): void => {
      if (!touch || event.touches.length !== 1) return
      const point = [...event.touches].find(item => item.identifier === touch!.id)
      if (!point) return
      // 手机外层旋转，手指位移先还原为逻辑横轴，不能交给物理轴原生滚动。
      const delta = touch.inverse.a * (point.clientX - touch.x) + touch.inverse.c * (point.clientY - touch.y)
      if (Math.abs(delta) < 3) return
      host.scrollLeft = touch.left - delta
      event.preventDefault()
      event.stopPropagation()
    }
    const end = (): void => { touch = null }
    // 原生非被动监听才能把鼠标纵向滚轮可靠地留在这一行内。
    host.addEventListener('wheel', wheel, { passive: false })
    host.addEventListener('touchstart', start, { passive: true })
    host.addEventListener('touchmove', move, { passive: false })
    host.addEventListener('touchend', end)
    host.addEventListener('touchcancel', end)
    return () => {
      host.removeEventListener('wheel', wheel)
      host.removeEventListener('touchstart', start)
      host.removeEventListener('touchmove', move)
      host.removeEventListener('touchend', end)
      host.removeEventListener('touchcancel', end)
    }
  }, [hasDevices])
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
      for (const [key, value] of [['--bc-popup-height', `${popupHeight}px`], ['--bc-popup-top', `${button.offsetHeight}px`]]) {
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
        {weaponGroups.length ? weaponGroups.map(group => <section key={group.tag} className="app-bc-group" data-weapon-owner={group.tag}>
          <div className="app-bc-owner" title={group.name}>{ownerMarks.get(group.tag)} {group.name}</div>
          {group.rows.map(row => <CycleLine key={row.id} row={row} ownerMark={ownerMarks.get(row.ownerTag)!} weapon />)}
        </section>) : <div className="app-bc-empty">{tr('ui.battleCycles.020')}</div>}
      </div>
    </div>
    {hasDevices ? <div ref={deviceScroll} className="app-bc-device-scroll app-bts-reloads" tabIndex={0} role="region"
      aria-label={tr('ui.battleCycles.002')} onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const host = event.currentTarget
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          host.scrollLeft += event.key === 'ArrowLeft' ? -120 : 120
        } else if (event.key === 'Home') host.scrollLeft = 0
        else if (event.key === 'End') host.scrollLeft = host.scrollWidth - host.clientWidth
        else return
        event.preventDefault()
        event.stopPropagation()
      }}>
      {devices.map(row => <CycleLine key={row.id} row={row} ownerMark={ownerMarks.get(row.ownerTag)!} />)}
    </div> : null}
  </div>
}
