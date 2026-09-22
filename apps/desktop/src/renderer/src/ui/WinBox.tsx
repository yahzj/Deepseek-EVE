/**
 * **游戏内窗口壳（2026-09-20 船长令：战斗窗口改非全屏 · 新活动窗口照它做）**。
 *
 * 一处实现、两处消费：`panels/BattleScreen.tsx`（观战窗口）与 `ui/ActivityScreen.tsx`（主控活动窗口）。
 * 抽出来的理由就是船长那句「照它做」——窗口外观、最小化、还原入口必须**同源**，否则两处各写一份必然走形。
 *
 * 形态：
 * - **非全屏窗口**（复用 `.app-modal` 族的外观语汇：同款描边/圆角/阴影/深蓝渐变）；
 * - **覆盖主内容区**（2026-09-21 船长令：「悬浮窗口形式有些太遮挡了，改为覆盖在当前的主窗口上」）：
 *   本壳挂在 `.app-page-main` 里，窗口层用 `inset: 0` 吃那块 ⇒ **不盖左导航与顶栏**、去掉深色遮罩、
 *   窗外可点穿（非模态，打开窗口时底下照样能操作游戏）；
 * - **装不下就整块等比缩放**（2026-09-21 船长令：「窄屏窗口偏小采用等比缩放」）：窗口**永远按设计尺寸排版**
 *   （CSS 里的固定宽高），可用区装不下时对本块做 `transform: scale(s)`，`s = min(1, 可用宽/设计宽, 可用高/设计高)`
 *   ⇒ 任何屏幕都是**同一套版式**，只整体缩放；**不会**再出现"窄屏被压扁 ⇒ 内部转横滑/换行"的走形。
 *   只缩不放（`min(1, …)`）：设计尺寸就是目标尺寸，宽屏上与原样一致。
 * - **最小化**：`open=false` 时本壳**什么都不渲染**——还原入口在左侧舰船小窗
 *   （2026-09-21 船长令：「将左上角的小窗动画和右下角的最小化相关的按钮合并」⇒ 右下角那枚浮动标已撤，
 *   改由 `ui/ShipStatusWin.tsx` 在有窗口最小化时把小窗变成还原按钮）。判定与"何时自动弹出"留在消费方（App.tsx）。
 *
 * z 序：窗口 110 —— 低于详情窗（`.app-modal-mask` 120 / `.app-detail-mask` 140）与悬浮说明（1000），
 * 高于公告（88）⇒ 详情窗能盖住本窗，本窗能盖住页面内容。
 * ⚠ 本块带 `transform` ⇒ 会成为**包含块**；悬停说明是 App 根部那个 fixed 单例（不在本块内），故不受影响。
 *
 * 谁该用它：**"看一个持续过程"的界面**（战斗、主控活动）。一次性确认框继续用 `.app-modal` 原族，不要套本壳。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

export interface WinBoxProps {
  /** 根类名后缀（BEM 修饰），如 `app-winbox is-battle` / `app-winbox is-activity` */
  variant: string
  /** 顶栏标题（已译文案） */
  title: string
  /** 窗口是否展开；`false` ⇒ 本壳不渲染任何东西（还原入口在左侧舰船小窗） */
  open: boolean
  /** 最小化（关掉窗口，过程继续在后台跑） */
  onMinimize: () => void
  /** 顶栏最小化按钮的文字（已译文案），如「← 最小化」 */
  minimizeText: string
  /** 顶栏最小化按钮的 `title`（已译文案）：要说清"不中止过程"与"去哪儿再展开"。
   *  取 `showMinimizeButton={false}` 的消费方可省（壳里不渲染那枚按钮 ⇒ 用不到这个文案） */
  minimizeTitle?: string
  /**
   * 是否渲染壳自带的最小化按钮（缺省 true）。
   * 取 `false` 的场合：**内容自己顶栏里已经有一枚**（战斗屏 `.app-battle-screen-top` 就是），
   * 否则会出现两个"退出/最小化"按钮——2026-09-20 船长实测报障：「退出战斗的按钮有 2 个」。
   */
  showMinimizeButton?: boolean
  /** 顶栏左侧额外内容（可选；插在标题之前） */
  headLeft?: ReactNode
  /** 顶栏右侧额外内容（可选；插在最小化按钮之前） */
  headRight?: ReactNode
  /** 窗口主体。默认按"内容超长则纵向滚动"处理（见 styles.css） */
  children: ReactNode
}

/**
 * 窗口壳（纯展示件：不持有状态、不判断该不该开——那些是消费方的事；
 * 只自己持一个"等比缩放系数"，那是它自己的排版问题）。
 */
export function WinBox({
  variant,
  title,
  open,
  onMinimize,
  minimizeText,
  minimizeTitle,
  showMinimizeButton = true,
  headLeft,
  headRight,
  children,
}: WinBoxProps): ReactNode {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  /**
   * **等比缩放系数**（见文件头"装不下就整块等比缩放"）。
   *
   * - 量的是**可用区**（窗口层，`inset: 0` 吃主内容区）与**窗口的布局尺寸**；
   *   `offsetWidth/Height` **不受 transform 影响** ⇒ 缩放不会反过来改变量到的尺寸，没有自激循环。
   * - 用 `calc` 在 CSS 里算长度相除（`100cqw / 862px`）浏览器支持面不稳，故走 JS + `ResizeObserver`：
   *   视口/左导航/日志栏任何一个变化都会触发重算。
   * - `useLayoutEffect`：首帧**上屏前**就算好，避免"先按设计尺寸溢出一帧、再缩回去"的闪动。
   * - 只缩不放：`min(1, …)` —— 设计尺寸就是目标尺寸，宽屏上与原样逐像素一致。
   */
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer || !open) return
    const fit = (): void => {
      const cs = getComputedStyle(layer)
      const aw = layer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const ah = layer.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      const box = layer.firstElementChild as HTMLElement | null
      if (!box || aw <= 0 || ah <= 0) return
      const w = box.offsetWidth
      const h = box.offsetHeight
      if (w <= 0 || h <= 0) return
      const next = Math.min(1, aw / w, ah / h)
      setScale((prev) => (Math.abs(prev - next) < 0.002 ? prev : next))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(layer)
    return () => ro.disconnect()
  }, [open])

  // 最小化 = 本壳完全消失；还原入口在左侧舰船小窗（船长 2026-09-21 令：两处合并）
  if (!open) return null
  return (
    <div className="app-winbox-layer" ref={layerRef}>
      <div className={variant} role="dialog" aria-label={title} style={{ '--win-scale': scale } as CSSProperties}>
        <div className="app-winbox-head">
          {headLeft}
          <span className="app-winbox-title">{title}</span>
          <span className="app-winbox-spacer" />
          {headRight}
          {showMinimizeButton ? (
            <button className="app-btn is-small" onClick={onMinimize} title={minimizeTitle}>
              {minimizeText}
            </button>
          ) : null}
        </div>
        <div className="app-winbox-body">{children}</div>
      </div>
    </div>
  )
}
