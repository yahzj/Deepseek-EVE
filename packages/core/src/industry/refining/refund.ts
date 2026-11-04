import type { GameState, RefineRunState } from '../../state'
import { addWare } from '../../inventory'

/**
 * 玩家指令：停指定的某一台炉（v20 按台号 id 定位，同资源多台互不影响）。
 * 已完成批已出货；v20 原料不锁定故无退料；AI 核心驱动时核心自动归还。
 */
/**
 * 归还本炉**私有料账**（2026-09-11 船长定「甲：起炉即预占」）：稀有残骸起炉时从公共库存扣出的
 * 那 1 件（30 m³），停炉时未用完的部分退回**物品仓库**（与修理组件退还同哲学，不往随时会离港的货仓塞）。
 * 无私有账（普通残骸/精炼炉）= 空操作。返回实际退回量（日志/测试用）。
 */
export function refundClaimedUnits(state: GameState, r: RefineRunState): number {
  // 2026-09-11（船长：「按照每次少 30 立方，自动烧」）：私有料账退回仓库即可。
  // `state.rareOpenedUnits` 是**单调累计**（已结算过箱的料量），这里**不回收**——开过的料永远不再产箱，
  // 否则"开箱 → 停炉 → 再起炉"就能把同一批料反复开箱。
  const left = Math.max(0, r.claimedUnits ?? 0)
  if (left <= 0 || !r.itemId) {
    r.claimedUnits = 0
    return 0
  }
  addWare(state, r.itemId, left)
  r.claimedUnits = 0
  return left
}
