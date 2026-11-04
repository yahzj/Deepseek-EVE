import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../src/state'
import { bumpIronmanSeq, ironmanLoadVerdict, ironmanOn, ironmanSeq } from '../src/ironman'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { offlineCapMsOf, offlineSplit, simulateOffline } from '../src/simulation'
import { newSettleStats } from '../src/settleStats'
import { makeTestCtx } from './helpers'
import { flush, gameSaveMethods, gate } from './helpers/save-shell'

afterEach(() => vi.restoreAllMocks())

type State = ReturnType<typeof createInitialState>
type SaveResult = { ok: boolean; error?: string }
type LoadGate = { ok: true; rescue: boolean } | { ok: false; error: string }
interface EngineProbe {
  state: State
  persist(): Promise<boolean>
  tick(): void
  saveWriteState(): string
  exportCloudSave(): Promise<{ ok: boolean; text?: string; error?: string }>
  importCloudSave(text: string): Promise<SaveResult>
  importSaveFromFile(): Promise<SaveResult & { canceled?: boolean }>
  restoreBackup(name: string): Promise<SaveResult>
  reconnectLocalSave(): Promise<SaveResult>
  resolveReconnectLocalSave(choice: 'file' | 'current'): Promise<SaveResult>
}

function fixture(options: { write?: boolean; text?: string; gate?: () => Promise<LoadGate>; realOffline?: boolean } = {}) {
  const current = createInitialState({ nowWallMs: 0, seed: 11 })
  current.wallet.isk = 111
  current.logs.push({ id: 1, atGameMs: 0, kind: 'info', text: 'session-only' })
  const writes: string[] = []
  const save = vi.fn(async (text: string) => {
    writes.push(text)
    return options.write ?? true
  })
  const simulate = vi.fn<typeof simulateOffline>((...args) => {
    if (options.realOffline) return simulateOffline(...args)
    args[0].wallet.isk += 10
  })
  const report = vi.fn(() => null)
  const sync = vi.fn<(state: State) => Promise<void>>()
  const rescue = vi.fn(async () => {})
  const backup = vi.fn(async () => ({ ok: true }))
  const parsed = options.text ?? serializeSaveFile(createInitialState({ nowWallMs: 0, seed: 12 }), 1)
  const bridge = { save, backup, pickImportSave: vi.fn(async () => ({ ok: true, text: parsed })),
    readBackup: vi.fn(async () => ({ ok: true, text: parsed })), ironmanNoteRescue: rescue,
    ironmanLedger: vi.fn(async () => ({ ok: true, seq: 0 })) }
  const probe = gameSaveMethods([
    'createSaveSnapshot', 'persistSnapshot', 'persist', 'exportCloudSave', 'importCloudSave', 'importSaveFromFile',
    'importSaveText', 'commitLoadedSave', 'restoreBackup', 'saveWriteState', 'tick', 'ironmanLoadCheck', 'syncIronmanHead', 'prepareImportedState',
    'resolveReconnectLocalSave', 'reconnectLocalSave',
  ], {
    serializeSaveFile, loadSaveFile, bumpIronmanSeq, canWriteSave: () => true,
    ironmanLoadVerdict, ironmanOn, ironmanSeq, debugEnabled: () => false,
    saveBridge: bridge,
    requestPersistentStorage: async () => {}, noteSaveWriteFailed: vi.fn(), tr: (id: string) => id,
    repairDeprecatedModules: vi.fn(), migrateDeprecatedAmmo: vi.fn(), wormholeNormalizeLegacyTemp: vi.fn(),
    repairMisplacedWarehouseModules: vi.fn(), repairHoldForbiddenCargo: vi.fn(),
    snapshotBasics: () => ({}), newSettleStats, offlineSplit,
    offlineCapMsOf, simulateOffline: simulate,
    buildOfflineReport: report, addLog: vi.fn(),
    structuredClone, Date, console,
  })
  const loadCheck = vi.fn((probe.ironmanLoadCheck as (text: string, wall: number, record: boolean) => Promise<LoadGate>).bind(probe))
  sync.mockImplementation((probe.syncIronmanHead as (state: State) => Promise<void>).bind(probe))
  Object.assign(probe, {
    state: current, saveSequence: 0, saveUnavailable: false, savePaused: false,
    reconnectResolving: false, loadResolving: false, offlineReport: null,
    pendingMs: 0, lastRealMs: 0, stopped: false, winCache: { pause: vi.fn() },
    ctx: makeTestCtx(), wormholeTestEnabled: () => false,
    ironmanLoadCheck: options.gate ?? loadCheck,
    syncIronmanHead: sync,
    notify: vi.fn(),
  })
  return { engine: probe as unknown as EngineProbe, current, save, writes, simulate, report, sync, rescue, backup, probe, bridge, loadCheck }
}

describe('cloud save engine bridge', () => {
  it('exports the exact persisted snapshot without session logs', async () => {
    const { engine, writes } = fixture()
    const result = await engine.exportCloudSave()
    expect(result.ok).toBe(true)
    expect(result.text).toBe(writes[0])
    expect(JSON.parse(result.text!).state.logs).toEqual([])
    expect(writes).toHaveLength(1)
  })

  it('does not return text when the local save fails', async () => {
    const { engine } = fixture({ write: false })
    expect(await engine.exportCloudSave()).toMatchObject({ ok: false, error: 'ui.engine.027' })
    expect(await engine.exportCloudSave()).not.toHaveProperty('text')
  })

  it('waits for persistence and returns that exact ironman snapshot even if memory advances', async () => {
    const hold = gate()
    const { engine, save, current } = fixture()
    const logs = structuredClone(current.logs)
    current.ironman = { on: true, seq: 7, sinceWallMs: 1 }
    let settled = false
    save.mockImplementation(async () => { await hold.promise; return true })
    const pending = engine.exportCloudSave().then(result => { settled = true; return result })
    const text = save.mock.calls[0]![0]
    current.wallet.isk = 999
    await flush()
    expect(settled).toBe(false)
    expect(current.ironman.seq).toBe(7)
    hold.release()
    expect(await pending).toEqual({ ok: true, text })
    expect(JSON.parse(text).state.wallet.isk).toBe(111)
    expect(JSON.parse(text).state.logs).toEqual([])
    expect(JSON.parse(text).state.ironman.seq).toBe(8)
    expect(current.ironman.seq).toBe(8)
    expect(current.logs).toEqual(logs)
  })

  it.each([
    ['invalid JSON', '{'],
    ['future version', JSON.stringify({ format: 'whale-idle-save', version: 999, state: {} })],
    ['old version', JSON.stringify({ format: 'whale-idle-save', version: 0, state: {} })],
  ])('rejects %s without replacing current memory', async (_label, text) => {
    const { engine, current, save } = fixture()
    expect((await engine.importCloudSave(text)).ok).toBe(false)
    expect(engine.state).toBe(current)
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps current memory when candidate persistence fails and does not back it up', async () => {
    const incoming = createInitialState({ nowWallMs: 0, seed: 12 })
    incoming.wallet.isk = 222
    const { engine, current, save, backup, simulate } = fixture({ write: false, text: serializeSaveFile(incoming, 1) })
    expect(await engine.importCloudSave(serializeSaveFile(incoming, 1))).toMatchObject({ ok: false, error: 'ui.engine.027' })
    expect(engine.state).toBe(current)
    expect(engine.state.wallet.isk).toBe(111)
    expect(simulate).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
    expect(backup).not.toHaveBeenCalled()
  })

  it('rejects a stale ironman generation before preparing or writing', async () => {
    const incoming = createInitialState({ nowWallMs: 0, seed: 12 })
    incoming.ironman = { on: true, seq: 2, sinceWallMs: 1 }
    const text = serializeSaveFile(incoming, Date.now())
    const { engine, current, save, simulate, bridge } = fixture({ text })
    current.ironman = { on: true, seq: 8, sinceWallMs: 1 }
    bridge.ironmanLedger.mockResolvedValue({ ok: true, seq: 8 })
    expect(await engine.importCloudSave(text)).toEqual({ ok: false, error: 'ui.engine.051' })
    expect(engine.state).toBe(current)
    expect(simulate).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('runs offline settlement before commit, then persists before replacing memory', async () => {
    const incoming = createInitialState({ nowWallMs: 0, seed: 12 })
    incoming.wallet.isk = 222
    const text = serializeSaveFile(incoming, 1)
    const { engine, save, report, sync, simulate, loadCheck } = fixture({ text })
    expect(await engine.importCloudSave(text)).toEqual({ ok: true })
    expect(sync).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledOnce()
    expect(simulate).toHaveBeenCalledOnce()
    expect(loadCheck).toHaveBeenCalledWith(text, 1, false)
    expect(engine.state.wallet.isk).toBe(232)
    expect(JSON.parse(save.mock.calls[0]![0]).state.wallet.isk).toBe(232)
  })

  it('holds an exclusive load guard across awaited validation', async () => {
    const held = gate()
    const incoming = createInitialState({ nowWallMs: 0, seed: 12 })
    const { engine, save, current, probe, bridge } = fixture({ text: serializeSaveFile(incoming, 1), gate: async () => { await held.promise; return { ok: true, rescue: false } } })
    const resolve = vi.fn(async () => ({ ok: true }))
    Object.assign(bridge, { saveFile: { resolve } })
    probe.reconnectChoice = { token: 1, text: serializeSaveFile(incoming, 1) }
    const first = engine.importCloudSave(serializeSaveFile(incoming, 1))
    await flush()
    expect(engine.saveWriteState()).toBe('paused')
    expect(await engine.importCloudSave(serializeSaveFile(incoming, 1))).toMatchObject({ ok: false })
    expect(await engine.importSaveFromFile()).toMatchObject({ ok: false })
    expect(await engine.restoreBackup('old')).toMatchObject({ ok: false })
    expect(await engine.resolveReconnectLocalSave('current')).toEqual({ ok: false })
    expect(resolve).not.toHaveBeenCalled()
    expect(bridge.pickImportSave).not.toHaveBeenCalled()
    expect(bridge.readBackup).not.toHaveBeenCalled()
    expect(await engine.persist()).toBe(false)
    expect(await engine.exportCloudSave()).toEqual({ ok: false, error: 'ui.engine.027' })
    engine.tick()
    expect(engine.state).toBe(current)
    expect(current.gameMs).toBe(0)
    expect((probe.winCache as { pause: ReturnType<typeof vi.fn> }).pause).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
    held.release()
    expect(await first).toEqual({ ok: true })
  })

  it('does not replace memory or write an old snapshot while candidate persistence is pending', async () => {
    const entered = gate()
    const held = gate()
    const incoming = createInitialState({ nowWallMs: 0, seed: 12 })
    const { engine, current, save } = fixture({ text: serializeSaveFile(incoming, 1) })
    save.mockImplementation(async (text: string) => { entered.release(); await held.promise; return text.length > 0 })
    const loading = engine.importCloudSave(serializeSaveFile(incoming, 1))
    await entered.promise
    expect(save).toHaveBeenCalledOnce()
    expect(engine.state).toBe(current)
    expect(engine.saveWriteState()).toBe('paused')
    expect(await engine.persist()).toBe(false)
    expect(save).toHaveBeenCalledOnce()
    expect(engine.state).toBe(current)
    held.release()
    expect(await loading).toEqual({ ok: true })
    expect(engine.state).not.toBe(current)
  })

  it('routes file import through the same validation and commit chain', async () => {
    const incoming = createInitialState({ nowWallMs: 0, seed: 12 })
    const { engine, simulate, sync, save } = fixture({ text: serializeSaveFile(incoming, 1) })
    expect(await engine.importSaveFromFile()).toEqual({ ok: true })
    expect(sync).toHaveBeenCalledOnce()
    expect(simulate).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
    expect(engine.state.wallet.isk).toBe(10 + createInitialState({ nowWallMs: 0, seed: 12 }).wallet.isk)
  })

  it('preserves the backup restore validation and commit chain', async () => {
    const incoming = createInitialState({ nowWallMs: 0, seed: 12 })
    const { engine, simulate, sync, save } = fixture({ text: serializeSaveFile(incoming, 1) })
    expect(await engine.restoreBackup('backup.json')).toEqual({ ok: true })
    expect(sync).toHaveBeenCalledOnce()
    expect(simulate).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
  })

  it.each(['file', 'backup'] as const)('locks the entire %s read before its first await', async source => {
    const hold = gate()
    const text = serializeSaveFile(createInitialState({ nowWallMs: 0, seed: 12 }), 1)
    const { engine, bridge, save } = fixture({ text })
    const read = source === 'file' ? bridge.pickImportSave : bridge.readBackup
    read.mockImplementation(async () => { await hold.promise; return { ok: true, text } })
    const loading = source === 'file' ? engine.importSaveFromFile() : engine.restoreBackup('backup.json')
    expect(engine.saveWriteState()).toBe('paused')
    expect(await engine.importCloudSave(text)).toEqual({ ok: false, error: 'ui.engine.027' })
    expect(await engine.persist()).toBe(false)
    expect(save).not.toHaveBeenCalled()
    hold.release()
    expect(await loading).toEqual({ ok: true })
    expect(engine.saveWriteState()).toBe('ok')
  })

  it('rejects a cloud load while a local reconnect commit is awaiting persistence', async () => {
    const hold = gate()
    const { engine, current, probe, bridge } = fixture()
    Object.assign(bridge, { saveFile: { resolve: vi.fn(async () => {
      await hold.promise
      return { ok: true, browserSaved: true, fileSaved: true }
    }) } })
    probe.reconnectChoice = { token: 1, text: serializeSaveFile(current, 1) }
    const reconnect = engine.resolveReconnectLocalSave('current')
    expect(await engine.importCloudSave(serializeSaveFile(current, 1))).toEqual({ ok: false, error: 'ui.engine.027' })
    expect(await engine.persist()).toBe(false)
    hold.release()
    expect(await reconnect).toMatchObject({ ok: true })
    expect(engine.saveWriteState()).toBe('ok')
  })

  it.each(['cloud', 'file', 'backup', 'reconnect', 'resolve-current', 'resolve-file'] as const)(
    '%s excludes every other public load entry across its await', async owner => {
      const entered = gate()
      const hold = gate()
      const wait = async () => { entered.release(); await hold.promise }
      const text = serializeSaveFile(createInitialState({ nowWallMs: 0, seed: 12 }), 1)
      const { engine, probe, bridge, save, current } = fixture({ text,
        ...(owner === 'cloud' ? { gate: async (): Promise<LoadGate> => {
          await wait()
          return { ok: true, rescue: false }
        } } : {}),
      })
      if (owner === 'file') bridge.pickImportSave.mockImplementation(async () => {
        await wait()
        return { ok: true, text }
      })
      if (owner === 'backup') bridge.readBackup.mockImplementation(async () => {
        await wait()
        return { ok: true, text }
      })
      const reconnect = vi.fn(async () => {
        await wait()
        return { ok: false }
      })
      const resolve = vi.fn(async () => {
        await wait()
        return { ok: true, browserSaved: true, fileSaved: true }
      })
      Object.assign(bridge, { saveFile: { reconnect, resolve } })
      Object.assign(probe, { reconnectChoice: { token: 1, text }, ensureSaveInterval: vi.fn() })
      const requests = {
        cloud: () => engine.importCloudSave(text),
        file: () => engine.importSaveFromFile(),
        backup: () => engine.restoreBackup('backup.json'),
        reconnect: () => engine.reconnectLocalSave(),
        'resolve-current': () => engine.resolveReconnectLocalSave('current'),
        'resolve-file': () => engine.resolveReconnectLocalSave('file'),
      }
      const loading = requests[owner]()
      await entered.promise
      const calls = () => [bridge.pickImportSave.mock.calls.length, bridge.readBackup.mock.calls.length,
        reconnect.mock.calls.length, resolve.mock.calls.length, save.mock.calls.length]
      const before = calls()
      try {
        for (const request of Object.values(requests)) expect((await request()).ok).toBe(false)
        expect(calls()).toEqual(before)
        expect(engine.state).toBe(current)
        expect(await engine.persist()).toBe(false)
        expect(engine.saveWriteState()).toBe('paused')
      } finally { hold.release() }
      expect((await loading).ok).toBe(owner !== 'reconnect')
      expect(engine.saveWriteState()).toBe('ok')
    },
  )

  it('rejects an overlapping private commit without releasing another reconnect lock', async () => {
    const { probe, current, save } = fixture()
    probe.reconnectResolving = true
    const commit = probe.commitLoadedSave as (state: State, report: null, rescue: boolean) => Promise<boolean>
    expect(await commit.call(probe, structuredClone(current), null, false)).toBe(false)
    expect(probe.reconnectResolving).toBe(true)
    expect(save).not.toHaveBeenCalled()
    expect(probe.state).toBe(current)
  })

  it.each([false, true])('records ironman rescue only after a successful candidate write (%s)', async write => {
    const incoming = createInitialState({ nowWallMs: 0, seed: 12 })
    incoming.ironman = { on: true, seq: 2, sinceWallMs: 1 }
    const text = serializeSaveFile(incoming, Date.now() - 49 * 3_600_000)
    const { engine, current, bridge, save, rescue, backup } = fixture({ text, write })
    current.ironman = { on: true, seq: 8, sinceWallMs: 1 }
    bridge.ironmanLedger.mockResolvedValue({ ok: true, seq: 10 })
    expect((await engine.importCloudSave(text)).ok).toBe(write)
    expect(JSON.parse(save.mock.calls[0]![0]).state.ironman.seq).toBe(11)
    expect(rescue).toHaveBeenCalledTimes(write ? 1 : 0)
    expect(backup).not.toHaveBeenCalled()
    expect(engine.saveWriteState()).toBe('ok')
    if (write) expect(engine.state.ironman!.seq).toBe(11)
    else expect(engine.state).toBe(current)
  })

  it('settles elapsed offline game time with the real core simulator before persistence', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(120_000)
    const incoming = createInitialState({ nowWallMs: 60_000, seed: 12 })
    const text = serializeSaveFile(incoming, 60_000)
    const { engine, save, simulate, backup } = fixture({ text, realOffline: true })
    expect(await engine.importCloudSave(text)).toEqual({ ok: true })
    expect(simulate).toHaveBeenCalledOnce()
    expect(simulate.mock.calls[0]!.slice(1, 3)).toEqual([60_000, 120_000])
    expect(engine.state.gameMs).toBe(60_000)
    expect(JSON.parse(save.mock.calls[0]![0]).state.gameMs).toBe(60_000)
    expect(JSON.parse(save.mock.calls[0]![0]).state.logs).toEqual([])
    expect(backup).not.toHaveBeenCalled()
  })
})
