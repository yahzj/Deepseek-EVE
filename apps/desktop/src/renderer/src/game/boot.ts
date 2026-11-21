import { installLayoutStyles } from '../ui/layoutStyles'
import { applySpaceBg } from '../ui/spaceBg'
import { bootstrapTheme } from '../ui/theme'
import { applyFontScale } from '../ui/uiScale'
import { applyFontChoice, readFontChoice } from '../ui/fontChoice'
import { applyCrtEffect, readCrtEffect } from '../ui/crtEffect'
import { installAudio, attachAudioEngine } from './audio'
import { probeSaveStorage } from './saveGuard'
import type { GameEngine } from './engine'
import { acquireSaveWriter } from './saveWriter'
import type { BootStageId } from './bootProgress'

export interface BootRunOptions {
  /** 真实启动工序回调：只在工序真正完成时上报，驱动首屏进度 */
  onStage?: (stage: BootStageId) => void
  /** 工序内细分位置；超时判失败时用于定位卡点 */
  onNote?: (note: string) => void
}

export function prebootRenderer(): void {
  installLayoutStyles()
  applySpaceBg()
  bootstrapTheme()
  applyFontScale()
  applyFontChoice(readFontChoice())
  applyCrtEffect(readCrtEffect())
  installAudio()
}

export async function startGameEngine(engine: GameEngine, options?: BootRunOptions): Promise<boolean> {
  options?.onStage?.('lock')
  if (await acquireSaveWriter() !== 'writer') return false
  options?.onStage?.('probe')
  try {
    await probeSaveStorage()
  } catch {
  }
  await engine.start(options)
  attachAudioEngine(engine)
  return true
}
