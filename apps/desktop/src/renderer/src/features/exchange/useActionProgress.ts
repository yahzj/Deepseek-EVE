/**
 * 钱包变动类按钮的「进行中」进度条。
 *
 * 为什么要做：入金/申购/赎回/下单都要等一次往返，玩家点下去后按钮只是禁用，
 * 看起来像没反应。这里给按钮加一条从左到右的绿色覆盖，明确「请求在通讯中」。
 *
 * 口径：
 * - 进度是**不确定进度**（服务端没给进度），爬到 90% 后停住，返回后补到 100% 并淡出；
 * - 只做视觉，不参与业务判断；按钮的 disabled 仍由各卡片的 busy 状态控制。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

export interface ActionProgress {
  /** 0~100，写成 CSS 变量给 `.ex-btn-progress` 用 */
  pct: number
  /** 是否处于进行中（false 时不画覆盖层） */
  active: boolean
  start: () => void
  finish: () => void
}

/** 不确定进度的爬升节奏：每 120ms 逼近 90%，越接近越慢。 */
const TICK_MS = 120
const CEIL = 90

export function useActionProgress(): ActionProgress {
  const [pct, setPct] = useState(0)
  const [active, setActive] = useState(false)
  const timerRef = useRef<number | null>(null)
  const doneTimerRef = useRef<number | null>(null)

  const clear = (): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (doneTimerRef.current !== null) {
      window.clearTimeout(doneTimerRef.current)
      doneTimerRef.current = null
    }
  }

  const start = useCallback(() => {
    clear()
    setActive(true)
    setPct(6)
    timerRef.current = window.setInterval(() => {
      setPct((p) => (p >= CEIL ? CEIL : p + Math.max(1, Math.round((CEIL - p) * 0.08))))
    }, TICK_MS)
  }, [])

  const finish = useCallback(() => {
    clear()
    setPct(100)
    doneTimerRef.current = window.setTimeout(() => {
      setActive(false)
      setPct(0)
    }, 320)
  }, [])

  useEffect(() => clear, [])

  return { pct, active, start, finish }
}

/** 把进度写成内联 CSS 变量；不进行中时返回 undefined，避免污染按钮样式。 */
export function progressStyle(progress: ActionProgress): CSSProperties | undefined {
  if (!progress.active) return undefined
  return { '--ex-progress': `${progress.pct}%` } as CSSProperties
}
