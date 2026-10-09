import type { StellarSystem } from '@whale/core'
import type { StellarMapView } from './stellarMapView'
import { stellarViewBox, STELLAR_MAP_CENTER } from './stellarMapView'

export function stellarSceneProjection(view: StellarMapView, width: number, height: number) {
  const box = stellarViewBox(view)
  const scale = Math.min(width / box.width, height / box.height)
  return { scale, x: (width - box.width * scale) / 2 - box.x * scale,
    y: (height - box.height * scale) / 2 - box.y * scale }
}

interface SceneColors { background: string; star: string; orbit: string; accent: string; text: string }
/** 场景只读公开坐标/类型；不依赖引擎随机数、资源或勘探真值。 */
export function drawStellarScene(context: CanvasRenderingContext2D, system: StellarSystem, view: StellarMapView,
  selectedId: string | undefined, width: number, height: number, colors: SceneColors,
  texture?: HTMLImageElement, star?: { image: HTMLImageElement; span: number }) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = colors.background
  context.fillRect(0, 0, width, height)
  if (texture) {
    context.globalAlpha = .12
    const scale = Math.max(width / texture.width, height / texture.height)
    context.drawImage(texture, (width - texture.width * scale) / 2, (height - texture.height * scale) / 2, texture.width * scale, texture.height * scale)
    context.globalAlpha = 1
  }
  // 固定稀疏星点只作远景，不生成任何可交互天体。
  context.fillStyle = colors.text
  for (let i = 0; i < 74; i++) {
    const x = ((i * 317 + system.seed % 997) % 1009) / 1009 * width
    const y = ((i * 173 + system.seed % 613) % 709) / 709 * height
    context.globalAlpha = i % 7 === 0 ? .42 : .18
    context.fillRect(x, y, i % 7 === 0 ? 1.6 : .8, i % 7 === 0 ? 1.6 : .8)
  }
  context.globalAlpha = 1
  const transform = stellarSceneProjection(view, width, height)
  context.save()
  context.translate(transform.x, transform.y)
  context.scale(transform.scale, transform.scale)
  const unit = 1 / transform.scale
  if (system.kind !== 'rogue') {
    const selectedOrbit = system.bodies.find(body => body.planetId === selectedId)?.orbit
    for (const orbit of new Set(system.bodies.map(body => body.orbit))) {
      const active = orbit === selectedOrbit
      context.strokeStyle = active ? colors.accent : colors.orbit
      context.globalAlpha = active ? .10 : .07
      context.lineWidth = (active ? 10 : 6) * unit
      context.beginPath(); context.arc(STELLAR_MAP_CENTER.x, STELLAR_MAP_CENTER.y, orbit, 0, Math.PI * 2); context.stroke()
      context.globalAlpha = active ? .58 : .34
      context.lineWidth = unit
      context.beginPath(); context.arc(500, 350, orbit, 0, Math.PI * 2); context.stroke()
      context.globalAlpha = active ? .28 : .12
      context.lineWidth = unit
      for (let index = 0; index < 36; index++) {
        const angle = index * Math.PI / 18
        const length = (index % 3 === 0 ? 5 : 2.5) * unit
        context.beginPath(); context.moveTo(500 + Math.cos(angle) * (orbit - length), 350 + Math.sin(angle) * (orbit - length))
        context.lineTo(500 + Math.cos(angle) * (orbit + length), 350 + Math.sin(angle) * (orbit + length)); context.stroke()
      }
      context.strokeStyle = active ? colors.accent : colors.star
      context.globalAlpha = active ? .82 : .20
      context.lineWidth = (active ? 2 : 1.5) * unit
      context.beginPath(); context.arc(500, 350, orbit, -Math.PI * .86, -Math.PI * .44); context.stroke()
    }
    context.globalAlpha = 1
    for (const body of system.stars) {
      context.save(); context.translate(body.x, body.y)
      const nearest = Math.min(...system.stars.filter(other => other !== body).map(other => Math.hypot(other.x - body.x, other.y - body.y)))
      const radius = Math.min(Math.max(body.radius, (system.kind === 'neutron' ? 10 : 15) * unit), nearest * .42)
      // 只围绕真实恒星位置画短放射照明，不铺装饰光球。
      context.strokeStyle = colors.star
      for (let ray = 0; ray < 24; ray++) {
        const angle = ray * Math.PI / 12
        context.globalAlpha = .10
        context.lineWidth = (ray % 3 === 0 ? 3 : 1) * unit
        context.beginPath(); context.moveTo(Math.cos(angle) * radius * 1.2, Math.sin(angle) * radius * 1.2)
        context.lineTo(Math.cos(angle) * radius * (ray % 3 === 0 ? 3 : 2.2), Math.sin(angle) * radius * (ray % 3 === 0 ? 3 : 2.2)); context.stroke()
      }
      context.globalAlpha = 1
      if (star) {
        const size = radius * 2 * star.span
        context.imageSmoothingEnabled = false
        context.drawImage(star.image, -size / 2, -size / 2, size, size)
      } else {
        context.fillStyle = colors.star
        context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.fill()
      }
      if (system.kind === 'neutron') {
        context.rotate(-.35); context.strokeStyle = colors.star; context.lineWidth = 2 * unit; context.globalAlpha = .7
        context.beginPath(); context.moveTo(0, -radius * 5); context.lineTo(0, radius * 5); context.stroke()
      }
      context.restore()
    }
  }
  context.restore()
  context.globalAlpha = 1
}
