import { isLocalDebugOrigin } from '@whale/core'

const DEBUG_KEY = 'whale-idle:debug'

export function debugAllowed(): boolean {
  try {
    if (typeof location === 'undefined') return false
    return isLocalDebugOrigin(location.protocol, location.hostname)
  } catch {
    return false
  }
}

export function debugEnabled(): boolean {
  if (!debugAllowed()) return false
  try {
    const v = localStorage.getItem(DEBUG_KEY)
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function setDebugEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEBUG_KEY, '1')
    else localStorage.removeItem(DEBUG_KEY)
  } catch {
  }
}

export function futureWormholeEnabled(): boolean {
  if (!debugEnabled()) return false
  try {
    return localStorage.getItem('whale-idle:future-wormhole') === '1' || localStorage.getItem('whale-idle:wh-expedition-test') === '1'
  } catch { return false }
}

export function planetaryEnabled(): boolean {
  return debugEnabled()
}

export function setFutureWormholeEnabled(on: boolean): void {
  if (!debugAllowed()) return
  try {
    if (on) localStorage.setItem('whale-idle:future-wormhole', '1')
    else localStorage.removeItem('whale-idle:future-wormhole')
    window.dispatchEvent(new Event('whale-future-wormhole-change'))
  } catch { }
}
