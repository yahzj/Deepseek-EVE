/**
 * **界面配色（皮肤）**——2026-09-22 船长令：「玩家反应，现在的界面看着太吃力，我打算添加几套配色，
 * 用于让玩家切换（至少有一个是白色皮肤）」。
 *
 * 口径（船长已确认 · 见 `docs/design/ui-theme-20260922.md`）：
 * - 三套主题：`deepspace` 深空（默认 · 色值 = 改造前逐个字面量 ⇒ 老玩家视觉零变化）· `daylight` 亮白 ·
 *   `contrast` 高对比深色（**第二批**，本批先留好槽位与色板骨架，不在设置里露出）；
 * - 选择**存本机** `localStorage`（键 `whale-idle:ui-theme`，与语言 / 缩放 / 字号同族）⇒ **不进存档、零迁移**；
 * - 支持「跟随系统」：系统浅色 ⇒ 亮白 · 系统深色 ⇒ 深空（高对比只手动选）；
 * - 生效方式 = 在 `<html>` 上写 `data-theme` ⇒ **全部色板与语义色阶都是 CSS 变量，切换不触发 React 重渲染**、
 *   也不会"切了主题还有一半图标是旧色"。
 */
import { useEffect, useState } from 'react'

/** 主题 id（2026-09-22：深空 / 亮白 / 高对比 / 暖色护眼 / 纯黑夜间 / 色盲友好 共六套） */
export type ThemeId = 'deepspace' | 'daylight' | 'contrast' | 'warm' | 'night' | 'cb'
/** 玩家可选值：`auto` = 跟随系统 */
export type ThemeChoice = 'auto' | ThemeId

const THEME_KEY = 'whale-idle:ui-theme'

/** 设置面板里露出的选项（顺序 = 展示顺序） */
/**
 * 设置面板里露出的选项（顺序 = 展示顺序）。
 * ⚠ 2026-09-22 **待修**：`warm` / `night` / `cb` 三套的色板块已生成（键集与深空一致、色板层对比度达标），
 *   但**元素级体检未过**（真实底像素下约 400 处低于 3:1 —— 同一批元素在深空/亮白/高对比都正常，
 *   疑与"识别色既当文字又当半透明底"有关）⇒ **修好前不从设置里露出**，免得玩家点到半成品。
 *   ⚠ 只有列在本表里的主题才读得进来（`readChoice()` 按本表校验，表外值回落深空）⇒ 体检某套前先确认它在表内。
 */
export const THEME_CHOICES: readonly ThemeChoice[] = ['deepspace', 'daylight', 'contrast', 'warm', 'night', 'cb', 'auto'] as const

/** 文案 id（id 映射制：中文/英文都在 `packages/data/src/l10n/table.ts`） */
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
    /* 存储不可用（隐私模式 / 网页版被禁）⇒ 用默认 */
  }
  return 'deepspace'
}

/** 系统当前偏好（网页环境才有 `matchMedia`；取不到时按深色） */
export function systemPrefersLight(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    return false
  }
}

/** 玩家选择 → 实际生效的主题 */
export function resolveTheme(choice: ThemeChoice): ThemeId {
  if (choice !== 'auto') return choice
  return systemPrefersLight() ? 'daylight' : 'deepspace'
}

/** 把主题写到 `<html data-theme>`（默认主题也写，方便 CSS 只写覆盖块） */
export function applyTheme(choice: ThemeChoice): ThemeId {
  const id = resolveTheme(choice)
  try {
    document.documentElement.setAttribute('data-theme', id)
  } catch {
    /* 非浏览器环境（工具探针）忽略 */
  }
  return id
}

/** 启动即套用（`main.tsx` 在首帧前调用 ⇒ 不会先闪一下另一套配色） */
export function bootstrapTheme(): ThemeId {
  return applyTheme(readChoice())
}

/**
 * 主题状态：读本机偏好 + 立即生效 + 跟随系统时监听系统切换。
 * 返回 `[玩家选择, 设置选择回调, 实际生效的主题]`。
 */
export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void, ThemeId] {
  const [choice, setChoice] = useState<ThemeChoice>(() => readChoice())
  const [effective, setEffective] = useState<ThemeId>(() => resolveTheme(choice))
  useEffect(() => {
    setEffective(applyTheme(choice))
    try {
      localStorage.setItem(THEME_KEY, choice)
    } catch {
      /* 忽略 */
    }
  }, [choice])
  // 跟随系统：系统配色一变即时跟随（只在 auto 下挂监听）
  useEffect(() => {
    if (choice !== 'auto' || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => setEffective(applyTheme('auto'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [choice])
  return [choice, setChoice, effective]
}

/** 亮白皮肤不铺星云照片（船长选定「甲案」）：其它主题照旧 */
export function themeUsesSpacePhoto(id: ThemeId): boolean {
  return id !== 'daylight'
}

/**
 * 兜底套用（挂在 `App` 顶层）：**任何入口**（桌面 / 网页版 / 以后的别的壳）都必然经过 `App`，
 * 万一某个入口漏调 `bootstrapTheme()`，这里补上——省得"主题没生效"变成只在某个壳里复现的谜题。
 * （2026-09-22 实踩：网页版有独立入口 `web/src/main.tsx`，第一版只改了桌面入口 ⇒ 探针读到 `data-theme=null`。）
 */
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
