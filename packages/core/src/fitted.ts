/**
 * **已装模块的"读出"两件套**（**2026-10-02 破环搬家**：原住 `equipment.ts`）。
 *
 * 为什么拆出来：`inventory.ts`（货仓容量）要读"货舱槽装了哪几件"，而 `equipment.ts` 又要 import
 * `inventory` 的仓库操作 ⇒ `inventory ↔ equipment` 互相依赖。这两个函数只依赖 `labels` 的
 * `allFittedIds` 与类型表 ⇒ 拆到本件后，inventory / equipment / combat / plugs / salvaging 等
 * 都从这里读，环断（行为逐字不变）。`equipment.ts` 原样再导出，既有 `from './equipment'` 引用不动。
 */
import { allFittedIds } from './labels'
import type { FittedModules, ModuleDef, ModuleSlot, SimContext } from './types'
import type { GameState } from './state'
import { fleetDefOf } from './instances'
import { moduleAllowedOnShip } from './shipFitting'

/** 全位已装模块定义（顺序 = 高→中→低 位序；跳过空位） */
export function allFittedModules(fitted: FittedModules, ctx: SimContext): ModuleDef[] {
  const out: ModuleDef[] = []
  for (const id of allFittedIds(fitted)) {
    const def = ctx.modules.get(id)
    if (def) out.push(def)
  }
  return out
}

/** 某家族（slot 六值）的全部已装件定义（按位序）——复数语义消费者用 */
export function familyModules(state: GameState, ctx: SimContext, shipId: string, family: ModuleSlot): ModuleDef[] {
  const fitted = state.fleet[shipId]?.fitted
  if (!fitted) return []
  const ship = fleetDefOf(state, ctx, shipId)
  return allFittedModules(fitted, ctx).filter((d) => d.slot === family && moduleAllowedOnShip(ship, d))
}
