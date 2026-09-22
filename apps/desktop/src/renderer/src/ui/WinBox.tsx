/**
 * **游戏内窗口壳（2026-09-20 船长令：战斗窗口改非全屏 · 新活动窗口照它做）**。
 *
 * 一处实现、两处消费：`panels/BattleScreen.tsx`（观战窗口）与 `ui/ActivityScreen.tsx`（主控活动窗口）。
 * 抽出来的理由就是船长那句「照它做」——窗口外观、最小化、还原入口必须**同源**，否则两处各写一份必然走形。
 *
 * 形态（**2026-09-21 船长令改定为「嵌入」**）：
 * - 船长原话：「我的意思是取消悬浮，直接嵌入主窗口，玩家如果点击最小化或者切换导航栏之类的时候就隐藏并最小化。」
 *   ⇒ 本壳**不再有浮层**（原先的 `.app-winbox-layer` 整块删除）：它就是**主内容区里的一个块**，
 *   由 `App.tsx` 挂在 `.app-page-main` 里、**顶掉那一页**（页面上屏时是本块，页面整块 `display:none`
 *   但**保持挂载** ⇒ 页里的检索词/滚动位置/弹层状态都不丢）。
 * - 因此不再需要遮罩、点击穿透、也不再有"覆盖范围"问题：它不叠在任何东西上面。
 *   **最小化 / 切导航 / 打开弹层 / 活动结束**都会把它收起（触发点都在 `App.tsx`），
 *   收起后入口 = 左侧舰船小窗上那枚「⤢」角标（见 `ui/ShipStatusWin.tsx`）。
 * - `open=false` 时本壳返回 `null`（不上屏），但**组件本身可能仍挂载**（战斗屏要留在场上跑完慢镜与战报，
 *   见 `App.tsx` 那段"什么时候挂载、什么时候上屏"的注释）⇒ 别把"挂载"与"上屏"当成一回事。
 *
 * z 序：窗口 110 已无意义（不再有浮层）；详情窗（120/140）与悬浮说明（1000）仍在本块之上。
 *
 * 谁该用它：**"看一个持续过程"的界面**（战斗、主控活动）。一次性确认框继续用 `.app-modal` 原族，不要套本壳。
 */
import type { ReactNode } from 'react'

export interface WinBoxProps {
  /** 根类名后缀（BEM 修饰），如 `app-winbox is-battle` / `app-winbox is-activity` */
  variant: string
  /** 顶栏标题（已译文案） */
  title: string
  /** 是否上屏；`false` ⇒ 本壳不渲染任何东西（还原入口在左侧舰船小窗） */
  open: boolean
  /** 最小化（收起窗口，过程继续在后台跑） */
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
 * 窗口壳（纯展示件：不持有状态、不判断该不该开——那些是消费方的事）。
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
  // 最小化 = 本块不上屏（页面回来）；还原入口在左侧舰船小窗（船长 2026-09-21 令：两处合并）
  if (!open) return null
  return (
    <div className={variant} role="region" aria-label={title}>
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
  )
}
