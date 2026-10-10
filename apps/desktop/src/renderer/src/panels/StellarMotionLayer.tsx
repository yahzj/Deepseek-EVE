import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { StellarBody, StellarSystem } from '@whale/core'
import { stellarDynamicBody, stellarMotionBodies, stellarMotionStars, stellarIllumination, stellarMotionSession, advanceStellarMotion, notifyStellarMotion } from './stellarMotion'
import { createStellarPlanetRenderer, stellarMaterialSpan, stellarStarSpan, stellarTextureSize } from '../ui/stellarPlanetShader'
import { stellarSceneProjection } from './stellarSceneDraw'
import { stellarViewBox, stellarOrdinalLabels, type StellarMapView } from './stellarMapView'

export function StellarMotionLayer({ system, view, selectedId, svg, radiusOf, unit, onReady }: {
  system: StellarSystem; view: StellarMapView; selectedId?: string; svg: RefObject<SVGSVGElement>
  radiusOf: (body: StellarBody, bodies: StellarBody[]) => number; unit: number; onReady: (ready: boolean) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const repaint = useRef<() => void>(() => {})
  const latest = useRef({ system, view, selectedId, radiusOf, unit, onReady })
  latest.current = { system, view, selectedId, radiusOf, unit, onReady }
  useLayoutEffect(() => {
    const surface = canvas.current
    if (!surface) return
    const session = stellarMotionSession(system.id)
    const tile = document.createElement('canvas')
    const textures = new Map<string, { time: number; image: HTMLCanvasElement }>()
    let renderer = surface.getContext('2d') ? createStellarPlanetRenderer(tile) : null
    let alive = true, frame = 0, last = performance.now(), painted = -1, dirty = true
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const mode = () => { session.reduced = media.matches; dirty = true }
    mode(); media.addEventListener('change', mode)
    const ready = () => { textures.clear(); session.gpuReady = !!renderer; latest.current.onReady(!!renderer); dirty = true; notifyStellarMotion(session) }
    const lost = (event: Event) => { event.preventDefault(); renderer?.dispose(); renderer = null; ready() }
    const restored = () => { renderer = createStellarPlanetRenderer(tile); ready() }
    tile.addEventListener('webglcontextlost', lost); tile.addEventListener('webglcontextrestored', restored)
    const wake = () => { dirty = true; last = performance.now(); if (document.hidden) cancelAnimationFrame(frame); else { cancelAnimationFrame(frame); frame = requestAnimationFrame(tick) } }
    // 暂停/拖动时世界相位不变，只重新投影缓存帧，不重复GPU纹理计算。
    const texture = (key: string, pixels: number, render: (pixels:number) => void): HTMLCanvasElement => {
      let entry = textures.get(key)
      if (!entry) {
        const image = document.createElement('canvas')
        entry = { time: -1, image }; textures.set(key, entry)
      }
      if (entry.time !== session.elapsedMs || entry.image.width !== pixels) {
        // 共享WebGL缓冲仅扩容，每颗只绘制所需小视口，避免轮换尺寸反复分配。
        if (tile.width < pixels || tile.height < pixels) { tile.width = pixels; tile.height = pixels }
        render(pixels)
        if(entry.image.width!==pixels||entry.image.height!==pixels){entry.image.width = pixels; entry.image.height = pixels}
        const target = entry.image.getContext('2d')!
        target.clearRect(0,0,entry.image.width,entry.image.height); target.drawImage(tile,0,0,pixels,pixels,0,0,pixels,pixels)
        entry.time = session.elapsedMs
      }
      return entry.image
    }
    const draw = () => {
      const { system: value, view: viewport, selectedId: selected, radiusOf: radius, unit: labelUnit } = latest.current
      const bodies = stellarMotionBodies(value, session.elapsedMs)
      const stars = stellarMotionStars(value, session.elapsedMs)
      const width = surface.clientWidth, height = surface.clientHeight, ratio = Math.min(2, window.devicePixelRatio || 1)
      if (!width || !height) return
      if (surface.width !== Math.round(width * ratio) || surface.height !== Math.round(height * ratio)) { surface.width = Math.round(width * ratio); surface.height = Math.round(height * ratio) }
      const ctx = surface.getContext('2d')
      if (!ctx) return
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height)
      const projection = stellarSceneProjection(viewport, width, height)
      if (renderer) for (let index = 0; index < stars.length; index++) {
        const star = stars[index]!
        const nearest = Math.min(...stars.filter(other => other !== star).map(other => Math.hypot(other.x-star.x,other.y-star.y)))
        const r = Math.min(Math.max(star.radius, (value.kind === 'neutron' ? 10 : 15) / projection.scale),nearest*.42)*projection.scale
        const x = star.x*projection.scale+projection.x, y = star.y*projection.scale+projection.y
        const span = stellarStarSpan()
        const image = texture(`star:${index}`, stellarTextureSize(r * 2 * ratio, span), pixels => renderer!.drawStar(session.elapsedMs, value.seed+index*97,value.starClass,pixels))
        ctx.imageSmoothingEnabled = true
        const size = r * 2 * span
        ctx.drawImage(image,x-size/2,y-size/2,size,size)
        if (value.kind === 'neutron') {
          ctx.save();ctx.translate(x,y);ctx.rotate(session.elapsedMs/120000*Math.PI*2)
          ctx.strokeStyle = `rgb(${getComputedStyle(surface).getPropertyValue('--wui-accent').trim()})`;ctx.globalAlpha=.55;ctx.lineWidth=1.5
          ctx.beginPath();ctx.moveTo(0,-r*5);ctx.lineTo(0,r*5);ctx.stroke();ctx.restore()
        }
      }
      for (const body of bodies) {
        const r = radius(body, bodies)
        const node = svg.current?.querySelector<SVGGElement>(`[data-stellar-body="${body.planetId}"]`)
        node?.setAttribute('transform', `translate(${body.x} ${body.y})`)
        node?.querySelector('[data-stellar-art-scale]')?.setAttribute('transform', `scale(${r / 10})`)
        node?.querySelector('.app-stellar-map-selection')?.setAttribute('r', String(Math.max(r + 5, labelUnit * 13)))
        node?.querySelector('.app-stellar-map-hit')?.setAttribute('r', String(Math.max(r, labelUnit * 20)))
        node?.querySelector('.app-stellar-map-state')?.setAttribute('transform', `translate(${r - 10} ${10 - r})`)
        if (renderer && stellarDynamicBody(value, body)) {
          const span = stellarMaterialSpan(body.kind)
          const image = texture(body.planetId, stellarTextureSize(r * 2 * projection.scale * ratio, span), pixels => renderer!.drawPlanet(stellarIllumination(value,body,session.elapsedMs), session.elapsedMs, value.seed + body.ordinal * 127, body.kind,pixels))
          const size = r * 2 * projection.scale * span
          ctx.imageSmoothingEnabled = true
          ctx.drawImage(image, body.x * projection.scale + projection.x - size / 2, body.y * projection.scale + projection.y - size / 2, size, size)
        }
      }
      const labels = stellarOrdinalLabels(bodies.map(body => ({ ...body, radius: Math.max(radius(body, bodies) * Math.max(1.15,stellarMaterialSpan(body.kind)), body.planetId === selected ? labelUnit * 13 : 0) })), stellarViewBox(viewport), labelUnit, selected, stars)
      for (const label of labels) {
        const node = svg.current?.querySelector(`[data-stellar-label="${label.planetId}"]`)
        node?.setAttribute('x', String(label.x + label.width / 2)); node?.setAttribute('y', String(label.y + label.height * .75))
      }
      surface.dataset.motionMs = String(session.elapsedMs)
      surface.dataset.renderMode = renderer ? 'dynamic' : 'static'
      surface.dataset.renderedView = `${viewport.zoom},${viewport.pan.x},${viewport.pan.y}`
      surface.dataset.starPositions = JSON.stringify(stars.map(star => [star.x,star.y]))
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
    const refresh = () => { dirty = true; if (alive && !document.hidden) { draw(); dirty = false } }
    repaint.current = refresh
    session.listeners.add(refresh)
    ready(); frame = requestAnimationFrame(tick)
    const sizes = new ResizeObserver(refresh); sizes.observe(surface)
    document.addEventListener('visibilitychange', wake)
    return () => {
      alive = false; cancelAnimationFrame(frame); renderer?.dispose(); sizes.disconnect()
      textures.clear()
      repaint.current = () => {}
      session.listeners.delete(refresh); session.gpuReady = false; session.holds.clear(); notifyStellarMotion(session)
      media.removeEventListener('change', mode); document.removeEventListener('visibilitychange', wake)
      tile.removeEventListener('webglcontextlost', lost); tile.removeEventListener('webglcontextrestored', restored)
    }
  }, [system.id])
  useLayoutEffect(() => { repaint.current() }, [view.zoom, view.pan.x, view.pan.y, selectedId, unit, radiusOf])
  return <canvas className="app-stellar-motion-layer" ref={canvas} aria-hidden="true" />
}
