import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextToyOrientation, readToyOrientation, saveToyOrientation, toyShouldRotate, TOY_ORIENTATION_KEY } from '../../apps/desktop/src/renderer/src/ui/toyOrientation'

afterEach(() => vi.unstubAllGlobals())
describe('参赛版画面方向三档', () => {
  it('自动档以1.5为含边界阈值，不再只判断高大于宽', () => {
    expect(toyShouldRotate('auto', 400, 599)).toBe(false)
    expect(toyShouldRotate('auto', 400, 600)).toBe(true)
    expect(toyShouldRotate('auto', 400, 601)).toBe(true)
    expect(toyShouldRotate('auto', 1080, 1920)).toBe(true)
    expect(toyShouldRotate('auto', 1920, 1080)).toBe(false)
  })
  it('横屏档旋转短竖窗但不重复旋转已横向窗口，竖屏档始终关闭旋转', () => {
    expect(toyShouldRotate('landscape', 400, 500)).toBe(true)
    expect(toyShouldRotate('landscape', 844, 390)).toBe(false)
    expect(toyShouldRotate('landscape', 400, 400)).toBe(false)
    expect(toyShouldRotate('portrait', 390, 844)).toBe(false)
    expect(toyShouldRotate('portrait', 844, 390)).toBe(false)
  })
  it('三档按用户给定顺序循环', () => {
    expect(nextToyOrientation('auto')).toBe('landscape')
    expect(nextToyOrientation('landscape')).toBe('portrait')
    expect(nextToyOrientation('portrait')).toBe('auto')
  })
  it('偏好独立持久化，损坏或缺值回落自动，不修改存档键', () => {
    const entries = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) })
    expect(readToyOrientation()).toBe('auto')
    for (const mode of ['auto', 'landscape', 'portrait'] as const) { saveToyOrientation(mode); expect(readToyOrientation()).toBe(mode) }
    entries.set(TOY_ORIENTATION_KEY, 'unknown')
    expect(readToyOrientation()).toBe('auto')
    expect([...entries.keys()]).toEqual([TOY_ORIENTATION_KEY])
  })
  it('存储拒绝不影响本次操作，无效尺寸不旋转', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } })
    expect(readToyOrientation()).toBe('auto')
    expect(() => saveToyOrientation('portrait')).not.toThrow()
    for (const [width, height] of [[0, 600], [400, NaN], [-1, 600], [400, Infinity]]) expect(toyShouldRotate('auto', width, height)).toBe(false)
  })
})
