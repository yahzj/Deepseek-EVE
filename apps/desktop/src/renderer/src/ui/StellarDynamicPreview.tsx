import { useLayoutEffect, useRef, useState } from 'react'
import type { StellarSystem } from '@whale/core'
import { stellarMotionSession, stellarMotionBodies, stellarIllumination } from '../panels/stellarMotion'
import { createStellarPlanetRenderer } from './stellarPlanetShader'
import { StellarPlanetPreview } from './stellarArt'
import { tr } from '../i18n/locale'

export function StellarDynamicPreview({ system, bodyId }: { system: StellarSystem; bodyId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(true)
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    let renderer = createStellarPlanetRenderer(element)
    const session = stellarMotionSession(system.id)
    let last = ''
    const draw = () => {
      setReady(!!renderer && session.gpuReady)
      if (document.hidden || !renderer) return
      const body = stellarMotionBodies(system, session.elapsedMs).find(value => value.planetId === bodyId)
      if (!body) return
      const key = String(session.elapsedMs)
      if (last === key) return
      last = key
      renderer.drawPlanet(stellarIllumination(system,body,session.elapsedMs), session.elapsedMs, system.seed + body.ordinal * 127, body.kind)
      element.dataset.motionMs = key
    }
    const lost = (event: Event) => { event.preventDefault(); renderer?.dispose(); renderer = null; setReady(false) }
    const restored = () => { renderer = createStellarPlanetRenderer(element); setReady(!!renderer); last = ''; draw() }
    setReady(!!renderer); draw(); session.listeners.add(draw)
    element.addEventListener('webglcontextlost', lost); element.addEventListener('webglcontextrestored', restored)
    return () => { renderer?.dispose(); session.listeners.delete(draw); element.removeEventListener('webglcontextlost', lost); element.removeEventListener('webglcontextrestored', restored) }
  }, [system, bodyId])
  const body = system.bodies.find(value => value.planetId === bodyId)!
  return <div className="app-stellar-dynamic-preview" title={!ready ? tr('ui.stellarMotion.001') : undefined}>
    <canvas ref={canvas} width={192} height={192} aria-hidden="true" data-dynamic-preview hidden={!ready} style={{ width: body.kind === 'gas' ? 116 : 96, height: body.kind === 'gas' ? 116 : 96 }} />
    {!ready ? <StellarPlanetPreview kind={body.kind} /> : null}
  </div>
}
