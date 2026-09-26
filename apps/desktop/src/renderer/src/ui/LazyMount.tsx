/**
 * **视口懒挂载**（**2026-09-27 船长令**：「**组装机的卡片太多了，能否采用流式加载？当卡片靠近玩家屏幕时才加载**」）。
 *
 * 为什么要有它：工业页「组装机」一次要摆 **151 张卡 ≈ 9,116 个节点**（真档实测）。2026-09-13 那批已在 CSS 层
 * 用 `content-visibility: auto`（`.app-belt-card.is-assembler`）让**屏外卡不参与布局/绘制**，可 **React 仍会
 * 一次性把 9,116 个节点全建出来** ⇒ 切到组装机那一栏照样阻塞（6× 降速下：提交 92 ms、最长长任务 794 ms）。
 *
 * 本件把"建 DOM"这件事也推迟到**卡片靠近屏幕**时：
 *   - `IntersectionObserver` ＋ `rootMargin = '100% 0px 100% 0px'`（**视口上下各 1 屏**，船长批准的预制距离）；
 *   - 相交 ⇒ 挂真卡并**立刻断开观察**（挂上就不再卸 —— 本批不做虚拟滚动，卸载会带来几何与状态风险）；
 *   - 未挂载 ⇒ 渲染一枚**等高空白占位**，高度必须贴近真卡高（见 `ASSEMBLER_CARD_MIN_H`），否则滚动条与落点会漂。
 *
 * ⚠ **包裹层不能改变网格项**：卡片是 `.app-belt-grid` 的直接子项（CSS 网格按它排版）。挂载后用
 * `display: contents` 让包裹层**不生成盒子** ⇒ 网格项仍是卡片本身，版式一字不动；占位时包裹层自己当那一格。
 *
 * ⚠ **没有 IntersectionObserver 就一律直挂**（老壳/工具环境）：宁可慢，不许白屏。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * 组装机卡片的**占位高度**（px）。
 *
 * 数值来源 = 与 `styles.css` 那条 `.app-belt-card.is-assembler { contain-intrinsic-size: auto 523px }` **同一次实测**
 * （2026-09-13）：真档下四列网格真实总高 20,455 px；占位 523 px ⇒ 总高 20,611（**+0.7%**），且"整表滚一遍"
 * 前后总高与落点完全一致。改这个数必须重新量一遍（两处**必须同值**，否则占位与 `content-visibility` 的估高会打架）。
 */
export const ASSEMBLER_CARD_MIN_H = 523

/** 预制距离：视口上下各一屏（船长 2026-09-27 批准） */
const NEAR_MARGIN = '100% 0px 100% 0px'

export function LazyMount({
  eager = false,
  minHeight,
  children,
}: {
  /** 免观察直接挂载（首屏块、空闲补块、被跳转定位的那一张） */
  eager?: boolean
  /** 占位高度（px）—— 必须贴近真卡高（见 `ASSEMBLER_CARD_MIN_H` 的说明） */
  minHeight: number
  children: ReactNode
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(eager)

  /** `eager` 后到（如跳转定位、空闲补块）⇒ 跟上，不必等观察 */
  useEffect(() => {
    if (eager) setShown(true)
  }, [eager])

  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (el === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: NEAR_MARGIN },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  return (
    <div
      ref={ref}
      /* 未挂载：占位盒（空白，无骨架——船长批准"纯空白"）；挂载后：`display: contents` 让出网格项 */
      style={shown ? { display: 'contents' } : { minHeight }}
      aria-hidden={shown ? undefined : true}
    >
      {shown ? children : null}
    </div>
  )
}

/**
 * **空闲补块**（船长批准的"乙"）：首屏块之后，用空闲回调再补一段。
 * 目的 = 玩家滚得快时少看见空白；**不是**把全表都偷偷挂上（那等于白做）。
 * 返回值从 0 起，空闲回调跑完变成 `size`。
 */
export function useIdleChunk(size: number, delayMs = 300): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    if (typeof ric === 'function') {
      const id = ric(() => setN(size))
      const cancel = (globalThis as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
      return () => {
        if (typeof cancel === 'function') cancel(id)
      }
    }
    const t = globalThis.setTimeout(() => setN(size), delayMs)
    return () => globalThis.clearTimeout(t)
  }, [size, delayMs])
  return n
}
