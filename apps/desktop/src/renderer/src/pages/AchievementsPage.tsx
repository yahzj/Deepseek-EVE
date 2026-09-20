/**
 * **成就**（一级页 · 船长 2026-09-20：「一级页，但是内部再加一个二级子窗口容器」）。
 *
 * 结构照抄任务中心（`pages/TaskCenterPage.tsx`）：
 * - `page-stack page-fill` ⇒ 本页高度恒等于主窗口内容区，**页面本体不滚**（一级页不滚红线）；
 * - 页内是 `Achievements` 面板（`Panel className="is-fill"` ＋ `.app-win-body`）⇒
 *   **固定头 ＋ 内容内滚**，滚动只发生在那个"二级子窗口容器"里。
 */
import type { GameEngine } from '../game/engine'
import { Achievements } from '../panels/Achievements'

export function AchievementsPage({ engine }: { engine: GameEngine }) {
  return (
    <div className="page-stack page-fill">
      <Achievements engine={engine} />
    </div>
  )
}
