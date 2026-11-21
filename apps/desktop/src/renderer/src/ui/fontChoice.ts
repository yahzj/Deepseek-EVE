
export type FontChoice = 'default' | 'retro'

export const FONT_KEY = 'whale-idle:ui-font'

export const FONT_CHOICES: readonly FontChoice[] = ['default', 'retro']

const RETRO_STACK =
  "'Fusion Pixel 12px Mono zh-Hans', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif"

const STACK: Record<FontChoice, string | null> = {
  default: null,
  retro: RETRO_STACK,
}

export const FONT_VAR = '--ui-font'

export function readFontChoice(): FontChoice {
  try {
    if (typeof localStorage === 'undefined') return 'default'
    const raw = localStorage.getItem(FONT_KEY)
    return raw === 'retro' || raw === 'unifont' || raw === 'unscii' ? 'retro' : 'default'
  } catch {
    return 'default'
  }
}

export function saveFontChoice(choice: FontChoice): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(FONT_KEY, choice)
  } catch {
  }
}

export function applyFontChoice(choice: FontChoice): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root) return
  const stack = STACK[choice]
  if (stack === null) {
    delete root.dataset.uiFont
    root.style.removeProperty(FONT_VAR)
    return
  }
  root.dataset.uiFont = choice
  root.style.setProperty(FONT_VAR, stack)
}

export function chooseFont(choice: FontChoice): void {
  saveFontChoice(choice)
  applyFontChoice(choice)
}
