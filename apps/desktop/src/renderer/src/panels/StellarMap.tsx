import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import type { StellarSystem } from '@whale/core'
import { tr } from '../i18n/locale'
import { Glyph } from '../ui/Glyphs'
import {
  STELLAR_MAP_CENTER, STELLAR_ZOOM_MAX, STELLAR_ZOOM_MIN,
  beginStellarGesture, clampStellarView, inverseMapMatrix, locateStellarView, mapInverseScale, mapPointThrough,
  moveStellarGesture, nextStellarBodyId, reframeMapInverse, stellarBodyAt, stellarHitRadius, stellarOrdinalLabels, stellarViewBox, zoomStellarView,
  type MapMatrix, type MapPointer, type StellarGesture, type StellarMapView,
} from './stellarMapView'
import '../styles-stellar-map.css'

export interface StellarMapProps {
  system: StellarSystem
  selectedId?: string
  onSelect: (planetId: string) => void
}

interface MapSession extends StellarMapView { selectedId?: string }
const sessions = new Map<string, MapSession>()
const fitView = (): StellarMapView => ({ zoom: 1, pan: { x: 0, y: 0 } })
type Body = StellarSystem['bodies'][number]
const bodyName = (body: Body): string => `${tr('ui.stellar.056')} ${body.ordinal}`

function initialSession(system: StellarSystem, selectedId?: string): MapSession {
  const stored = sessions.get(system.id)
  const requested = system.bodies.some(body => body.planetId === selectedId) ? selectedId : stored?.selectedId
  return { ...clampStellarView(stored ?? fitView()),
    selectedId: system.bodies.some(body => body.planetId === requested) ? requested : undefined }
}

function screenInverse(svg: SVGSVGElement): MapMatrix | null {
  const matrix = svg.getScreenCTM()
  if (!matrix || !inverseMapMatrix(matrix)) return null
  return matrix.inverse()
}

function StellarMapViewport({ system, selectedId, onSelect }: StellarMapProps) {
  const [session, setSession] = useState(() => initialSession(system, selectedId))
  const current = useRef(session)
  const svgRef = useRef<SVGSVGElement>(null)
  const pointers = useRef(new Map<number, MapPointer>())
  const gesture = useRef<StellarGesture | null>(null)
  const pressedBody = useRef<string | undefined>()
  const handledPointerClick = useRef(false)
  const [panning, setPanning] = useState(false)
  const [metrics, setMetrics] = useState({ hit: 20, unit: 1 })
  const refreshMetrics = useRef<() => void>(() => {})
  const selected = system.bodies.find(body => body.planetId === session.selectedId)
  const box = stellarViewBox(session)
  const renderedBox = useRef(box)

  useLayoutEffect(() => { renderedBox.current = box })

  useLayoutEffect(() => {
    sessions.set(system.id, current.current)
    const restored = current.current.selectedId
    if (restored && !system.bodies.some(body => body.planetId === selectedId)) onSelect(restored)
  }, [])

  function commit(next: MapSession): void {
    const value = { ...next, ...clampStellarView(next) }
    current.current = value
    sessions.set(system.id, value)
    setSession(value)
  }

  useLayoutEffect(() => {
    if (selectedId !== undefined && system.bodies.some(body => body.planetId === selectedId)
      && selectedId !== current.current.selectedId) {
      commit({ ...current.current, selectedId })
    }
  }, [selectedId, system.bodies])

  useLayoutEffect(() => {
    if (current.current.selectedId && !system.bodies.some(body => body.planetId === current.current.selectedId)) {
      commit({ ...current.current, selectedId: undefined })
    }
  }, [system.bodies])

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = (): void => {
      const inverse = screenInverse(svg)
      const local = svg.getCTM()
      if (!inverse) return
      const logicalInverse = local ? inverseMapMatrix(local) : null
      const hit = stellarHitRadius(inverse, logicalInverse)
      const unit = Math.max(mapInverseScale(inverse), logicalInverse ? mapInverseScale(logicalInverse) : 0)
      setMetrics(old => Math.abs(old.hit - hit) < 0.01 && Math.abs(old.unit - unit) < 0.001 ? old : { hit, unit })
    }
    refreshMetrics.current = measure
    measure()
    const layoutChanged = (): void => {
      measure()
      if (pointers.current.size) rebase(svg, gesture.current?.moved ?? false)
    }
    const observer = new ResizeObserver(layoutChanged)
    observer.observe(svg)
    const root = svg.closest('.app-root')
    const mutations = new MutationObserver(layoutChanged)
    if (root) mutations.observe(root, { attributes: true, attributeFilter: ['class', 'style'] })
    window.addEventListener('resize', layoutChanged)
    window.addEventListener('orientationchange', layoutChanged)
    return () => {
      observer.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', layoutChanged)
      window.removeEventListener('orientationchange', layoutChanged)
    }
  }, [])

  useLayoutEffect(() => { refreshMetrics.current() }, [session.zoom, session.pan.x, session.pan.y])

  useLayoutEffect(() => () => {
    const svg = svgRef.current
    for (const id of pointers.current.keys()) {
      if (svg?.hasPointerCapture(id)) svg.releasePointerCapture(id)
    }
    pointers.current.clear()
    gesture.current = null
  }, [])

  function select(id: string): void {
    if (!system.bodies.some(body => body.planetId === id)) return
    commit({ ...current.current, selectedId: id })
    onSelect(id)
  }

  function zoomBy(factor: number): void {
    const view = current.current
    const anchor = system.bodies.find(body => body.planetId === view.selectedId) ?? STELLAR_MAP_CENTER
    commit({ ...view, ...zoomStellarView(view, view.zoom * factor, anchor) })
  }

  function reset(): void { commit({ ...current.current, ...fitView() }) }
  function locate(id = current.current.selectedId): void {
    const body = system.bodies.find(candidate => candidate.planetId === id)
    if (body) commit({ ...current.current, ...locateStellarView(current.current, body) })
  }

  function rebase(svg: SVGSVGElement, moved: boolean): void {
    const inverse = screenInverse(svg)
    // pointerup 内的 setState 尚未提交到 SVG；把旧 CTM 转到当前视口再重建手势。
    const currentInverse = inverse ? reframeMapInverse(inverse, renderedBox.current, stellarViewBox(current.current)) : null
    gesture.current = currentInverse && pointers.current.size
      ? beginStellarGesture([...pointers.current.values()], current.current, currentInverse, moved) : null
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const inverse = screenInverse(event.currentTarget)
    if (!inverse) return
    event.preventDefault()
    if (!pointers.current.size) {
      handledPointerClick.current = false
      // 透明命中圆可能重叠；按最近的世界坐标选取，不按 SVG 后绘制者优先。
      const local = event.currentTarget.getCTM()
      const radius = stellarHitRadius(inverse, local ? inverseMapMatrix(local) : null)
      pressedBody.current = stellarBodyAt(system.bodies.map(body => ({ ...body, radius: body.kind === 'gas' ? 13 : 10 })),
        mapPointThrough({ x: event.clientX, y: event.clientY }, inverse), radius)
      event.currentTarget.focus({ preventScroll: true })
    }
    const moved = gesture.current?.moved ?? false
    pointers.current.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY })
    // 捕获从按下开始；单击在 pointerup 内处理，避免捕获改变 click 的目标。
    event.currentTarget.setPointerCapture(event.pointerId)
    rebase(event.currentTarget, moved)
    if (pointers.current.size > 1) {
      pressedBody.current = undefined
      setPanning(true)
    }
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>): void {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return
    pointers.current.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY })
    const result = moveStellarGesture(gesture.current, [...pointers.current.values()])
    gesture.current.moved = result.moved
    if (!result.moved) return
    event.preventDefault()
    handledPointerClick.current = true
    setPanning(true)
    commit({ ...current.current, ...result.view })
  }

  function pointerEnd(event: PointerEvent<SVGSVGElement>, cancelled = false): void {
    if (!pointers.current.has(event.pointerId)) return
    if (!cancelled) pointerMove(event)
    const moved = cancelled || (gesture.current?.moved ?? false)
    const id = pressedBody.current
    pointers.current.delete(event.pointerId)
    handledPointerClick.current = true
    pressedBody.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    // 减指后以当前视口、剩余手指和新逆矩阵重建起点，不沿用双指的旧距离。
    rebase(event.currentTarget, moved)
    setPanning(pointers.current.size > 0 && moved)
    if (!moved && !pointers.current.size && id) select(id)
  }

  function keyDown(event: KeyboardEvent<SVGSVGElement>): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const targetId = (event.target as Element).closest('[data-stellar-body]')?.getAttribute('data-stellar-body')
    switch (event.key) {
      case 'ArrowRight': case 'ArrowDown': case 'ArrowLeft': case 'ArrowUp': {
        const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
        const id = nextStellarBodyId(system.bodies, targetId ?? current.current.selectedId, direction)
        if (id) { select(id); locate(id) }
        // 焦点留在星图，后续方向键使用刚选中的编号。
        event.currentTarget.focus({ preventScroll: true })
        break
      }
      case '+': case '=': zoomBy(1.25); break
      case '-': case '_': zoomBy(1 / 1.25); break
      case 'Home': reset(); break
      case 'Enter': case ' ': {
        const id = targetId ?? current.current.selectedId
        if (id) select(id)
        break
      }
      default: return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      if (!event.deltaY || pointers.current.size) return
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1)
      zoomBy(Math.exp(-Math.max(-120, Math.min(120, pixels)) * 0.002))
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [system.bodies])

  const labels = stellarOrdinalLabels(system.bodies.map(body => ({ ...body,
    radius: body.planetId === session.selectedId ? Math.max(18, metrics.hit * 0.65) : body.kind === 'gas' ? 17 : 10,
  })), box, metrics.unit, session.selectedId, system.kind === 'rogue' ? [] : system.stars)

  return <div className="app-stellar-map" data-stellar-system={system.id}>
    <div className="app-stellar-map-bar">
      <span className="app-stellar-map-heading"><Glyph name="nav-map" size={18} />{tr('ui.stellar.054')}</span>
      <div className="app-map-zoom app-stellar-map-tools" role="group" aria-label={tr('ui.stellar.054')}>
        <button type="button" className="app-map-zoom-btn app-stellar-map-tool" disabled={session.zoom >= STELLAR_ZOOM_MAX}
          aria-label={tr('ui.stellar.050')} title={tr('ui.stellar.050')} onClick={() => zoomBy(1.25)}>
          <ZoomIn size={20} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <span className="app-map-zoom-val app-stellar-map-percent">{Math.round(session.zoom * 100)}%</span>
        <button type="button" className="app-map-zoom-btn app-stellar-map-tool" disabled={session.zoom <= STELLAR_ZOOM_MIN}
          aria-label={tr('ui.stellar.051')} title={tr('ui.stellar.051')} onClick={() => zoomBy(1 / 1.25)}>
          <ZoomOut size={20} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <button type="button" className="app-map-zoom-btn app-stellar-map-tool"
          aria-label={tr('ui.stellar.052')} title={tr('ui.stellar.052')} onClick={reset}><Glyph name="ico-scan" size={20} /></button>
        <button type="button" className="app-map-zoom-btn app-stellar-map-tool" disabled={!selected}
          aria-label={tr('ui.stellar.053')} title={tr('ui.stellar.053')} onClick={() => locate()}><Glyph name="target-lock" size={20} /></button>
      </div>
      <span className="app-stellar-map-selected" aria-live="polite" aria-atomic="true">
        {selected ? <><strong>{bodyName(selected)}</strong><span className="app-dim">
          {tr(selected.kind === 'gas' ? 'ui.stellar.057' : 'ui.stellar.058')}</span></> : tr('ui.stellar.055')}
      </span>
    </div>
    <div className="app-stellar-map-frame">
      <svg ref={svgRef} className={`app-stellar-map-svg${panning ? ' is-panning' : ''}`}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} preserveAspectRatio="xMidYMid meet"
        role="group" aria-label={tr('ui.stellar.054')} tabIndex={0} onKeyDown={keyDown}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerEnd(event)}
        onPointerCancel={event => pointerEnd(event, true)} onLostPointerCapture={event => pointerEnd(event, true)}
        onClickCapture={event => {
          if (handledPointerClick.current) { event.preventDefault(); event.stopPropagation() }
        }}>
        <g className="app-stellar-map-orbits" aria-hidden="true">
          {system.kind !== 'rogue' && [...new Set(system.bodies.map(body => body.orbit))].map(orbit =>
            <circle key={orbit} cx={500} cy={350} r={orbit} />)}
        </g>
        <g className={`app-stellar-map-stars is-${system.kind} is-star-${system.starClass}`} aria-hidden="true">
          {system.kind !== 'rogue' && system.stars.map((star, index) =>
            <g key={index} transform={`translate(${star.x} ${star.y})`}>
              {system.kind === 'black-hole' ? <>
                <ellipse className="app-stellar-map-accretion" rx={star.radius * 2.2} ry={star.radius * 0.75} transform="rotate(-25)" />
                <circle className="app-stellar-map-horizon" r={star.radius} />
                <circle className="app-stellar-map-star-ring" r={star.radius * 1.3} />
              </> : system.kind === 'neutron' ? <>
                <path className="app-stellar-map-beam" d={`M0 ${-star.radius * 4}V${star.radius * 4}`} transform="rotate(-25)" />
                <circle className="app-stellar-map-star-ring" r={star.radius * 1.8} />
                <circle className="app-stellar-map-star" r={star.radius} />
              </> : <>
                <circle className="app-stellar-map-star-ring" r={star.radius * 1.4} />
                <circle className="app-stellar-map-star" r={star.radius} />
                <path d={`M${-star.radius * 0.5} 0H${star.radius * 0.5}M0 ${-star.radius * 0.5}V${star.radius * 0.5}`} />
              </>}
            </g>)}
        </g>
        {system.bodies.map(body => {
          const active = body.planetId === session.selectedId
          const radius = body.kind === 'gas' ? 13 : 10
          return <g key={body.planetId} className={`app-map-node app-stellar-map-body${active ? ' is-selected' : ''}${body.kind === 'gas' ? ' is-gas' : ''}`}
            transform={`translate(${body.x} ${body.y})`} data-stellar-body={body.planetId}
            role="button" tabIndex={0} aria-label={`${bodyName(body)}, ${tr(body.kind === 'gas' ? 'ui.stellar.057' : 'ui.stellar.058')}`}
            aria-pressed={active} data-tip={bodyName(body)}
            onClick={() => { if (!handledPointerClick.current) select(body.planetId) }}>
            <circle className={`app-map-dot app-stellar-map-planet${active ? ' is-sel' : ''}`} r={radius} />
            {body.kind === 'gas' ? <ellipse className="app-stellar-map-gas-ring" rx={21} ry={7} transform="rotate(-25)" />
              : <path className="app-stellar-map-solid-mark" d="M-4 3L0-4L4 3Z" />}
            <circle className="app-stellar-map-selection" r={Math.max(18, metrics.hit * 0.65)} />
            <circle className="app-map-hit app-stellar-map-hit" r={Math.max(metrics.hit, radius)} />
          </g>
        })}
        <g className="app-stellar-map-labels" aria-hidden="true">
          {labels.map(label => <text key={label.planetId} x={label.x + label.width / 2} y={label.y + label.height * 0.75}
            textAnchor="middle" className={`app-map-label${label.planetId === session.selectedId ? ' is-sel' : ''}`}
            style={{ fontSize: 13 * metrics.unit }}>#{system.bodies.find(body => body.planetId === label.planetId)!.ordinal}</text>)}
        </g>
      </svg>
    </div>
  </div>
}

// 按星系重建手势局部状态；会话视口仍由模块内 Map 保留，卸载面板后也可恢复。
export function StellarMap(props: StellarMapProps) {
  return <StellarMapViewport key={props.system.id} {...props} />
}
