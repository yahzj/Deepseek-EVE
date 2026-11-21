import { describe, expect, it } from 'vitest'
import { runSaveModule } from './helpers/save-shell'

type CrtModule = {
  CRT_KEY_CLASSIC: string
  CRT_KEY_MODERN: string
  readCrtEffect(): 'on' | 'off'
  saveCrtEffect(effect: 'on' | 'off'): void
}
type LayoutModule = { LAYOUT_KEY: string; LAYOUT_SET_KEY: string }

describe('CRT 偏好', () => {
  it.each(['modern', 'classic'])('%s 界面默认关闭，保留玩家的独立选择', (layout) => {
    const values = new Map<string, string>()
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const { LAYOUT_KEY, LAYOUT_SET_KEY } = runSaveModule<LayoutModule>('apps/desktop/src/renderer/src/ui/layoutPreference.ts', {}, { localStorage })
    values.set(LAYOUT_KEY, layout)
    values.set(LAYOUT_SET_KEY, '1')
    const { CRT_KEY_CLASSIC, CRT_KEY_MODERN, readCrtEffect, saveCrtEffect } = runSaveModule<CrtModule>('apps/desktop/src/renderer/src/ui/crtEffect.ts', {}, { localStorage })
    const key = layout === 'modern' ? CRT_KEY_MODERN : CRT_KEY_CLASSIC
    const otherKey = layout === 'modern' ? CRT_KEY_CLASSIC : CRT_KEY_MODERN

    expect(readCrtEffect()).toBe('off')
    values.set(otherKey, 'on')
    expect(readCrtEffect()).toBe('off')
    values.set(key, 'on')
    expect(readCrtEffect()).toBe('on')
    values.set(key, 'off')
    expect(readCrtEffect()).toBe('off')
    values.set(key, 'invalid')
    expect(readCrtEffect()).toBe('off')

    saveCrtEffect('on')
    expect(readCrtEffect()).toBe('on')
    saveCrtEffect('off')
    expect(readCrtEffect()).toBe('off')
    expect(values.get(otherKey)).toBe('on')
  })
})
