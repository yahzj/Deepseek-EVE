import { describe, expect, it, vi } from 'vitest'
import { createInitialState, CURRENT_STATE_VERSION } from '../src/state'
import { loadSaveFile, SaveError, serializeSaveFile } from '../src/save'
import { bumpIronmanSeq } from '../src/ironman'
import { gameSaveMethods } from './helpers/save-shell'

describe('旧版本拒读后的外壳保存保护', () => {
  it.each([24, 30, CURRENT_STATE_VERSION + 1])('v%s 被拒后原文不变，玩家明确放行前不保存', async (version) => {
    const file = JSON.parse(serializeSaveFile(createInitialState({ nowWallMs: 0, seed: 21 }), 0))
    file.version = version
    const original = JSON.stringify(file)
    let stored = original
    const save = vi.fn(async (text: string) => { stored = text; return true })
    const ensureSaveInterval = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const probe = gameSaveMethods(['start', 'saveWriteState', 'persist', 'persistSnapshot', 'allowSaveAfterLoadError'], {
      createInitialState, loadSaveFile, SaveError, serializeSaveFile, bumpIronmanSeq,
      saveStorageProbe: () => ({ ok: true }), canWriteSave: () => true,
      saveBridge: { load: async () => stored, save },
      migrateDeprecatedAmmo: vi.fn(), wormholeNormalizeLegacyTemp: vi.fn(),
      repairDeprecatedModules: vi.fn(), repairMisplacedWarehouseModules: vi.fn(), repairHoldForbiddenCargo: vi.fn(),
      requestPersistentStorage: vi.fn(), noteSaveWriteFailed: vi.fn(),
      tr: (id: string) => id, addLog: vi.fn(), window: { addEventListener: vi.fn() },
    })
    Object.assign(probe, {
      state: createInitialState({ nowWallMs: 0, seed: 1 }), savePaused: false, saveUnavailable: false,
      winCache: { reset: vi.fn() }, ensurePump: vi.fn(), ensureSaveInterval,
      notify: vi.fn(), installWormholeTestApi: vi.fn(), installPlanetaryTestApi: vi.fn(),
    })
    const engine = probe as unknown as {
      state: ReturnType<typeof createInitialState>
      start(): Promise<void>
      saveWriteState(): string
      persist(): Promise<boolean>
      allowSaveAfterLoadError(): Promise<boolean>
    }
    try {
      await engine.start()
      expect(engine.saveWriteState()).toBe('paused')
      expect(await engine.persist()).toBe(false)
      expect(ensureSaveInterval).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
      expect(stored).toBe(original)
      expect(await engine.allowSaveAfterLoadError()).toBe(true)
      expect(save).toHaveBeenCalledTimes(1)
      expect(ensureSaveInterval).toHaveBeenCalledTimes(1)
      expect(loadSaveFile(stored).state.version).toBe(CURRENT_STATE_VERSION)
    } finally {
      error.mockRestore()
    }
  })
})
