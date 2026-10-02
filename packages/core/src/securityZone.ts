/**
 * 星系安全分区（2026-10-02 从 `sideTasks.ts` 拆出，破 `hauling → sideTasks` 边）。
 *
 * `hauling` / `consumables` 只借"该星系安全档"这一件，而它又住在 `sideTasks`（支线任务）里，
 * 与消费品的无关依赖 ⇒ 拆到本零依赖模块（只读 `ctx`，不 import 任何业务模块）。
 */
import type { SimContext } from './types'

/** 安全等级分区（沿用全仓口径：sec ≥ 0.5 高安 / 0 < sec < 0.5 中安 / **sec ≤ 0 低安（含 0）**）。
 *  ⚠ 2026-09-12 船长裁定「**0也算低安**」⇒ 边界由 `sec < 0` 移到 `sec ≤ 0`，与伏击掷骰同源
 *  （`balance.encounter.lowSecMax`）。烬火星区与回音荒区（均为 0.0）因此由中安池进低安池。 */
export type SecurityZone = '高安' | '中安' | '低安'

/** 该星系的安全分区（security 缺省按 0.5 视作高安，与残骸基础密度兜底同口径） */
export function securityZoneOf(ctx: SimContext, galaxyId: string): SecurityZone {
  const sec = ctx.galaxies.get(galaxyId)?.security
  const v = typeof sec === 'number' && Number.isFinite(sec) ? sec : 0.5
  if (v >= 0.5) return '高安'
  // 2026-09-12 船长「0也算低安」：中安是**开区间** (0, 0.5)，安全等级 0 归低安
  if (v > 0) return '中安'
  return '低安'
}
