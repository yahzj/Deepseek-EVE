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
 *
 * 2026-09-06 手机浏览器适配（船长：悬浮窗在手机上显示不正常/疑似拿不到鼠标位置）：
 * - 手机横屏（.app-root.is-mobile-rot）时，提示层位于旋转后的"局部坐标空间"，与
 *   clientX/Y（物理视口）不一致 → 先按 root 的 --mob-scale/--mob-x/--mob-y 换算回局部坐标
 *   再布局与收边（与教程高亮框同一套逆变换）；
 * - 触屏合成鼠标事件常给出 (0,0) 等无效坐标 → 用全局最近一次真实 pointer 位置兜底；
 * - 无 hover 环境改为"点到即看"：任何 pointerdown/滚动都会收起当前提示，触碰带说明的元素后
 *   由浏览器合成的 enter 事件重新显示（锚在触点），避免提示残留在角落里。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ElementType, MouseEvent, ReactNode } from 'react'

interface TipState {
  content: ReactNode
  /** 锚点（局部坐标；渲染后按实际尺寸精修一次；< 0 表示已精修过） */
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

/** 布局空间度量：桌面 = 视口（恒等）；手机横屏 = root 旋转前的局部空间（与提示层坐标系一致） */
interface Metrics {
  rot: boolean
  s: number
  L: number
  T: number
  bw: number
  bh: number
}

function viewMetrics(): Metrics {
  if (typeof document !== 'undefined') {
    const root = document.querySelector<HTMLElement>('.app-root.is-mobile-rot')
    if (root) {
      const cs = window.getComputedStyle(root)
      const s = parseFloat(cs.getPropertyValue('--mob-scale'))
      const L = parseFloat(cs.getPropertyValue('--mob-x'))
      const T = parseFloat(cs.getPropertyValue('--mob-y'))
      if (Number.isFinite(s) && s > 0 && Number.isFinite(L) && Number.isFinite(T)) {
        return {
          rot: true,
          s,
          L,
          T,
          bw: root.offsetWidth || 1200,
          bh: root.offsetHeight || window.innerHeight,
        }
      }
    }
  }
  return { rot: false, s: 1, L: 0, T: 0, bw: window.innerWidth, bh: window.innerHeight }
}

/** 物理视口坐标 → 提示层局部坐标（局部(lx,ly)→视口：X = L + s·ly；Y = T − s·lx） */
function toLocal(m: Metrics, x: number, y: number): { x: number; y: number } {
  if (!m.rot) return { x, y }
  return { x: (m.T - y) / m.s, y: (x - m.L) / m.s }
}

/** 最近一次真实指针位置（pointerdown/pointermove 维护；兜底触屏合成事件给出的 (0,0) 坐标） */
const lastPt = { x: -1, y: -1 }
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    lastPt.x = e.clientX
    lastPt.y = e.clientY
  }, { passive: true })
  window.addEventListener('pointermove', (e) => {
    lastPt.x = e.clientX
    lastPt.y = e.clientY
  }, { passive: true })
}

/** 首帧占位定位（粗估；TooltipLayer 渲染后会按实际尺寸精修一次） */
function place(content: ReactNode, cx: number, cy: number): void {
  const m = viewMetrics()
  let px = cx
  let py = cy
  if (px === 0 && py === 0 && lastPt.x >= 0) {
    px = lastPt.x
    py = lastPt.y
  }
  const lp = toLocal(m, px, py)
  const estH = 160
  let x = lp.x + 14
  let y = lp.y + 16
  if (x + TIP_W + PAD > m.bw) x = lp.x - TIP_W - 12 // 右侧放不下 → 锚点左侧
  if (y + estH + PAD > m.bh) y = lp.y - estH - 10 // 下方放不下 → 锚点上方
  x = Math.max(PAD, Math.min(m.bw - TIP_W - PAD, x))
  y = Math.max(PAD, Math.min(m.bh - estH - PAD, y))
  current = { content, cx: lp.x, cy: lp.y, x: Math.round(x), y: Math.round(y) }
  emit()
}

/** 显示富内容/文本提示（跟随光标右下，自动边缘翻转与收敛） */
export function showTip(content: ReactNode, clientX: number, clientY: number): void {
  place(content, clientX, clientY)
}

/** 指针高频更新：rAF 节流 */
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

  // 无 hover 的触屏交互：点任意处/滚动先收起提示（触碰带说明元素后由合成 enter 重新显示）
  useEffect(() => {
    const dismiss = (): void => hideTip()
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [])

  // 渲染后按实际尺寸精修落点（首帧估算 → 实测翻转/收敛一次；cx < 0 表示已精修）
  useLayoutEffect(() => {
    if (!state || state.cx < 0) return
    const el = ref.current
    if (!el) return
    const m = viewMetrics()
    const w = el.offsetWidth
    const h = el.offsetHeight
    let x = state.cx + 14
    let y = state.cy + 16
    if (x + w + PAD > m.bw) x = state.cx - w - 12
    if (y + h + PAD > m.bh) y = state.cy - h - 10
    x = Math.max(PAD, Math.min(m.bw - w - PAD, x))
    y = Math.max(PAD, Math.min(m.bh - h - PAD, y))
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
