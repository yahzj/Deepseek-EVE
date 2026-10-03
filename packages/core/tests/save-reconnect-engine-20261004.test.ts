import { describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../src/state'
import { bumpIronmanSeq } from '../src/ironman'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { gameSaveMethods, runSaveModule } from './helpers/save-shell'

const filePath = 'apps/desktop/src/renderer/src/game/saveReconnect.ts'
type State = ReturnType<typeof createInitialState>
type Outcome = { ok: boolean; loaded?: boolean; filePaused?: boolean; choice?: object; error?: string }
interface EngineProbe {
  state: State
  reconnectLocalSave(): Promise<Outcome>
  resolveReconnectLocalSave(choice: 'current' | 'file'): Promise<Outcome>
  cancelReconnectLocalSave(): void
}
function fixture(result: object, gate = true) {
  const incoming = createInitialState({ nowWallMs: 0, seed: 7 })
  incoming.wallet.isk = 222
  const text = serializeSaveFile(incoming, 1)
  const api = { reconnect: vi.fn(async () => ({ ok: true, text, token: 1, name: 'test.json' })),
    resolve: vi.fn(async () => result), resume: vi.fn(async () => ({ ok: true })) }
  const saved = vi.fn(async () => true)
  const probe = gameSaveMethods(['currentSaveText', 'reconnectLocalSave', 'resolveReconnectLocalSave', 'reconnectChanged', 'cancelReconnectLocalSave'], {
    serializeSaveFile, loadSaveFile, bumpIronmanSeq, canWriteSave: () => true,
    structuredClone,
    ...runSaveModule(filePath, { '@whale/core': { loadSaveFile, serializeSaveFile } }),
    saveBridge: { saveFile: api, load: async () => text, ironmanNoteRescue: saved },
    tr: (id: string) => id,
  })
  const current = createInitialState({ nowWallMs: 0, seed: 7 })
  current.wallet.isk = 111
  Object.assign(probe, { state: current, reconnectResolving: false,
    ironmanLoadCheck: vi.fn(async () => gate ? { ok: true, rescue: true } : { ok: false, error: 'IRONMAN-REJECT' }),
    syncIronmanHead: vi.fn(async () => {}), prepareImportedState: vi.fn(() => null),
    ensureSaveInterval: vi.fn(), notify: vi.fn(), savePaused: false,
  })
  return { engine: probe as unknown as EngineProbe, api, current, saved, probe }
}

describe('重连引擎的候选装载', () => {
  it('浏览器保存失败不替换当前状态，也不记救援', async () => {
    const { engine, current, saved } = fixture({ ok: false, browserSaved: false, fileSaved: false })
    expect((await engine.reconnectLocalSave()).choice).toBeDefined()
    expect((await engine.resolveReconnectLocalSave('file')).ok).toBe(false)
    expect(engine.state).toBe(current)
    expect(engine.state.wallet.isk).toBe(111)
    expect(saved).not.toHaveBeenCalled()
  })
  it('铁人拒绝不触达提交；取消后旧选择不可提交', async () => {
    const { engine, api, current } = fixture({ ok: true }, false)
    await engine.reconnectLocalSave()
    expect(await engine.resolveReconnectLocalSave('file')).toMatchObject({ ok: false, error: 'IRONMAN-REJECT' })
    expect(api.resolve).not.toHaveBeenCalled()
    expect(engine.state).toBe(current)
    engine.cancelReconnectLocalSave()
    expect((await engine.resolveReconnectLocalSave('current')).ok).toBe(false)
    expect(api.resolve).not.toHaveBeenCalled()
  })
  it('浏览器候选成功但文件失败，已载入且明确文件暂停，不报告未发生', async () => {
    const { engine, saved } = fixture({ ok: false, browserSaved: true, fileSaved: false })
    await engine.reconnectLocalSave()
    expect(await engine.resolveReconnectLocalSave('file')).toMatchObject({ ok: true, loaded: true, filePaused: true })
    expect(engine.state.wallet.isk).toBe(222)
    expect(saved).toHaveBeenCalledTimes(1)
  })
  it('文件变化返回新选择，不触碰当前游戏', async () => {
    const updated = createInitialState({ nowWallMs: 0, seed: 7 })
    updated.wallet.isk = 333
    const { engine, current } = fixture({ ok: false, changed: true, text: serializeSaveFile(updated, 2), token: 1 })
    await engine.reconnectLocalSave()
    expect(await engine.resolveReconnectLocalSave('current')).toMatchObject({ ok: false, error: 'ui.saveReconnect.009' })
    expect(engine.state).toBe(current)
  })
  it('成功装载只提交一个代次，剥离候选日志，准备一次', async () => {
    const { engine, api, probe } = fixture({ ok: true, browserSaved: true, fileSaved: true })
    await engine.reconnectLocalSave()
    expect(await engine.resolveReconnectLocalSave('file')).toMatchObject({ ok: true, loaded: true })
    expect(api.resolve).toHaveBeenCalledTimes(1)
    const args = api.resolve.mock.calls[0] as unknown as [number, string, string, string]
    expect(JSON.parse(args[2]).state.logs).toEqual([])
    expect(probe.prepareImportedState).toHaveBeenCalledTimes(1)
  })
})

describe('来源内容比较', () => {
  it('仅保存时刻不同视为相同，同一时刻不同进度仍有冲突', () => {
    const { sameReconnectProgress } = runSaveModule<{ sameReconnectProgress(a: string, b: string): boolean }>(filePath, {
      '@whale/core': { loadSaveFile, serializeSaveFile },
    })
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    expect(sameReconnectProgress(serializeSaveFile(state, 1), serializeSaveFile(state, 2))).toBe(true)
    const changed = structuredClone(state)
    changed.wallet.isk++
    expect(sameReconnectProgress(serializeSaveFile(state, 1), serializeSaveFile(changed, 1))).toBe(false)
  })
})
