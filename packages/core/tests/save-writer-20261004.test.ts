import { describe, expect, it, vi } from 'vitest'
import { runSaveModule } from './helpers/save-shell'

interface WriterApi {
  acquireSaveWriter(): Promise<string>
  canWriteSave(): boolean
  saveWriterState(): string
}
describe('网页单写者门禁', () => {
  it('持有排他锁，第二页不能获得写入权；恢复页要求重新载入', async () => {
    let held = false
    const pages = new Map<string, (event: { persisted: boolean }) => void>()
    const request = vi.fn(async (_name: string, options: object, fn: (lock: object | null) => Promise<void>) => {
      expect(options).toMatchObject({ ifAvailable: true, mode: 'exclusive' })
      if (held) return fn(null)
      held = true
      return fn({})
    })
    const globals = { navigator: { locks: { request } },
      window: { addEventListener: (name: string, fn: (event: { persisted: boolean }) => void) => pages.set(name, fn) } }
    const a = runSaveModule<WriterApi>('apps/desktop/src/renderer/src/game/saveWriter.ts', {}, globals)
    expect(a.canWriteSave()).toBe(false)
    expect(await a.acquireSaveWriter()).toBe('writer')
    expect(a.canWriteSave()).toBe(true)
    const b = runSaveModule<WriterApi>('apps/desktop/src/renderer/src/game/saveWriter.ts', {}, globals)
    expect(await b.acquireSaveWriter()).toBe('busy')
    expect(b.canWriteSave()).toBe(false)
    pages.get('pageshow')!({ persisted: true })
    expect(a.canWriteSave()).toBe(false)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each(['absent', 'throw', 'reject'])('Web Locks %s 时保护性只读', async (mode) => {
    const request = async () => { throw new Error('lock unavailable') }
    const api = runSaveModule<WriterApi>('apps/desktop/src/renderer/src/game/saveWriter.ts', {}, {
      navigator: mode === 'absent' ? {} : { locks: { request: mode === 'throw' ? () => { throw new Error('blocked') } : request } },
      window: {},
    })
    expect(await api.acquireSaveWriter()).toBe('unsupported')
    expect(api.canWriteSave()).toBe(false)
  })

  it('桌面桥不依赖浏览器锁', async () => {
    const api = runSaveModule<WriterApi>('apps/desktop/src/renderer/src/game/saveWriter.ts', {}, { window: { whale: {} } })
    expect(await api.acquireSaveWriter()).toBe('writer')
    expect(api.canWriteSave()).toBe(true)
  })
})
