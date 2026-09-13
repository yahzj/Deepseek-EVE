/**
 * 修理组件的共用口径（**2026-09-13 船长两条指令**：「将修理组件的回血效果，同步到和使用船体维修装置时一致」
 * ＋「船体维修装置修改为也吃舰体快修学」）。
 *
 * **两条用件路径共用同一处技能系数**：
 *   ① 直接使用修理组件（手动按钮 / 遇袭自动修 / 重复清剿自动修）—— `shipyard.kitHealFor`
 *   ② 船体维修装置战斗中每跳 —— `combat.preloadRepairFor` 在**开战预载**时按开战那一刻的技能折算每跳值
 *      （与"装配快照 + 组件预载"同一份快照语义；无消耗自愈件 `repairFree` 不吃本技能，它不消耗组件）。
 *
 * 为什么单独成一个模块：`shipyard` 与 `combat` 本就互相引用（`shipyard → combat` 取 `createPlayerSpec`），
 * 系数放这里避免新增循环依赖；**技能 id 与每级加成的数值仍在 `balance.repair`**（唯一调参处）。
 */
import type { GameState } from './state'
import type { SimContext } from './types'

/** 修理组件恢复量系数：1 + Σ(该技能每级加成 × 等级)（各技能等级封顶 5）
 *  —— 2026-09-13 船长：**舰体快修学 + 维修工程学同效果、按级线性相加**（两条都满级 = +50%） */
export function quickRepairFactor(state: GameState, ctx: SimContext): number {
  let sum = 0
  for (const s of ctx.balance.repair.quickRepairSkills) {
    sum += s.perLevel * Math.min(5, state.skills.trained[s.id] ?? 0)
  }
  return 1 + sum
}
