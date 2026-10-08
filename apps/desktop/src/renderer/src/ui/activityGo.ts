/**
 * **活动栏行「点击去哪」的跳转单点**（2026-09-27 建 · 三号 verify · 修船长报障）
 *
 * 报障（船长 2026-09-27 原话）：「**送快递时，点击活动栏玩家的活动，跳转到空页面**」。
 * 真因：两套活动栏原先**各写了一份** `goFor()`，其中快递那档返回 `{ page: 'map', mapTab: 'task' }`——
 * 而**「任务中心」2026-09-14 已从星图页搬成左侧导航的独立一级页**（见 `pages/MapPage.tsx` 的 `MAP_TABS`
 * 注释：「任务中心 2026-09-14 已搬成左侧导航的独立一级页 ⇒ 本页不再有该选项卡」）⇒
 * `setMapTab('task')` 之后星图页六个页签的 `mapTab === 'x'` 条件渲染**全落空 = 空白页**。
 *
 * 收口口径（与 `arch:guard` 的"单点"纪律一致）：
 *   ① 跳转表**只此一份**（两套外壳共用）——原来是两份重复实现，改一处必漏一处；
 *   ② `mapTab` 的类型收紧为 `MapTab` ⇒ 以后再写不存在的页签**typecheck 直接红**（本次就是把 `'task'`
 *      这个早已删除的页签写进了 `string` 里才漏过去的）；
 *   ③ 顺带把"跳过去之后显示什么名字"（`labelId`）也放进本表 —— 原来由调用点**按 mapTab 反推**，
 *      于是同一个已删除的 `'task'` 又被嗅探一次（两处各一份）。
 */
import type { MapTab } from '../pages/MapPage'

export interface ActivityGoTarget {
  /** 目标页（一级页键，与 `App.tsx` 的 `PageKey` 同名；本文件不 import App 以免成环） */
  page: string
  /** 星图页签（**类型即白名单**：只许 `MAP_TABS` 里真实存在的键） */
  mapTab?: MapTab
  /** 任务中心内层页签（`focusTaskTab` 用；值域见 `panels/Expedition.tsx` 的 `TASK_TABS`） */
  taskTab?: string
  /** 跳转提示文案里的目的地名（`ui.ActivityBar.052` 的 `goText`） */
  labelId: string
}

/**
 * 活动类型 → 跳转目标。映射关系（原注释保留）：
 * 采矿→星图·矿带开采／扫描·打捞·远征·返航·建站交付·待命→星图·远征／**快递→任务中心·快递任务**／
 * 长途运输→星图·长途运输／重复清剿→星图·常驻悬赏／虫洞探索→星图·星图（虫洞入口行在那一页的行动区）／
 * 制造·精炼→工业／训练→技能页。
 */
export function goFor(kind: string): ActivityGoTarget {
  switch (kind) {
    case 'mining':
      return { page: 'map', mapTab: 'mine', labelId: 'ui.MapPage.003' }
    case 'scan':
    case 'salvage':
    case 'expedition':
    case 'return':
    case 'transit':
    case 'standby':
    case 'wormhole':
      return { page: 'map', mapTab: 'star', labelId: 'ui.MapPage.002' }
    /** **快递任务**：落「任务中心」一级页并选中「快递任务」内层页签（2026-09-27 修：原先跳已删除的星图页签 ⇒ 空白页） */
    case 'courier':
      return { page: 'task', taskTab: 'courier', labelId: 'ui.App.008' }
    case 'hauling':
      return { page: 'map', mapTab: 'haul', labelId: 'ui.MapPage.006' }
    case 'loop':
      return { page: 'map', mapTab: 'bounty', labelId: 'ui.ActivityBar.016' }
    case 'invasion-loop':
      return { page: 'map', mapTab: 'star', labelId: 'ui.MapPage.002' }
    case 'manufacture':
    case 'refine':
    /** 实验室产线（2026-10-01 接入）：与精炼炉/制造线同落「工业」页（实验室是它的一个页签） */
    case 'lab':
      return { page: 'industry', labelId: 'ui.App.006' }
    case 'train':
      return { page: 'skills', labelId: 'ui.App.007' }
    default:
      return { page: 'map', mapTab: 'star', labelId: 'ui.MapPage.002' }
  }
}
