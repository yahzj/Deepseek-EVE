import { describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../src/state'
import { bumpIronmanSeq, ironmanLoadVerdict, ironmanOn, ironmanSeq } from '../src/ironman'
import { loadSaveFile, serializeSaveFile, SaveError } from '../src/save'
import { gameSaveMethods, gate } from './helpers/save-shell'

type State = ReturnType<typeof createInitialState>
interface Probe {
  state: State
  savePaused: boolean
  start(): Promise<void>
  persist(): Promise<boolean>
  exportSaveToFile(): Promise<{ ok: boolean; canceled?: boolean }>
  importSaveFromFile(): Promise<{ ok: boolean }>
  restoreBackup(name: string): Promise<{ ok: boolean }>
}
function fixture(options: { save?: () => Promise<boolean>; exported?: () => Promise<{ ok: boolean; canceled?: boolean }>;
  ledger?: number; ledgerFails?: boolean; normal?: boolean; age?: number } = {}) {
  const initial = createInitialState({ nowWallMs: 0, seed: 29 })
  initial.ironman = { on: true, seq: 7, sinceWallMs: 1000 }
  if (options.normal) initial.ironman.on = false
  let stored = serializeSaveFile(initial, Date.now() - (options.age ?? 0))
  let external = stored
  const events: string[] = []
  const bridge = {
    save: vi.fn(async (text: string) => { events.push('save'); const ok = await (options.save?.() ?? Promise.resolve(true)); if (ok) stored = text; return ok }),
    exportSaveToFile: vi.fn(async (text: string) => { events.push('export'); external = text; return options.exported?.() ?? { ok: true } }),
    load: async () => stored,
    pickImportSave: async () => ({ ok: true, text: external }),
    readBackup: async () => ({ ok: true, text: external }),
    restore: vi.fn(async () => ({ ok: true })),
    ironmanLedger: vi.fn(async () => { if (options.ledgerFails) throw new Error('ledger'); return { ok: true, seq: options.ledger ?? 7 } }),
    ironmanNoteRescue: vi.fn(async () => ({ ok: true })),
  }
  const repair = vi.fn()
  const probe = gameSaveMethods(['start', 'persistSnapshot', 'createSaveSnapshot', 'persist', 'currentSaveText', 'exportSaveToFile',
    'ironmanLoadCheck', 'syncIronmanHead', 'prepareImportedState', 'commitLoadedSave', 'restoreBackup', 'importSaveFromFile', 'importSaveText'], {
    createInitialState, loadSaveFile, SaveError, serializeSaveFile, bumpIronmanSeq, ironmanLoadVerdict, ironmanOn, ironmanSeq,
    saveBridge: bridge, debugEnabled: () => false, canWriteSave: () => true, saveStorageProbe: () => ({ ok: true }),
    repairDeprecatedModules: repair, migrateDeprecatedAmmo: vi.fn(), wormholeNormalizeLegacyTemp: vi.fn(),
    repairMisplacedWarehouseModules: vi.fn(), repairHoldForbiddenCargo: vi.fn(),
    requestPersistentStorage: vi.fn(), noteSaveWriteFailed: vi.fn(), tr: (id: string) => id, addLog: vi.fn(),
    window: { addEventListener: vi.fn() },
  })
  Object.assign(probe, {
    state: initial, saveWriteState: () => probe.savePaused || probe.reconnectResolving ? 'paused' : 'ok',
    winCache: { reset: vi.fn() }, ensurePump: vi.fn(), ensureSaveInterval: vi.fn(), notify: vi.fn(),
    installWormholeTestApi: vi.fn(), installPlanetaryTestApi: vi.fn(), wormholeTestEnabled: () => true,
    prepareImportedState: vi.fn(() => { repair(); return null }),
  })
  return { engine: probe as unknown as Probe, probe, bridge, repair, events, read: () => stored }
}

describe('C07 真实保存/导出与装载方法', () => {
  it('导出在首个异步等待前调用桥，主档与导出逐字一致且可立即导回', async () => {
    const f = fixture()
    const request = f.engine.exportSaveToFile()
    expect(f.events[0]).toBe('export')
    expect(await request).toMatchObject({ ok: true })
    const text = f.bridge.exportSaveToFile.mock.calls[0]![0]
    expect(f.read()).toBe(text)
    expect(JSON.parse(text).state.ironman.seq).toBe(8)
    expect((await f.engine.importSaveFromFile()).ok).toBe(true)
  })
  it.each(['false', 'throw'])('保存%s不提高内存铁人阈值', async mode => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const f = fixture({ save: async () => { if (mode === 'throw') throw new Error('disk'); return false } })
      expect(await f.engine.persist()).toBe(false)
      expect(f.engine.state.ironman!.seq).toBe(7)
      expect(JSON.parse(f.read()).state.ironman.seq).toBe(7)
    } finally { error.mockRestore() }
  })
  it('并发保存分配不同代次，较旧回执不能降低已成功内存代次', async () => {
    const hold = gate()
    let calls = 0
    const f = fixture({ save: async () => { if (++calls === 1) await hold.promise; return true } })
    const first = f.engine.persist()
    await f.engine.persist()
    hold.release()
    await first
    expect(f.bridge.save.mock.calls.map(([text]) => JSON.parse(text).state.ironman.seq)).toEqual([8, 9])
    expect(f.engine.state.ironman!.seq).toBe(9)
  })
  it('导出失败或取消不能宣称导出成功，失败保存不抬代次', async () => {
    const f = fixture({ save: async () => false, exported: async () => ({ ok: false, canceled: true }) })
    expect(await f.engine.exportSaveToFile()).toMatchObject({ ok: false, canceled: true })
    expect(f.engine.state.ironman!.seq).toBe(7)
  })
  it('普通启动拒绝落后铁人档并挂起写入，不覆盖磁盘', async () => {
    const f = fixture({ ledger: 8 })
    const before = f.read()
    await f.engine.start()
    expect(f.engine.savePaused).toBe(true)
    expect(f.bridge.save).not.toHaveBeenCalled()
    expect(f.read()).toBe(before)
  })
  it('普通启动接受当前铁人档，只有提交成功才抬代次', async () => {
    const f = fixture()
    await f.engine.start()
    expect(f.engine.savePaused).not.toBe(true)
    expect(f.bridge.save).toHaveBeenCalledTimes(1)
    expect(f.engine.state.ironman!.seq).toBe(8)
  })
  it('恢复先准备校验候选，再触达覆盖入口', async () => {
    const f = fixture()
    f.probe.prepareImportedState = vi.fn(() => { throw new Error('prepare failed') })
    expect((await f.engine.restoreBackup('synthetic')).ok).toBe(false)
    expect(f.bridge.restore).not.toHaveBeenCalled()
    expect(f.engine.state.wallet.isk).toBe(10_000)
  })
  it.each(['restore', 'import'])('%s候选提交期间不替换内存，失败不记救援、不改旧档', async method => {
    const hold = gate()
    const f = fixture({ save: async () => { await hold.promise; return false }, ledger: 8, age: 49 * 3_600_000 })
    const before = f.engine.state
    const text = f.read()
    const request = method === 'restore' ? f.engine.restoreBackup('synthetic') : f.engine.importSaveFromFile()
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(f.bridge.save).toHaveBeenCalledTimes(1)
    expect(f.engine.state).toBe(before)
    expect(await f.engine.persist()).toBe(false)
    expect(f.bridge.save).toHaveBeenCalledTimes(1)
    hold.release()
    expect((await request).ok).toBe(false)
    expect(f.engine.state).toBe(before)
    expect(f.read()).toBe(text)
    expect(f.bridge.ironmanNoteRescue).not.toHaveBeenCalled()
  })
  it.each([false, true])('启动沿用普通档/合法救援政策（普通=%s）', async normal => {
    const f = fixture({ normal, ledger: 8, age: 49 * 3_600_000 })
    await f.engine.start()
    expect(f.engine.savePaused).not.toBe(true)
    expect(f.bridge.save).toHaveBeenCalledTimes(1)
    expect(f.bridge.ironmanNoteRescue).toHaveBeenCalledTimes(normal ? 0 : 1)
  })
  it('账本失效沿原政策退化，仍可启动同代档', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const f = fixture({ ledgerFails: true })
      await f.engine.start()
      expect(f.engine.savePaused).not.toBe(true)
      expect(f.bridge.save).toHaveBeenCalledTimes(1)
    } finally { warn.mockRestore() }
  })
  it('启动救援的首次提交失败不记成功救援', async () => {
    const f = fixture({ ledger: 8, age: 49 * 3_600_000, save: async () => false })
    await f.engine.start()
    expect(f.bridge.ironmanNoteRescue).not.toHaveBeenCalled()
  })
})
