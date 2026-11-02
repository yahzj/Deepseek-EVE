/**
 * **本机音效偏好**（总音量 / 静音 / 四类分类音量）—— 2026-11-02。
 *
 * 与语言、缩放、主题同族：存 `localStorage`，**不进存档**、零迁移、换设备不同步。
 * 键：`whale-idle:sfx`；值为 `{ muted, master, categories }` 的 JSON（坏了逐字段回落默认）。
 * 改动会派发 `whale-sfx-prefs-change`，播放层与设置面板各自订阅，不靠 React 树穿透。
 */
import { useCallback, useEffect, useState } from 'react'
import { defaultSfxPrefs, parseSfxPrefs } from './rules'
import type { SfxCategory } from './cues'
import type { SfxPrefs } from './rules'

export const SFX_PREFS_KEY = 'whale-idle:sfx'
const SFX_PREFS_EVENT = 'whale-sfx-prefs-change'

let cache: SfxPrefs | null = null

/** 读本机偏好（进程内缓存；存储不可用时用默认，绝不让调用方崩） */
export function readSfxPrefs(): SfxPrefs {
  if (cache !== null) return cache
  try {
    cache = parseSfxPrefs(localStorage.getItem(SFX_PREFS_KEY))
  } catch {
    cache = defaultSfxPrefs()
  }
  return cache
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(SFX_PREFS_EVENT))
  } catch {
    /* 非浏览器环境（工具/探针）忽略 */
  }
}

/** 写本机偏好（同时刷新缓存并派发变更事件） */
export function writeSfxPrefs(next: SfxPrefs): void {
  cache = next
  try {
    localStorage.setItem(SFX_PREFS_KEY, JSON.stringify(next))
  } catch {
    /* 存储被禁：本次会话内仍按内存值生效 */
  }
  notify()
}

/** 恢复默认音量（音效台的"全部恢复"入口） */
export function resetSfxPrefs(): void {
  writeSfxPrefs(defaultSfxPrefs())
}

/** 订阅偏好变更（返回退订函数） */
export function subscribeSfxPrefs(fn: () => void): () => void {
  try {
    window.addEventListener(SFX_PREFS_EVENT, fn)
    return () => window.removeEventListener(SFX_PREFS_EVENT, fn)
  } catch {
    return () => {}
  }
}

/** 设置面板/音效台用的偏好状态（读写同一份；外部写入也会同步刷新） */
export function useSfxPrefs(): {
  prefs: SfxPrefs
  setMaster: (v: number) => void
  setMuted: (muted: boolean) => void
  setCategory: (category: SfxCategory, v: number) => void
  reset: () => void
} {
  const [prefs, setPrefs] = useState<SfxPrefs>(() => readSfxPrefs())
  useEffect(() => {
    setPrefs(readSfxPrefs())
    return subscribeSfxPrefs(() => setPrefs(readSfxPrefs()))
  }, [])
  const setMaster = useCallback((v: number) => {
    const cur = readSfxPrefs()
    writeSfxPrefs({ ...cur, master: v })
  }, [])
  const setMuted = useCallback((muted: boolean) => {
    const cur = readSfxPrefs()
    writeSfxPrefs({ ...cur, muted })
  }, [])
  const setCategory = useCallback((category: SfxCategory, v: number) => {
    const cur = readSfxPrefs()
    writeSfxPrefs({ ...cur, categories: { ...cur.categories, [category]: v } })
  }, [])
  const reset = useCallback(() => resetSfxPrefs(), [])
  return { prefs, setMaster, setMuted, setCategory, reset }
}
