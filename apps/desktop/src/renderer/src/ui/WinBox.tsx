/**
 * **游戏内窗口壳（2026-09-20 船长令：战斗窗口改非全屏 · 新活动窗口照它做）**。
 *
 * 一处实现、两处消费：`panels/BattleScreen.tsx`（观战窗口）与 `ui/ActivityScreen.tsx`（主控活动窗口）。
 * 抽出来的理由就是船长那句「照它做」——窗口外观、最小化、浮动还原标必须**同源**，否则两处各写一份必然走形。
 *
 * 形态（2026-09-20 定）：
 * - **居中窗口**（复用 `.app-modal` 族的外观语汇：同款描边/圆角/阴影/深蓝渐变），**不再是全屏覆盖层**；
 *   尺寸 `min(1180px, 100% − 32px)` × `min(760px, 100% − 32px)`（见 styles.css `.app-winbox`）；
 * - **遮罩不吃游戏可见性**：`.app-winbox-layer` 只挡交互、只铺一层很淡的暗色 ⇒ 关掉窗口前也能看见游戏在跑；
 * - **最小化**：`open=false` 时本组件**只渲染右下角浮动还原标**（`.app-float-chip`，与既有
 *   `.app-battle-float` 同款脉冲样式）——判定与"何时自动弹出"留在消费方（App.tsx），本壳不做业务判断。
 *
 * z 序：窗口 110 —— 低于详情窗（`.app-modal-mask` 120 / `.app-detail-mask` 140）与悬浮说明（1000），
 * 高于浮动还原标（90）与公告（88）⇒ 详情窗能盖住本窗，本窗能盖住页面。
 *
 * 谁该用它：**"看一个持续过程"的全屏型界面**（战斗、主控活动）。一次性确认框继续用 `.app-modal` 原族，不要套本壳。
 */
import type { ReactNode } from 'react'

export interface WinBoxProps {
  /** 根类名后缀（BEM 修饰），如 `app-winbox is-battle` / `app-winbox is-activity` */
  variant: string
  /** 顶栏标题（已译文案） */
  title: string
  /** 窗口是否展开；`false` ⇒ 只渲染浮动还原标 */
  open: boolean
  /** 最小化（关掉窗口，过程继续在后台跑） */
  onMinimize: () => void
  /** 顶栏最小化按钮的文字（已译文案），如「← 退出战场」「← 最小化」 */
  minimizeText: string
  /** 浮动还原标上的文字（已译文案），如「⚔ 战斗中」「⛏ 采掘中」 */
  chipText: string
  /** 浮动还原标 `title`（已译文案），说明点它会怎样 */
  chipTitle: string
  /** 还原回调（点浮动标） */
  onRestore: () => void
  /** 顶栏左侧额外内容（可选；插在标题之前） */
  headLeft?: ReactNode
  /** 顶栏右侧额外内容（可选；插在最小化按钮之前） */
  headRight?: ReactNode
  /** 窗口主体。默认按"内容超长则纵向滚动"处理（见 styles.css） */
  children: ReactNode
}

/**
 * 窗口壳（纯展示件：不持有状态、不判断该不该开——那些是消费方的事）。
 */
export function WinBox({
  variant,
  title,
  open,
  onMinimize,
  minimizeText,
  chipText,
  chipTitle,
  onRestore,
  headLeft,
  headRight,
  children,
}: WinBoxProps): ReactNode {
  if (!open) {
    return (
      <button className="app-float-chip" onClick={onRestore} title={chipTitle}>
        {chipText}
      </button>
    )
  }
  return (
    <div className="app-winbox-layer">
      <div className={variant} role="dialog" aria-label={title}>
        <div className="app-winbox-head">
          {headLeft}
          <span className="app-winbox-title">{title}</span>
          <span className="app-winbox-spacer" />
          {headRight}
          <button className="app-btn is-small" onClick={onMinimize} title={chipTitle}>
            {minimizeText}
          </button>
        </div>
        <div className="app-winbox-body">{children}</div>
      </div>
    </div>
  )
}
