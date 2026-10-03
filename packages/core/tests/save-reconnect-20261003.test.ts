/** C02 修复前失败测试：生产句柄模块＋合成权限/IndexedDB，不访问个人文件。 */
import { describe, expect, it, vi } from 'vitest'
import { gate, runSaveModule } from './helpers/save-shell'

interface FileReply { ok: boolean; text?: string; error?: string }
interface FileApi {
  reconnectSaveFile(): Promise<FileReply>
  saveFileStatus(): Promise<{ connected: boolean }>
  writeToBoundFile(text: string): Promise<boolean | null>
  readFromBoundFile(): Promise<string | null>
  checkReconnectFile(token: number, expected: string, replacement?: string): Promise<FileReply & { changed?: boolean; token?: number }>
  resumeEquivalentFile(token: number, expected: string): Promise<FileReply>
  unbindSaveFile(): Promise<FileReply>
}

function fileShell() {
  let permission: 'prompt' | 'granted' | 'denied' = 'prompt'
  let text = '{"savedAtWallMs":2000,"state":{"wallet":{"isk":222}}}'
  const handle = {
    name: 'synthetic.json',
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async (): Promise<'prompt' | 'granted' | 'denied'> => { permission = 'granted'; return permission }),
    getFile: vi.fn(async () => ({ size: text.length, text: async () => text })),
    createWritable: vi.fn(async () => ({
      write: vi.fn(async (value: string) => { text = value }), close: vi.fn(async () => {}),
    })),
  }
  const indexedDB = {
    open: () => {
      const req: { result: object; onsuccess?: () => void } = { result: {
        transaction: () => ({ objectStore: () => ({ get: () => {
          const result: { result: object; onsuccess?: () => void } = { result: handle }
          queueMicrotask(() => result.onsuccess?.())
          return result
        } }) }),
      } }
      queueMicrotask(() => req.onsuccess?.())
      return req
    },
  }
  const marks = new Map<string, string>()
  const storage = { setItem: (k: string, v: string) => { marks.set(k, v) },
    removeItem: (k: string) => { marks.delete(k) }, getItem: (k: string) => marks.get(k) ?? null }
  const makeApi = () => runSaveModule<FileApi>('apps/desktop/src/renderer/src/game/saveFileHandle.ts', {
    '../i18n/locale': { tr: (id: string) => id },
  }, { indexedDB, window: { showSaveFilePicker: async () => handle,
    localStorage: storage } })
  return { api: makeApi(), handle, text: () => text, change: (next: string) => { text = next },
    reload: makeApi, grant: () => { permission = 'granted' } }
}

describe('C02 网页文件重新连接的安全边界', () => {
  it('重连必须先读取文件，授权成功不直接开启文件写入', async () => {
    const { api, handle, text } = fileShell()
    await api.saveFileStatus()
    const before = text()
    const result = await api.reconnectSaveFile()
    const wrote = await api.writeToBoundFile('OLD-MEMORY')
    expect(result.ok).toBe(true)
    expect(handle.getFile).toHaveBeenCalledTimes(1)
    expect(wrote).toBeNull()
    expect(handle.createWritable).not.toHaveBeenCalled()
    expect(text()).toBe(before)
  })

  it('文件读取失败时不报告连接完成，仍保留文件而不让旧内存覆盖', async () => {
    const { api, handle, text } = fileShell()
    await api.saveFileStatus()
    const before = text()
    handle.getFile.mockRejectedValueOnce(new Error('read blocked'))
    const result = await api.reconnectSaveFile()
    const wrote = await api.writeToBoundFile('OLD-MEMORY')
    expect(result.ok).toBe(false)
    expect(wrote).toBeNull()
    expect(text()).toBe(before)
    expect(handle.createWritable).not.toHaveBeenCalled()
  })

  it.each(['granted', 'denied'] as const)('重连使正在等权限检查的旧写请求失效（旧结果 %s）', async (permission) => {
    const { api, handle, text, grant } = fileShell()
    grant()
    await api.readFromBoundFile()
    const before = text()
    const entered = gate(), hold = gate()
    handle.queryPermission.mockImplementationOnce(async () => { entered.release(); await hold.promise; return permission })
    const oldWrite = api.writeToBoundFile('QUEUED-OLD')
    await entered.promise
    const reconnected = await api.reconnectSaveFile() as FileReply & { token: number }
    hold.release()
    const result = await oldWrite
    expect(result).toBeNull()
    expect(handle.createWritable).not.toHaveBeenCalled()
    expect(text()).toBe(before)
    expect((await api.resumeEquivalentFile(reconnected.token, reconnected.text!)).ok).toBe(true)
  })

  it('拒绝授权保持原文件，没有读取或写入', async () => {
    const { api, handle, text } = fileShell()
    await api.saveFileStatus()
    const before = text()
    handle.requestPermission.mockImplementationOnce(async () => 'denied')
    expect(await api.reconnectSaveFile()).toMatchObject({ ok: false })
    expect(handle.getFile).not.toHaveBeenCalled()
    expect(handle.createWritable).not.toHaveBeenCalled()
    expect(text()).toBe(before)
  })

  it('取消后刷新仍保持文件保护，不把权限授予误当成可以自动写', async () => {
    const { api, reload, text } = fileShell()
    await api.reconnectSaveFile()
    const before = text()
    const second = reload()
    expect(await second.readFromBoundFile()).toBeNull()
    expect(await second.writeToBoundFile('OLD')).toBeNull()
    expect(text()).toBe(before)
  })

  it('确认前文件改变则返回新候选，禁止覆盖新内容', async () => {
    const { api, change, text } = fileShell()
    const read = await api.reconnectSaveFile() as FileReply & { token: number }
    change('EXTERNALLY-UPDATED')
    const result = await api.checkReconnectFile(read.token, read.text!, 'OLD')
    expect(result).toMatchObject({ ok: false, changed: true, text: 'EXTERNALLY-UPDATED' })
    expect(text()).toBe('EXTERNALLY-UPDATED')
  })

  it('重连成功的等价确认可恢复写入；旧令牌不能跟着恢复', async () => {
    const { api, text } = fileShell()
    const read = await api.reconnectSaveFile() as FileReply & { token: number }
    expect((await api.resumeEquivalentFile(read.token, read.text!)).ok).toBe(true)
    expect(await api.writeToBoundFile('NEXT')).toBe(true)
    expect(text()).toBe('NEXT')
    expect((await api.checkReconnectFile(read.token, 'NEXT', 'STALE')).ok).toBe(false)
  })

  it('文件正在写入时重连等它提交，再读实际完成的文本', async () => {
    const { api, grant, handle, text } = fileShell()
    grant()
    await api.readFromBoundFile()
    const entered = gate(), hold = gate()
    handle.createWritable.mockImplementationOnce(async () => ({ write: vi.fn(async () => {
      entered.release(); await hold.promise
    }), close: vi.fn(async () => {}) }))
    const write = api.writeToBoundFile('IN-FLIGHT')
    await entered.promise
    const read = api.reconnectSaveFile()
    hold.release()
    expect(await write).toBe(true)
    expect(await read).toMatchObject({ ok: true, text: text() })
    expect(await api.writeToBoundFile('AFTER')).toBeNull()
  })
})
