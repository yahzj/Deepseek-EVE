import { useEffect, useState } from 'react'

export type ThemeId = 'deepspace' | 'daylight' | 'contrast' | 'warm' | 'night' | 'cb'
export type ThemeChoice = 'auto' | ThemeId

const THEME_KEY = 'whale-idle:ui-theme'

export const THEME_CHOICES: readonly ThemeChoice[] = ['deepspace', 'contrast', 'warm', 'night', 'cb'] as const

export const THEME_LABEL_ID: Record<ThemeChoice, string> = {
  deepspace: 'ui.App.128',
  daylight: 'ui.App.129',
  contrast: 'ui.App.130',
  warm: 'ui.App.134',
  night: 'ui.App.135',
  cb: 'ui.App.136',
  auto: 'ui.App.131',
}

function readChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw && (THEME_CHOICES as readonly string[]).includes(raw)) return raw as ThemeChoice
  } catch {
  }
  return 'deepspace'
}

export function systemPrefersLight(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    return false
  }
}

export function resolveTheme(choice: ThemeChoice): ThemeId {
  if (choice === 'auto' || choice === 'daylight') return 'deepspace'
  return choice
}

export function applyTheme(choice: ThemeChoice): ThemeId {
  const id = resolveTheme(choice)
  try {
    document.documentElement.setAttribute('data-theme', id)
  } catch {
  }
  return id
}

export function bootstrapTheme(): ThemeId {
  return applyTheme(readChoice())
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void, ThemeId] {
  const [choice, setChoice] = useState<ThemeChoice>(() => readChoice())
  const [effective, setEffective] = useState<ThemeId>(() => resolveTheme(choice))
  useEffect(() => {
    setEffective(applyTheme(choice))
    try {
      localStorage.setItem(THEME_KEY, choice)
    } catch {
    }
  }, [choice])
  useEffect(() => {
    if (choice !== 'auto' || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => setEffective(applyTheme('auto'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [choice])
  return [choice, setChoice, effective]
}

export function themeUsesSpacePhoto(id: ThemeId): boolean {
  return id !== 'daylight'
}

export function useThemeBootstrap(): void {
  useEffect(() => {
    applyTheme(readChoice())
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => {
      if (readChoice() === 'auto') applyTheme('auto')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
}
