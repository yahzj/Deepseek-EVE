/**
 * **燃料补给读数**（仓库量 / 上限 / 在产速率 / 状态）—— **界面取数的唯一入口**
 * （**2026-09-30 船长令**：「只需要显示上限多少（比如本地存档现在是5,200单位，那就显示5,200/6000单位），
 * 下方实验室按钮边上显示现在燃料大概的生产速度/h」，以及「新功能是否模块化？降低耦合」）。
 *
 * 为什么单开一个模块（而不是把这几行摊在界面里、或塞回 `jumpFuel.ts`）：
 * - 上限/库存的规则在 `jumpFuel.ts`，产线速率在 `lab.ts`；读数**同时**需要两者 ⇒ 这里做**只读合成**，
 *   依赖是单向的（`fuelSupply → lab → jumpFuel`），没有环；
 * - 界面因此**零算法、零自造常量**：原先"一趟长途 = 1,200 单位 × 5 = 6,000"是界面自己编的，
 *   船长判定「估算约能跑多少趟没有实际意义」——本模块就是那句判定的落点（那两处常量已删）。
 *
 * ⚠ 口径（船长 2026-09-30 两连裁定）：
 * - **只算物品仓库**，不算任何舰船库存（读数与上限同一把尺）；
 * - 速率 = **当前在跑的实验线合计**（`'flowing'`）；没开工 = 0（`'idle'`）；放不下下一批 = `'full'`；
 *   实验室未解锁 = `'locked'`（首座空间站建成前）。
 */
import type { GameState } from './state'
import type { LabRecipeDef, SimContext } from './types'
import { JUMP_FUEL_ITEM_ID, jumpFuelCapOf, jumpFuelHeadroomOf, jumpFuelWareOf } from './jumpFuel'
import { labOutputCapped, labOutputPerHourOf, labUnlocked } from './lab'

/** 燃料补给状态（界面按它换措辞；见文件头口径） */
export type JumpFuelFlowStatus = 'locked' | 'full' | 'flowing' | 'idle'

export interface JumpFuelSupply {
  /** 物品仓库里的燃料（单位） */
  ware: number
  /** 上限（已含两条上限技能；基准 6,000） */
  cap: number
  /** 余量（上限 − 仓库量，不小于 0） */
  headroom: number
  /** 当前在跑的实验线合计产出（单位/时；没跑 = 0） */
  perHour: number
  status: JumpFuelFlowStatus
}

/** 产出燃料的那张配方（按**产物物品 id** 认，不在 core 写死配方 id —— 数据表说了算） */
export function jumpFuelRecipeOf(ctx: SimContext): LabRecipeDef | undefined {
  for (const r of ctx.labRecipes.values()) if (r.outputItemId === JUMP_FUEL_ITEM_ID) return r
  return undefined
}

export function jumpFuelSupplyOf(state: GameState, ctx: SimContext): JumpFuelSupply {
  const ware = jumpFuelWareOf(state)
  const cap = jumpFuelCapOf(state)
  const recipe = jumpFuelRecipeOf(ctx)
  const unlocked = labUnlocked(state, ctx)
  const perHour = labOutputPerHourOf(state, ctx, recipe?.id)
  const full = unlocked && recipe !== undefined && labOutputCapped(state, recipe)
  const status: JumpFuelFlowStatus = !unlocked ? 'locked' : full ? 'full' : perHour > 0 ? 'flowing' : 'idle'
  return { ware, cap, headroom: jumpFuelHeadroomOf(state), perHour, status }
}
