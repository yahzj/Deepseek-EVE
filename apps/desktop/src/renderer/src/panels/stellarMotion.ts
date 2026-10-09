import type { StellarBody, StellarSystem } from '@whale/core'
import { STELLAR_MAP_CENTER } from './stellarMapView'

export const STELLAR_SPIN_MS = 40000
export const STELLAR_INNER_ORBIT_MS = 180000
export const STELLAR_OUTER_ORBIT_MS = 480000
export const stellarDynamicBody = (system: StellarSystem, body: StellarBody): boolean => system.kind === 'single' && (body.kind === 'rocky' || body.kind === 'ocean')

/** 公转仅表现，原坐标是初相位；相同会话时间给绘制/命中/详情同一个答案。 */
export function stellarMotionBodies(system: StellarSystem, elapsedMs: number): StellarBody[] {
  const orbits = system.bodies.map(body => body.orbit)
  const min = Math.min(...orbits), max = Math.max(...orbits)
  return system.bodies.map(body => {
    if (!stellarDynamicBody(system, body) || elapsedMs === 0) return body
    const period = STELLAR_INNER_ORBIT_MS + (max === min ? 0 : (body.orbit - min) / (max - min)) * (STELLAR_OUTER_ORBIT_MS - STELLAR_INNER_ORBIT_MS)
    const angle = elapsedMs / period * Math.PI * 2
    const x = body.x - STELLAR_MAP_CENTER.x, y = body.y - STELLAR_MAP_CENTER.y
    return { ...body, x: STELLAR_MAP_CENTER.x + x * Math.cos(angle) - y * Math.sin(angle), y: STELLAR_MAP_CENTER.y + x * Math.sin(angle) + y * Math.cos(angle) }
  })
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
