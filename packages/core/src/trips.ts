/**
 * 货仓占比返航（2026-09-05 船长拍板：采矿/打捞返航时间与“基础货仓使用比例”相关，
 * 货仓越空返航越快，空仓 ≈ 瞬回；额外货仓(扩展件)不计入容量口径）。
 *
 * 规则：倍率 = 纯占比（货仓已用 m³ ÷ 船体基础容量 cargoM3，钳制 0~1）。
 * 满仓倍率 1（返航时长同现状），空仓趋近 0（保留 ≥1ms 下限）。
 * 适用：采矿作业内返航、打捞作业内返航、换驾驶善后旧船返航（船长拍板范围）；
 * AI 副船采矿/打捞返航同口径（2026-09-06 船长复核⑤：先缩放再按核心效率拉长）。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
import { cargoUsedM3Of, cargoCapacityM3Of } from './inventory'
import { fleetDefOf } from './instances'

/** 货仓占用率（基础容量口径）：已用 m³ ÷ 船体基础 cargoM3；缺定义时回退到总容量兜底 */
export function cargoHoldRatio(state: GameState, ctx: SimContext, shipId: string): number {
  const used = Math.max(0, cargoUsedM3Of(state, ctx, shipId))
  const def = fleetDefOf(state, ctx, shipId)
  const base = def?.cargoM3 && def.cargoM3 > 0 ? def.cargoM3 : cargoCapacityM3Of(state, ctx, shipId)
  if (!base || base <= 0) return 1
  return Math.min(1, Math.max(0, used / base))
}

/** 把“满仓返航时长”按当前货仓占比缩放（纯占比；下限 1ms，避免 0 时长破坏进度条） */
export function scaledReturnMs(fullMs: number, state: GameState, ctx: SimContext, shipId: string): number {
  return Math.max(1, Math.round(fullMs * cargoHoldRatio(state, ctx, shipId)))
}
