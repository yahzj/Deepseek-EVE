/**
 * **任务中心**（一级页 · 2026-09-14 船长：「将任务中心界面移出星图，放入左侧导航栏，通讯的上方」）。
 *
 * 为什么单开一页：原先它是星图页（出港）的一个选项卡（`MapTab = 'task'`），可星图的行动区要
 * 「先选中星系」才渲染，路径绕；船长要的是**从左侧导航直达**。搬家后：
 * - **一级页不滚**（红线）：本页固定一屏高、`page-fill`；滚动只发生在**内层列表**里（`TaskPanel` 自己的容器）；
 * - **内层标签照搬**（重要任务 / 资源任务 / 快递任务 / 赏金任务），跳转定位仍走 `taskFocus`
 *   （通讯的「前往任务中心」与开场信都带内层标签 —— 见 core `CommsJumpPage` 的 `'task'`）。
 */
import type { GameEngine } from '../game/engine'
import type { PageProps } from './common'
import { TaskPanel } from '../panels/Expedition'

/**
 * 任务中心**内层**标签定位（2026-09-11 船长：「步骤 2/7 跳转任务中心时，不会切到指定标签页」）。
 * 内层标签会记住玩家上次的选择，故跳转必须显式带上目标标签；`seq` 变化即应用一次。
 * （本类型原先定义在 `pages/MapPage.tsx`，随任务中心搬家一并迁到这里。）
 */
export interface TaskFocusTarget {
  tab: string
  seq: number
}

export function TaskCenterPage({ engine, onToast, taskFocus = null, onOpenComms, onJump }: PageProps & {
  taskFocus?: TaskFocusTarget | null
  /** 「第一次」卡片上的「看情报」：跳到通讯页并选中那封情报信（App 层的 `commsFocus` 定位） */
  onOpenComms?: (messageId: string) => void
  /** 「第一次」卡片上的跳转按钮：去这件活所在的页面（App 层切页 + 页签，自带解锁闸门）；
   *  技能页另带 `skillGroup`（要练的那门技能所属的大类；2026-09-24 船长令「跳到技能页并自动选中工程」） */
  onJump?: (t: {
    page: string
    mapTab?: string
    shipTab?: string
    industrySec?: 'refine' | 'shelf' | 'craft' | 'shipyard'
    skillGroup?: string
  }) => void
}) {
  return (
    /**
     * **一级页不滚**：`page-stack page-fill` 让本页高度恒等于主窗口内容区；
     * 面板自己带 `is-fill` + `.app-win-body`（固定头 + 内容内滚）⇒ 滚动只发生在任务列表里，
     * 与搬家的原样一致（原先在星图页里也是这一套，页面本身没有新增任何滚动容器）。
     */
    <div className="page-stack page-fill">
      <TaskPanel engine={engine} onToast={onToast} focusTab={taskFocus} onOpenComms={onOpenComms} onJump={onJump} />
    </div>
  )
}
