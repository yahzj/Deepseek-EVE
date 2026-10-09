import { useLayoutEffect, useRef } from 'react'
import type { StellarSystem } from '@whale/core'
import type { StellarMapView } from './stellarMapView'
import { drawStellarScene } from './stellarSceneDraw'
import { stellarStarAsset, STELLAR_ASSET_LICENSE_URL } from '../ui/stellarAssets'
import starfield from '../assets/space/starfield-06.jpg'

export function StellarScene({ system, view, selectedId }: { system: StellarSystem; view: StellarMapView; selectedId?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const current = useRef({ system, view, selectedId })
  current.current = { system, view, selectedId }
  const repaint = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    let alive = true, frame = 0
    const images = new Map<string, HTMLImageElement>()
    const failed = new Set<string>()
    const request = (url: string): HTMLImageElement | undefined => {
      if (failed.has(url)) return undefined
      let image = images.get(url)
      if (!image) {
        image = new Image(); images.set(url, image)
        image.onload = () => repaint.current()
        image.onerror = () => { failed.add(url); repaint.current() }
        image.src = url
      }
      return image.complete && image.naturalWidth > 0 ? image : undefined
    }
    const paint = () => {
      if (!alive) return
      const width = element.clientWidth, height = element.clientHeight
      if (!width || !height) return
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
        element.width = Math.round(width * ratio); element.height = Math.round(height * ratio)
      }
      const context = element.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const style = getComputedStyle(element)
      const color = (token: string) => `rgb(${style.getPropertyValue(token).trim()})`
      const { system: value, view: viewport, selectedId: selected } = current.current
      const asset = stellarStarAsset(value)
      const image = asset ? request(asset.url) : undefined
      drawStellarScene(context, value, viewport, selected, width, height, {
        background: color('--wui-bg-deep'), orbit: color('--wui-map-minor'), accent: color('--wui-accent'), text: color('--wui-text'),
        star: color(value.starClass === 'red' || value.starClass === 'orange' ? '--wui-danger-map' : value.starClass === 'blue' || value.starClass === 'neutron' ? '--wui-accent' : '--wui-gold'),
      }, request(starfield), image && asset ? { image, span: asset.span } : undefined)
      element.dataset.sceneReady = 'true'
      element.dataset.starReady = !asset ? 'none' : image ? 'loaded' : failed.has(asset.url) ? 'fallback' : 'loading'
    }
    repaint.current = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint) }
    repaint.current()
    const sizes = new ResizeObserver(() => repaint.current()); sizes.observe(element)
    const themes = new MutationObserver(() => repaint.current())
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => { alive = false; cancelAnimationFrame(frame); sizes.disconnect(); themes.disconnect(); for (const image of images.values()) { image.onload = null; image.onerror = null } }
  }, [])
  useLayoutEffect(() => { repaint.current() }, [system, view.zoom, view.pan.x, view.pan.y, selectedId])
  return <canvas className="app-stellar-scene" ref={canvas} aria-hidden="true" data-asset-license={STELLAR_ASSET_LICENSE_URL} />
}
