import { describe, expect, it, vi } from 'vitest'
import { gate, flush, runSaveModule } from './helpers/save-shell'

type Result = { ok: boolean; fileSaved?: boolean; browserSaved?: boolean; changed?: boolean; error?: string }
interface Bridge {
  save(text: string): Promise<boolean>
  backup(): Promise<Result>
  restore(name: string): Promise<Result>
  ironmanNoteRescue(): Promise<Result>
  saveFile: { resolve(token: number, expected: string, text: string, choice: 'file' | 'current'): Promise<Result> }
}
function shell(fileResult: Result = { ok: true }, writer = true) {
  const entries = new Map<string, string>([['whale:idle:save', 'OLD']])
  let quota = false, token = 1
  const pause = vi.fn(() => { token++ })
  const check = vi.fn(async (_token: number, _expected: string, _replacement?: string) => fileResult)
  const write = vi.fn(async () => null)
  const storage = { get length() { return entries.size }, key: (i: number) => [...entries.keys()][i] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { if (quota) throw new Error('quota'); entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) } }
  const { saveBridge } = runSaveModule<{ saveBridge: Bridge }>('apps/desktop/src/renderer/src/game/storage.ts', {
    '../i18n/locale': { tr: (id: string) => id }, './saveGuard': { noteSaveWriteFailed: vi.fn() },
    './saveWriter': { canWriteSave: () => writer }, './saveFileHandle': { checkReconnectFile: check,
      writeToBoundFile: write, saveFileWriteToken: () => token, pauseBoundFile: pause },
  }, { window: { localStorage: storage }, TextEncoder })
  return { bridge: saveBridge, entries, check, pause, write, quota: () => { quota = true }, nextToken: () => { token++ } }
}
describe('重连保存桥双介质事务', () => {
  it('候选浏览器保存失败，不写文件、不替换旧浏览器档', async () => {
    const { bridge, entries, check, quota } = shell()
    quota()
    expect(await bridge.saveFile.resolve(1, 'FILE', '{}', 'file')).toMatchObject({ ok: false, browserSaved: false, fileSaved: false })
    expect(check).toHaveBeenCalledTimes(1)
    expect(entries.get('whale:idle:save')).toBe('OLD')
  })
  it('文件已改变则不写任何候选', async () => {
    const { bridge, entries } = shell({ ok: false, changed: true })
    expect(await bridge.saveFile.resolve(1, 'FILE', '{}', 'current')).toMatchObject({ ok: false, changed: true })
    expect(entries.get('whale:idle:save')).toBe('OLD')
  })
  it('浏览器已提交但文件失败返回部分成功', async () => {
    const { bridge, entries, check } = shell()
    check.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'disk locked' })
    expect(await bridge.saveFile.resolve(1, 'FILE', '{}', 'file')).toMatchObject({ ok: false, browserSaved: true, fileSaved: false })
    expect(entries.get('whale:idle:save')).toBe('{}')
  })
  it('文件已写而浏览器失败，暂停目标，不用旧浏览器档回滚文件', async () => {
    const { bridge, pause, quota, entries } = shell()
    quota()
    expect(await bridge.saveFile.resolve(1, 'FILE', '{}', 'current')).toMatchObject({ ok: false, fileSaved: true, browserSaved: false })
    expect(pause).toHaveBeenCalledOnce()
    expect(entries.get('whale:idle:save')).toBe('OLD')
  })
  it('不是写入者时不能写主档、备份、恢复、救援或解决文件冲突', async () => {
    const { bridge, entries, check, write } = shell({ ok: true }, false)
    expect(await bridge.save('{}')).toBe(false)
    expect((await bridge.backup()).ok).toBe(false)
    expect((await bridge.restore('save-20261004-000000.json')).ok).toBe(false)
    expect((await bridge.ironmanNoteRescue()).ok).toBe(false)
    expect((await bridge.saveFile.resolve(1, 'FILE', '{}', 'current')).ok).toBe(false)
    expect(check).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(entries.get('whale:idle:save')).toBe('OLD')
  })
  it('排队保存快照携带入队令牌，不能在重连确认后偷用新令牌', async () => {
    const { bridge, write, nextToken } = shell()
    const entered = gate(), hold = gate()
    write.mockImplementationOnce(async () => { entered.release(); await hold.promise; return null })
    const a = bridge.save('{}')
    await entered.promise
    const b = bridge.save('{}')
    nextToken()
    await flush()
    hold.release()
    await Promise.all([a, b])
    expect(write.mock.calls).toEqual([['{}', 1], ['{}', 1]])
  })
})
