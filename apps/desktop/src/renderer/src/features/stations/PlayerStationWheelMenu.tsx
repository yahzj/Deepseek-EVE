import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Hammer, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { hideTip, hoverTipProps } from '../../ui/Tooltip'
import { tooltipLayout } from '../../ui/tooltipGeometry'

export type StationInputMode = 'mouse' | 'keyboard' | 'touch'
export type StationWheelSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
export interface StationWheelOption {
  id: string
  slot: StationWheelSlot
  name: string
  buildLabel: string
  Icon: LucideIcon
  details: ReactNode
  unavailable?: string
  tone?: 'amber' | 'green' | 'blue'
}

interface MenuProps {
  options: readonly StationWheelOption[]
  anchor: HTMLButtonElement
  inputMode: StationInputMode
  title: string
  groupLabel: string
  detailLabel: string
  closeLabel: string
  onBuild(id: string): void
  onClose(): void
}

// 建筑选择优先，中央仅关闭；尺寸与颜色沿用站点令牌，详情不挤入圆心。
const DETAIL_RESERVE = 400

function outsidePoint(event: MouseEvent<Element>, popup: HTMLElement | null) {
  if (!popup) return event
  const rect = popup.getBoundingClientRect()
  const bounds = { bw: window.innerWidth, bh: window.innerHeight, rot: false }
  const offset = tooltipLayout(bounds, { x: 0, y: 0 })
  const left = rect.right + DETAIL_RESERVE <= bounds.bw ? rect.right : Math.max(8, rect.left - DETAIL_RESERVE)
  return { ...event, currentTarget: event.currentTarget, target: event.target, clientX: left - offset.x, clientY: rect.top + rect.height / 2 }
}

function WheelOption({ option, mode, popup, selected, inlineDetails, onPreview, onFocus, onSelect }: {
  option: StationWheelOption
  mode: RefObject<StationInputMode>
  popup: RefObject<HTMLDivElement>
  selected: boolean
  inlineDetails: boolean
  onPreview(): void
  onFocus(): void
  onSelect(): void
}) {
  const tip = useMemo(() => hoverTipProps(<>{option.details}
    {option.unavailable && <p className="app-player-station-notice is-missing">{option.unavailable}</p>}
  </>), [option.details, option.unavailable])
  useEffect(() => () => tip.onMouseLeave(), [tip])
  function preview(event: MouseEvent<Element>, entering: boolean) {
    if (mode.current === 'touch') return
    if (inlineDetails || window.innerWidth < 760) { tip.onMouseLeave(); onPreview(); return }
    if (entering) tip.onMouseEnter(outsidePoint(event, popup.current))
    else tip.onMouseMove(outsidePoint(event, popup.current))
  }
  const Icon = option.Icon
  return <button type="button" data-facility={option.id} data-wheel-slot={option.slot}
    className={`app-btn app-player-station-wheel-option${selected ? ' is-selected' : ''}${option.tone ? ` is-${option.tone}` : ''}`}
    aria-label={option.buildLabel} aria-disabled={!!option.unavailable} {...tip}
    onMouseEnter={(event) => preview(event, true)} onMouseMove={(event) => preview(event, false)}
    onFocus={onFocus} onClick={onSelect}>
    <Icon size={22} aria-hidden="true" /><span>{option.name}</span>
  </button>
}

export function PlayerStationWheelMenu({ options, anchor, inputMode, title, groupLabel, detailLabel, closeLabel, onBuild, onClose }: MenuProps) {
  const popup = useRef<HTMLDivElement>(null)
  const mode = useRef(inputMode)
  const ordered = [...options].sort((a, b) => a.slot - b.slot)
  const [detailId, setDetailId] = useState<string | null>(inputMode === 'keyboard' ? ordered[0]?.id ?? null : null)
  const detail = options.find((option) => option.id === detailId)
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false })
  const id = useId()

  const place = useCallback(() => {
    if (!popup.current) return
    const rect = anchor.getBoundingClientRect()
    const box = popup.current.getBoundingClientRect()
    const viewport = window.visualViewport
    const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
    const gap = 8
    const preferred = rect.right + gap + box.width <= x + width - gap ? rect.right + gap : rect.left - box.width - gap
    let left = Math.max(x + gap, Math.min(preferred, x + width - box.width - gap))
    // 宽窗为统一悬停层留出一侧；不因建筑位于不同方位而旋转轮盘。
    if (width >= box.width + DETAIL_RESERVE + gap * 2
      && left - x < DETAIL_RESERVE && x + width - left - box.width < DETAIL_RESERVE) left = x + gap
    const top = Math.max(y + gap, Math.min(rect.top, y + height - box.height - gap))
    setPosition((previous) => previous.ready && previous.left === left && previous.top === top ? previous : { left, top, ready: true })
  }, [anchor])

  useLayoutEffect(() => {
    place()
    const observer = new ResizeObserver(place)
    if (popup.current) observer.observe(popup.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [place])

  useLayoutEffect(() => {
    if (position.ready) popup.current?.querySelector<HTMLButtonElement>('[data-facility]')?.focus({ preventScroll: true })
  }, [position.ready])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target)) {
        event.preventDefault()
        onClose()
      }
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab' && !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      mode.current = 'keyboard'
      hideTip()
      const choices = [...(popup.current?.querySelectorAll<HTMLButtonElement>('[data-facility]') ?? [])]
      event.preventDefault()
      if (event.key === 'Tab') {
        const buttons = [...(popup.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus({ preventScroll: true })
      } else {
        const index = choices.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
          : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length
        choices[next]?.focus({ preventScroll: true })
      }
      const focused = choices.find((button) => button === document.activeElement)
      if (focused) setDetailId(focused.dataset.facility ?? null)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', keyboard, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', keyboard, true)
      hideTip()
    }
  }, [onClose])

  function build(option: StationWheelOption) {
    if (option.unavailable) return
    onBuild(option.id)
    onClose()
  }

  return createPortal(<div ref={popup} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
    className={`app-player-station-wheel${detail ? ' has-detail' : ''}`}
    style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}
    onPointerDown={(event) => {
      mode.current = event.pointerType === 'touch' || event.pointerType === 'pen' ? 'touch' : 'mouse'
      if (mode.current === 'touch') hideTip()
    }} onPointerMove={(event) => { if (event.pointerType === 'mouse') mode.current = 'mouse' }}>
    <div className="app-player-station-wheel-ring" role="group" aria-label={groupLabel}>
      <div className="app-player-station-wheel-center">
        <h4 id={`${id}-title`} className="app-player-station-label">{title}</h4>
        <button type="button" className="app-btn app-player-station-icon-button" aria-label={closeLabel}
          title={closeLabel} onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      {ordered.map((option) => <WheelOption key={option.id} option={option} mode={mode} popup={popup}
        selected={detailId === option.id} inlineDetails={!!detail} onPreview={() => setDetailId(option.id)}
        onFocus={() => { if (mode.current === 'keyboard') setDetailId(option.id) }}
        onSelect={() => { if (mode.current === 'touch') setDetailId(option.id); else build(option) }} />)}
    </div>
    {detail && <section className="app-player-station-wheel-detail" aria-label={detailLabel}>
      <div className="app-player-station-wheel-detail-content">
        {detail.details}
        {detail.unavailable && <p className="app-player-station-notice is-missing">{detail.unavailable}</p>}
      </div>
      <button type="button" className="app-btn is-primary" aria-disabled={!!detail.unavailable} onClick={() => build(detail)}>
        <Hammer size={15} aria-hidden="true" />{detail.buildLabel}
      </button>
    </section>}
  </div>, document.body)
}
