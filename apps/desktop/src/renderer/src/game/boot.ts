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

export function prebootRenderer(): void {
  installLayoutStyles()
  applySpaceBg()
  bootstrapTheme()
  applyFontScale()
  applyFontChoice(readFontChoice())
  applyCrtEffect(readCrtEffect())
  installAudio()
}

export async function startGameEngine(engine: GameEngine): Promise<boolean> {
  if (await acquireSaveWriter() !== 'writer') return false
  try {
    await probeSaveStorage()
  } catch {
  }
  await engine.start()
  attachAudioEngine(engine)
  return true
}
