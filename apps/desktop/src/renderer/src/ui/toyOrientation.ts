/** 参赛版画面方向是本机偏好，不进入游戏存档，也不调用宿主的屏幕锁定接口。 */
export type ToyOrientation = 'auto' | 'landscape' | 'portrait'
export const TOY_ORIENTATION_KEY = 'whale-idle:toy-orientation'
const MODES: readonly ToyOrientation[] = ['auto', 'landscape', 'portrait']

export function readToyOrientation(): ToyOrientation {
  try {
    const value = localStorage.getItem(TOY_ORIENTATION_KEY)
    return MODES.includes(value as ToyOrientation) ? value as ToyOrientation : 'auto'
  } catch { return 'auto' }
}
export function saveToyOrientation(mode: ToyOrientation): void {
  try { localStorage.setItem(TOY_ORIENTATION_KEY, mode) } catch { /* 存储不可用时仍可切换本次画面。 */ }
}
export function nextToyOrientation(mode: ToyOrientation): ToyOrientation {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length]
}
export function toyShouldRotate(mode: ToyOrientation, width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
  return mode === 'auto' ? height >= width * 1.5 : mode === 'landscape' ? height > width : false
}
