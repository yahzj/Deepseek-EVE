import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { StellarBody, StellarSystem } from '@whale/core'
import { stellarDynamicBody, stellarMotionBodies, stellarMotionSession, stellarLightDirection, advanceStellarMotion, notifyStellarMotion } from './stellarMotion'
import { createStellarPlanetRenderer } from '../ui/stellarPlanetShader'
import { stellarSceneProjection } from './stellarSceneDraw'
import { stellarViewBox, stellarOrdinalLabels, type StellarMapView } from './stellarMapView'

export function StellarMotionLayer({ system, view, selectedId, svg, radiusOf, unit, onReady }: {
  system: StellarSystem; view: StellarMapView; selectedId?: string; svg: RefObject<SVGSVGElement>
  radiusOf: (body: StellarBody, bodies: StellarBody[]) => number; unit: number; onReady: (ready: boolean) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ system, view, selectedId, radiusOf, unit, onReady })
  latest.current = { system, view, selectedId, radiusOf, unit, onReady }
  useLayoutEffect(() => {
    const surface = canvas.current
    if (!surface) return
    const session = stellarMotionSession(system.id)
    const tile = document.createElement('canvas'); tile.width = 128; tile.height = 128
    let renderer = surface.getContext('2d') ? createStellarPlanetRenderer(tile) : null
    let alive = true, frame = 0, last = performance.now(), painted = -1, dirty = true
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const mode = () => { session.reduced = media.matches; dirty = true }
    mode(); media.addEventListener('change', mode)
    const ready = () => { session.gpuReady = !!renderer; latest.current.onReady(!!renderer); dirty = true; notifyStellarMotion(session) }
    const lost = (event: Event) => { event.preventDefault(); renderer?.dispose(); renderer = null; ready() }
    const restored = () => { renderer = createStellarPlanetRenderer(tile); ready() }
    tile.addEventListener('webglcontextlost', lost); tile.addEventListener('webglcontextrestored', restored)
    const wake = () => { dirty = true; last = performance.now(); if (document.hidden) cancelAnimationFrame(frame); else { cancelAnimationFrame(frame); frame = requestAnimationFrame(tick) } }
    const draw = () => {
      const { system: value, view: viewport, selectedId: selected, radiusOf: radius, unit: labelUnit } = latest.current
      const bodies = stellarMotionBodies(value, session.elapsedMs)
      const width = surface.clientWidth, height = surface.clientHeight, ratio = Math.min(2, window.devicePixelRatio || 1)
      if (!width || !height) return
      if (surface.width !== Math.round(width * ratio) || surface.height !== Math.round(height * ratio)) { surface.width = Math.round(width * ratio); surface.height = Math.round(height * ratio) }
      const ctx = surface.getContext('2d')
      if (!ctx) return
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height)
      const projection = stellarSceneProjection(viewport, width, height)
      for (const body of bodies) {
        const r = radius(body, bodies)
        const node = svg.current?.querySelector<SVGGElement>(`[data-stellar-body="${body.planetId}"]`)
        node?.setAttribute('transform', `translate(${body.x} ${body.y})`)
        node?.querySelector('[data-stellar-art-scale]')?.setAttribute('transform', `scale(${r / 10})`)
        node?.querySelector('.app-stellar-map-selection')?.setAttribute('r', String(Math.max(r + 5, labelUnit * 13)))
        node?.querySelector('.app-stellar-map-hit')?.setAttribute('r', String(Math.max(r, labelUnit * 20)))
        node?.querySelector('.app-stellar-map-state')?.setAttribute('transform', `translate(${r - 10} ${10 - r})`)
        if (renderer && stellarDynamicBody(value, body)) {
          renderer.draw(stellarLightDirection(value.stars[0]!, body), session.elapsedMs, value.seed + body.ordinal * 127, body.kind === 'ocean')
          const size = r * 2 * projection.scale
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(tile, body.x * projection.scale + projection.x - size / 2, body.y * projection.scale + projection.y - size / 2, size, size)
        }
      }
      const labels = stellarOrdinalLabels(bodies.map(body => ({ ...body, radius: Math.max(radius(body, bodies) * (body.kind === 'gas' ? 800 / 256 : 1.15), body.planetId === selected ? labelUnit * 13 : 0) })), stellarViewBox(viewport), labelUnit, selected, value.stars)
      for (const label of labels) {
        const node = svg.current?.querySelector(`[data-stellar-label="${label.planetId}"]`)
        node?.setAttribute('x', String(label.x + label.width / 2)); node?.setAttribute('y', String(label.y + label.height * .75))
      }
      surface.dataset.motionMs = String(session.elapsedMs)
      surface.dataset.renderMode = renderer ? 'dynamic' : 'static'
      for (const listener of session.listeners) if (listener !== refresh) listener()
    }
    function tick(now: number) {
      if (!alive || document.hidden) return
      if (now - painted >= 1000 / 30) {
        const delta = now - last; last = now
        const advanced = advanceStellarMotion(session, delta, now, !!surface?.getClientRects().length)
        if (advanced || dirty) { draw(); dirty = false }
        painted = now
      }
      frame = requestAnimationFrame(tick)
    }
    const refresh = () => { dirty = true }
    session.listeners.add(refresh)
    ready(); frame = requestAnimationFrame(tick)
    const sizes = new ResizeObserver(refresh); sizes.observe(surface)
    document.addEventListener('visibilitychange', wake)
    return () => {
      alive = false; cancelAnimationFrame(frame); renderer?.dispose(); sizes.disconnect()
      session.listeners.delete(refresh); session.gpuReady = false; session.holds.clear(); notifyStellarMotion(session)
      media.removeEventListener('change', mode); document.removeEventListener('visibilitychange', wake)
      tile.removeEventListener('webglcontextlost', lost); tile.removeEventListener('webglcontextrestored', restored)
    }
  }, [system.id])
  useLayoutEffect(() => { notifyStellarMotion(stellarMotionSession(system.id)) }, [view.zoom, view.pan.x, view.pan.y, selectedId, unit, radiusOf])
  return <canvas className="app-stellar-motion-layer" ref={canvas} aria-hidden="true" />
}
