import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../src/state'
import { bumpIronmanSeq } from '../src/ironman'
import { serializeSaveFile } from '../src/save'
import { flush, gameSaveMethods, gate, runSaveModule } from './helpers/save-shell'

afterEach(() => vi.restoreAllMocks())

interface Probe {
  state: ReturnType<typeof createInitialState>
  persist(): Promise<boolean>
  backupNow(): Promise<{ ok: boolean; error?: string }>
  saveWriteState(): string
}
function engineProbe(save: (text: string) => Promise<boolean>, backup: (text?: string) => Promise<{ ok: boolean }>) {
  const probe = gameSaveMethods(['persistSnapshot', 'persist', 'backupNow'], {
    bumpIronmanSeq, serializeSaveFile, saveBridge: { save, backup },
    requestPersistentStorage: async () => {}, noteSaveWriteFailed: vi.fn(), tr: (id: string) => id,
  }) as unknown as Probe
  probe.state = createInitialState({ nowWallMs: 0, seed: 7 })
  probe.saveWriteState = () => 'ok'
  return probe
}

describe('C08 真实引擎备份入口', () => {
  it.each(['false', 'throw', 'paused'])('保存 %s 时不调用备份', async (mode) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const save = vi.fn(async () => { if (mode === 'throw') throw new Error('disk locked'); return false })
    const backup = vi.fn(async () => ({ ok: true }))
    const engine = engineProbe(save, backup)
    if (mode === 'paused') engine.saveWriteState = () => 'paused'
    expect(await engine.backupNow()).toMatchObject({ ok: false, error: 'ui.engine.027' })
    expect(backup).not.toHaveBeenCalled()
    if (mode === 'paused') expect(save).not.toHaveBeenCalled()
  })

  it('备份固定点击时文本：代次只增一次、剥离日志、后一次保存不改变备份', async () => {
    const entered = gate(), hold = gate()
    const texts: string[] = []
    const save = vi.fn(async (text: string) => {
      texts.push(text)
      if (texts.length === 1) { entered.release(); await hold.promise }
      return true
    })
    const backup = vi.fn(async (_text?: string) => ({ ok: true }))
    const engine = engineProbe(save, backup)
    engine.state.ironman = { on: true, seq: 7, sinceWallMs: 1 }
    engine.state.logs = [{ id: 1, atGameMs: 0, kind: 'system', text: 'SESSION' }]
    const request = engine.backupNow()
    await entered.promise
    engine.state.wallet.isk = 12345
    await engine.persist()
    hold.release()
    expect(await request).toMatchObject({ ok: true })
    expect(backup).toHaveBeenCalledWith(texts[0])
    expect(JSON.parse(texts[0]!).state.ironman.seq).toBe(8)
    expect(JSON.parse(texts[0]!).state.logs).toEqual([])
    expect(JSON.parse(texts[1]!).state.ironman.seq).toBe(9)
    expect(engine.state.logs).toHaveLength(1)
  })

  it('备份桥抛错返回失败，persist 布尔 API 不变', async () => {
    const engine = engineProbe(async () => true, async () => { throw new Error('quota') })
    expect(await engine.backupNow()).toMatchObject({ ok: false, error: 'Error: quota' })
    expect(await engine.persist()).toBe(true)
  })
})

interface WebBridge {
  save(text: string): Promise<boolean>
  backup(text?: string): Promise<{ ok: boolean; name: string }>
  restore(name: string): Promise<{ ok: boolean }>
  ironmanNoteRescue(): Promise<{ ok: boolean }>
  ironmanLedger(): Promise<{ seq: number; rescues: number }>
}
function webShell(write: (text: string) => Promise<boolean | null>) {
  const entries = new Map<string, string>()
  const storage = {
    get length() { return entries.size },
    key: (i: number) => [...entries.keys()][i] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
  }
  const { saveBridge } = runSaveModule<{ saveBridge: WebBridge }>('apps/desktop/src/renderer/src/game/storage.ts', {
    '../i18n/locale': { tr: (id: string) => id }, './saveGuard': { noteSaveWriteFailed: vi.fn() },
    './saveFileHandle': { writeToBoundFile: write },
  }, { window: { localStorage: storage }, TextEncoder })
  return { entries, saveBridge, storage }
}

describe('C01/C08 网页生产桥', () => {
  it('慢绑定文件写入串行，不允许 B 先写浏览器存储，再被 A 回退', async () => {
    const entered = gate(), hold = gate()
    const aText = '{"value":"A"}', bText = '{"value":"B"}'
    const write = vi.fn(async (text: string) => { if (text === aText) { entered.release(); await hold.promise } return true })
    const { entries, saveBridge } = webShell(write)
    const a = saveBridge.save(aText)
    await entered.promise
    const b = saveBridge.save(bText)
    await flush()
    const before = write.mock.calls.map(([text]) => text)
    hold.release()
    expect(await a).toBe(true)
    expect(await b).toBe(true)
    expect(before).toEqual([aText])
    expect(entries.get('whale:idle:save')).toBe(bText)
  })

  it('保存、恢复同序，备份指定快照不替换主档，救援计数无竞争', async () => {
    const entered = gate(), hold = gate()
    const { entries, saveBridge } = webShell(async () => { entered.release(); await hold.promise; return true })
    const name = 'save-20261003-120000.json'
    entries.set('whale:idle:backup:' + name, 'RESTORED')
    const a = saveBridge.save('{"value":"A"}')
    await entered.promise
    const restore = saveBridge.restore(name)
    hold.release()
    await a
    expect(await restore).toMatchObject({ ok: true })
    const result = await saveBridge.backup('SNAPSHOT')
    expect(entries.get('whale:idle:backup:' + result.name)).toBe('SNAPSHOT')
    expect(entries.get('whale:idle:save')).toBe('RESTORED')
    await Promise.all([saveBridge.ironmanNoteRescue(), saveBridge.ironmanNoteRescue()])
    expect(await saveBridge.ironmanLedger()).toMatchObject({ rescues: 2 })
  })

  it('浏览器主档配额失败返回 false，下一次可继续；备份配额失败不报成功', async () => {
    const { entries, storage, saveBridge } = webShell(async () => null)
    entries.set('whale:idle:save', 'OLD')
    const set = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(await saveBridge.save('{"value":"FAILED"}')).toBe(false)
    expect(entries.get('whale:idle:save')).toBe('OLD')
    expect(await saveBridge.backup('SNAPSHOT')).toMatchObject({ ok: false })
    set.mockRestore()
    expect(await saveBridge.save('{"value":"NEXT"}')).toBe(true)
    expect(entries.get('whale:idle:save')).toBe('{"value":"NEXT"}')
  })

  it('网页账本失败保留主档成功并诊断，后续保存与救援不丢最高代次', async () => {
    const { entries, storage, saveBridge } = webShell(async () => null)
    const setItem = storage.setItem
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const set = vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (key === 'whale:idle:ironman-ledger') throw new Error('ledger quota')
      setItem(key, value)
    })
    const text = '{"state":{"ironman":{"seq":7}}}'
    expect(await saveBridge.save(text)).toBe(true)
    expect(entries.get('whale:idle:save')).toBe(text)
    expect(warn).toHaveBeenCalledTimes(1)
    set.mockRestore()
    await Promise.all([saveBridge.save('{"state":{"ironman":{"seq":9}}}'), saveBridge.ironmanNoteRescue(),
      saveBridge.save('{"state":{"ironman":{"seq":3}}}'), saveBridge.ironmanNoteRescue()])
    expect(await saveBridge.ironmanLedger()).toMatchObject({ seq: 9, rescues: 2 })
  })
})
