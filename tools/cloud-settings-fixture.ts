/** 云设置冒烟专用合成档；不读取磁盘存档，不依赖个人进度。 */
import { createInitialState, FIRST_TASKS, loadSaveFile, serializeSaveFile } from '../packages/core/src/index'

export const CLOUD_SMOKE_PILOT = 'CloudSmokePilot'
export const CLOUD_SMOKE_CHARACTER = 'CloudFixtureCaptain'

export function cloudSettingsFixture(wallet: 111 | 222 = 111, now = Date.now()): string {
  const state = createInitialState({ nowWallMs: now, seed: wallet })
  state.character.name = CLOUD_SMOKE_CHARACTER
  state.wallet.isk = wallet
  state.modeChosen = true
  state.onboarding.step = 99
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  state.logs = []
  return serializeSaveFile(state, now)
}

export function futureCloudFixture(): string {
  const value = JSON.parse(cloudSettingsFixture(222))
  value.version += 10_000
  value.state.version = value.version
  return JSON.stringify(value)
}

/** 仅返回非敏感投影；上传正文只在调用方内存中检查，不落入报告。 */
export function inspectCloudUpload(text: string): { format: string; wallet: number; characterName: string; emptyLogs: boolean; clean: boolean } {
  const file = JSON.parse(text)
  const parsed = loadSaveFile(text)
  function clean(value: unknown): boolean {
    if (!value || typeof value !== 'object') return true
    return Object.entries(value).every(([key, child]) =>
      !/token|password|recovery|authorization|session/i.test(key) && clean(child))
  }
  return { format: file.format, wallet: parsed.state.wallet.isk, characterName: parsed.state.character.name,
    emptyLogs: Array.isArray(file.state.logs) && file.state.logs.length === 0, clean: clean(file) }
}
