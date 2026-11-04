import '../../styles-unbox-ledger.css'
import { tr } from '../../i18n/locale'

/**
 * **精炼炉一级筛选标签**（2026-09-14 船长：「精炼炉和组装机一样，添加筛选标签」→
 * 位置澄清「**放进精炼炉内，并更新筛选**」）——按**活计大类**分，与页面里原本的三个小标题一一对应：
 * 全部 / 可精炼资源 / 残骸回收 / 货柜拆解（货柜那一档原先是"施工期只在调试模式出现"，船长 2026-09-14
 * 明示「**虫洞已经做完了…允许对玩家开放**」⇒ 四档一律常显）。
 */
export type FurnaceTab = 'all' | 'ore' | 'wreck' | 'box'

export const FURNACE_TABS: Array<{ key: FurnaceTab; label: string }> = [
  { key: 'all', get label() { return tr("ui.IndustryPage.001") } },
  { key: 'ore', get label() { return tr("ui.IndustryPage.002") } },
  { key: 'wreck', get label() { return tr("ui.IndustryPage.003") } },
  { key: 'box', get label() { return tr("ui.IndustryPage.004") } },
]

/** 二级子筛选的候选（键 = 子筛选键，`''` = 全部子类，与组装机同款口径） */
export type SubOpt = { key: string; label: string }

/** 可精炼资源按**资源大类**（只列实际存在的档；`ItemDef.kind` 单点） */
export const ORE_KIND_LABEL: Record<string, string> = {
  get ore() { return tr("ui.IndustryPage.005") },
  get gas() { return tr("ui.IndustryPage.006") },
  get ice() { return tr("ui.IndustryPage.007") },
}
