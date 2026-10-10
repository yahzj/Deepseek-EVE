import type { StellarBody, StellarSystem } from '@whale/core'
import { STELLAR_MAP_CENTER } from './stellarMapView'

export const STELLAR_SPIN_MS = 40000
export const STELLAR_INNER_ORBIT_MS = 180000
export const STELLAR_OUTER_ORBIT_MS = 480000
export const stellarDynamicBody = (_system: StellarSystem, _body: StellarBody): boolean => true
export const STELLAR_BINARY_ORBIT_MS = 120000
export const STELLAR_LIGHT_DISTANCE = 175

/** 公转仅表现，原坐标是初相位；相同会话时间给绘制/命中/详情同一个答案。 */
export function stellarMotionBodies(system: StellarSystem, elapsedMs: number): StellarBody[] {
  const orbits = system.bodies.map(body => body.orbit)
  const min = Math.min(...orbits), max = Math.max(...orbits)
  return system.bodies.map(body => {
    if (system.kind === 'rogue' || elapsedMs === 0) return body
    const period = STELLAR_INNER_ORBIT_MS + (max === min ? 0 : (body.orbit - min) / (max - min)) * (STELLAR_OUTER_ORBIT_MS - STELLAR_INNER_ORBIT_MS)
    const angle = elapsedMs / period * Math.PI * 2
    const x = body.x - STELLAR_MAP_CENTER.x, y = body.y - STELLAR_MAP_CENTER.y
    return { ...body, x: STELLAR_MAP_CENTER.x + x * Math.cos(angle) - y * Math.sin(angle), y: STELLAR_MAP_CENTER.y + x * Math.sin(angle) + y * Math.cos(angle) }
  })
}

export function stellarMotionStars(system: StellarSystem, elapsedMs: number): StellarSystem['stars'] {
  if (system.kind !== 'binary' || elapsedMs === 0) return system.stars
  const angle = elapsedMs / STELLAR_BINARY_ORBIT_MS * Math.PI * 2
  return system.stars.map(star => {
    const x = star.x - STELLAR_MAP_CENTER.x, y = star.y - STELLAR_MAP_CENTER.y
    return { ...star, x: STELLAR_MAP_CENTER.x + x * Math.cos(angle) - y * Math.sin(angle), y: STELLAR_MAP_CENTER.y + x * Math.sin(angle) + y * Math.cos(angle) }
  })
}

export interface StellarLighting {
  directions: [number, number, number][]
  strengths: number[]
  tint: [number, number, number]
  ambient: number
}
export function stellarIllumination(system: StellarSystem, body: { x: number; y: number }, elapsedMs: number): StellarLighting {
  const tint: [number, number, number] = system.starClass === 'red' || system.starClass === 'orange' ? [1, .78, .65]
    : system.starClass === 'blue' || system.starClass === 'neutron' ? [.76, .88, 1] : [1, .95, .84]
  const stars = stellarMotionStars(system, elapsedMs).slice(0, 2)
  const sourcePower = system.kind === 'black-hole' ? .22 : system.kind === 'white-dwarf' ? .6 : system.kind === 'neutron' ? .75 : 1
  return { directions: stars.map(star => stellarLightDirection(star, body)), strengths: stars.map(star => {
    const distance = Math.hypot(star.x - body.x, star.y - body.y)
    const relativeSize = Math.min(1.2, Math.max(.5, star.radius / 20))
    return sourcePower * relativeSize / (1 + (distance / STELLAR_LIGHT_DISTANCE) ** 2)
  }), tint, ambient: system.kind === 'rogue' || !stars.length ? .09 : system.kind === 'black-hole' ? .10 : .14 }
}

export function stellarLightDirection(star: { x: number; y: number }, body: { x: number; y: number }): [number, number, number] {
  const x = star.x - body.x, y = star.y - body.y, distance = Math.hypot(x, y)
  return distance > 0 ? [x / distance || 0, -y / distance || 0, .35] : [0, 0, 1]
}

export interface StellarMotionSession {
  elapsedMs: number
  paused: boolean
  reduced: boolean
  gpuReady: boolean
  holdUntil: number
  holds: Set<string>
  listeners: Set<() => void>
}
const sessions = new Map<string, StellarMotionSession>()
export function stellarMotionSession(id: string): StellarMotionSession {
  let value = sessions.get(id)
  if (!value) { value = { elapsedMs: 0, paused: false, reduced: false, gpuReady: false, holdUntil: 0, holds: new Set(), listeners: new Set() }; sessions.set(id, value) }
  return value
}
export function notifyStellarMotion(value: StellarMotionSession): void { for (const listener of value.listeners) listener() }
export function advanceStellarMotion(value: StellarMotionSession, delta: number, now: number, visible: boolean): boolean {
  if (!visible || !value.gpuReady || value.paused || value.reduced || value.holds.size || now < value.holdUntil || !Number.isFinite(delta) || delta <= 0) return false
  value.elapsedMs += Math.min(delta, 100)
  return true
}
