/**
 * 轻量全局悬停提示（Tooltip）——全站统一的悬停说明机制。
 *
 * 用法：
 * - App 根部渲染一次 <TooltipLayer/>（fixed 单例，z 最高）；
 * - 纯文本：任意条目外包 <HoverTip as="li" tip="说明文字">…</HoverTip>；
 * - 富内容：调用 showTip(<ReactNode>, e.clientX, e.clientY) / moveTip(...) / hideTip()，
 *   或直接在组件上挂事件（ShipHover 等内部复用）；内容与文本提示同层渲染、同一定位规则；
 * - 位置：跟随鼠标（默认光标右下方），右侧/下方放不下自动翻到左/上方，并始终收敛在视口内；
 *   渲染后按实际尺寸再精修一次（富内容高度不同也能正确避让边缘）；
 * - 滚动列表内同样不受裁切（fixed 定位）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ElementType, MouseEvent, ReactNode } from 'react'

interface TipState {
  content: ReactNode
  /** 光标落点（用于渲染后按实际尺寸精修；< 0 表示已精修过） */
  cx: number
  cy: number
  x: number
  y: number
}

/** 预估提示宽度（与实际 CSS max-width 一致；渲染后按实测精修） */
const TIP_W = 300
const PAD = 8

const listeners = new Set<(s: TipState | null) => void>()
let current: TipState | null = null
let raf = 0

function emit(): void {
  for (const fn of listeners) fn(current)
}

/** 首帧占位定位（粗估；TooltipLayer 渲染后会按实际尺寸精修一次） */
function place(content: ReactNode, cx: number, cy: number): void {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const estH = 160
  let x = cx + 14
  let y = cy + 16
  if (x + TIP_W + PAD > vw) x = cx - TIP_W - 12 // 右侧放不下 → 光标左侧
  if (y + estH + PAD > vh) y = cy - estH - 10 // 下方放不下 → 光标上方
  x = Math.max(PAD, Math.min(vw - TIP_W - PAD, x))
  y = Math.max(PAD, Math.min(vh - estH - PAD, y))
  current = { content, cx, cy, x: Math.round(x), y: Math.round(y) }
  emit()
}

/** 显示富内容/文本提示（跟随光标右下，自动边缘翻转与收敛） */
export function showTip(content: ReactNode, clientX: number, clientY: number): void {
  place(content, clientX, clientY)
}

/** mousemove 高频更新：rAF 节流 */
export function moveTip(content: ReactNode, clientX: number, clientY: number): void {
  if (raf !== 0) return
  raf = requestAnimationFrame(() => {
    raf = 0
    place(content, clientX, clientY)
  })
}

/** 隐藏提示 */
export function hideTip(): void {
  if (raf !== 0) {
    cancelAnimationFrame(raf)
    raf = 0
  }
  if (current !== null) {
    current = null
    emit()
  }
}

export function TooltipLayer(): ReactNode {
  const [state, setState] = useState<TipState | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
    }
  }, [])

  // 渲染后按实际尺寸精修落点（首帧估算 → 实测翻转/收敛一次；cx < 0 表示已精修）
  useLayoutEffect(() => {
    if (!state || state.cx < 0) return
    const el = ref.current
    if (!el) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = el.offsetWidth
    const h = el.offsetHeight
    let x = state.cx + 14
    let y = state.cy + 16
    if (x + w + PAD > vw) x = state.cx - w - 12
    if (y + h + PAD > vh) y = state.cy - h - 10
    x = Math.max(PAD, Math.min(vw - w - PAD, x))
    y = Math.max(PAD, Math.min(vh - h - PAD, y))
    setState((s) => (s && s.cx >= 0 ? { ...s, cx: -1, cy: -1, x: Math.round(x), y: Math.round(y) } : s))
  }, [state])

  if (!state) return null
  return (
    <div ref={ref} className="app-tip" style={{ left: state.x, top: state.y }}>
      {state.content}
    </div>
  )
}

/**
 * 把任意元素包成"悬停出说明"。as 决定渲染标签（li/div/span…），
 * 其余属性（className 等）原样透传给该标签。tip 为纯文本；富内容请用 showTip。
 */
export function HoverTip({
  as,
  tip,
  children,
  ...rest
}: {
  as?: ElementType
  tip: string
  children: ReactNode
  [key: string]: unknown
}) {
  const Tag = (as ?? 'div') as ElementType
  if (!tip) return <Tag {...rest}>{children}</Tag>
  return (
    <Tag
      {...rest}
      onMouseEnter={(e: MouseEvent<HTMLElement>) => showTip(tip, e.clientX, e.clientY)}
      onMouseMove={(e: MouseEvent<HTMLElement>) => moveTip(tip, e.clientX, e.clientY)}
      onMouseLeave={() => hideTip()}
    >
      {children}
    </Tag>
  )
}
