/**
 * 钱包变动类按钮的「进行中」进度条。
 *
 * 为什么要做：入金/申购/赎回/下单都要等一次往返，玩家点下去后按钮只是禁用，
 * 看起来像没反应。这里给按钮加一条从左到右的绿色覆盖，明确「请求在通讯中」。
 *
 * 口径：
 * - 进度是**不确定进度**（服务端没给进度），爬到 90% 后停住，返回后补到 100% 并淡出；
 * - 成功回执满格后释放账户与委托显示；失败清除进度，绝不显示成功满格。
 * - 按钮的 disabled 仍由各卡片的 busy 状态控制。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ExchangeClient } from './client'

export interface ActionProgress {
  /** 0~100，写成 CSS 变量给 `.ex-btn-progress` 用 */
  pct: number
  /** 是否处于进行中（false 时不画覆盖层） */
  active: boolean
  start: () => void
  finish: (success?: boolean) => Promise<void>
}

/** 不确定进度的爬升节奏：每 120ms 逼近 90%，越接近越慢。 */
const TICK_MS = 120
const CEIL = 90

export function useActionProgress(client?: ExchangeClient): ActionProgress {
  const [pct, setPct] = useState(0)
  const [active, setActive] = useState(false)
  const timerRef = useRef<number | null>(null)
  const doneTimerRef = useRef<number | null>(null)
  const releaseRef = useRef<(() => void) | null>(null)
  const generationRef = useRef(0)

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
    generationRef.current += 1
    clear()
    releaseRef.current?.()
    releaseRef.current = client?.holdAccountUpdates?.() ?? null
    setActive(true)
    setPct(6)
    timerRef.current = window.setInterval(() => {
      setPct((p) => (p >= CEIL ? CEIL : p + Math.max(1, Math.round((CEIL - p) * 0.08))))
    }, TICK_MS)
  }, [client])

  const finish = useCallback(async (success = true) => {
    const generation = generationRef.current
    clear()
    setPct(success ? 100 : 0)
    // 留一帧满格反馈，再同时释放账户与委托，避免先变数字后满格。
    if (success) await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
    if (generation !== generationRef.current) return
    releaseRef.current?.()
    releaseRef.current = null
    if (!success) {
      setActive(false)
      return
    }
    doneTimerRef.current = window.setTimeout(() => {
      setActive(false)
      setPct(0)
    }, 320)
  }, [])

  useEffect(() => () => {
    generationRef.current += 1
    clear()
    releaseRef.current?.()
    releaseRef.current = null
  }, [])

  return { pct, active, start, finish }
}

/** 把进度写成内联 CSS 变量；不进行中时返回 undefined，避免污染按钮样式。 */
export function progressStyle(progress: ActionProgress): CSSProperties | undefined {
  if (!progress.active) return undefined
  return {
    '--ex-progress': `${progress.pct}%`,
  } as CSSProperties
}
