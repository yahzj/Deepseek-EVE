/**
 * **实验室道具的"使用"动作**（**2026-09-30 船长令**「你先继续制作后续实验室内容」＋「信号发射器和技能加速剂」）。
 *
 * 为什么单开一个模块：这两件的**产物**在实验室（`lab.ts` + `labRecipes.ts`），但**用法**与产线无关
 * ——它们是"从仓库里点一下就用掉"的道具，与精炼/生产链解耦 ⇒ 复用既有 `useOneRepairKit` 的成法：
 * 校验 → 扣 1 枚（货仓优先、再扣物品仓库）→ 落效果 → 返回 `CommandResult`（界面只弹提示）。
 *
 * 本文件目前只有**突触加速剂**（第 3 批）；**信号发射器**（第 2 批）等入侵侧的"主动起事件"入口接好后再补进来，
 * 在那之前它的物品/市场/配方三处都带 `unreleased` ⇒ 玩家看不到也拿不到。
 */
import type { GameState } from './state'
import type { CommandResult } from './engine'
import { countItem, countWare, removeItem, removeWare } from './inventory'
import { addLog } from './state'
import { SYNAPTIC_ACCELERANT_MS, synapticAccelerantActive } from './training'

/** 突触加速剂物品 id（与 `data/items.ts` 的 `CONSUMABLES` 同源） */
export const SYNAPTIC_ACCELERANT_ITEM_ID = 'synaptic-accelerant'

/** 库存里有多少枚（货仓 ＋ 物品仓库；与 `labMaterialAvailable` 同一把尺） */
export function consumableStockOf(state: GameState, itemId: string): number {
  return countItem(state, itemId) + countWare(state, itemId)
}

/** 扣 1 枚（**货仓优先**，与精炼炉/实验室取料口径一致） */
function takeOne(state: GameState, itemId: string): void {
  if (countItem(state, itemId) > 0) {
    removeItem(state, itemId, 1)
    return
  }
  removeWare(state, itemId, 1)
}

/**
 * **使用一枚突触加速剂**：24 小时内训练时长 ×0.5。
 *
 * 校验顺序（与 `useOneRepairKit` 同款：先判"用了有没有意义"，再扣东西）：
 * ① 库存里有 ≥1 枚；② **当前没有生效中的加速剂**（**不可叠用** —— 船长口径「同一时间内只能生效一剂」；
 * 生效期内再点直接拒绝、**不消耗**，避免白扔 2,000 虚空晶）。
 */
export function useSynapticAccelerant(state: GameState): CommandResult {
  if (consumableStockOf(state, SYNAPTIC_ACCELERANT_ITEM_ID) <= 0) {
    return { ok: false, error: '仓库里没有突触加速剂。', errorId: 'core.consumable.001' }
  }
  if (synapticAccelerantActive(state)) {
    return {
      ok: false,
      error: '突触加速剂正在生效中：同一时间内只能生效一剂。',
      errorId: 'core.consumable.002',
      errorParams: { p1: Math.max(0, Math.round(((state.skillBoostUntilMs ?? 0) - state.gameMs) / 60_000)) },
    }
  }
  takeOne(state, SYNAPTIC_ACCELERANT_ITEM_ID)
  state.skillBoostUntilMs = state.gameMs + SYNAPTIC_ACCELERANT_MS
  addLog(
    state,
    'industry',
    `✦ 突触加速剂生效：未来 24 小时内技能训练时长减半（至 ${Math.round(SYNAPTIC_ACCELERANT_MS / 3_600_000)} 小时后失效）。`,
    'core.consumable.003',
    { p1: Math.round(SYNAPTIC_ACCELERANT_MS / 3_600_000) },
  )
  return { ok: true }
}

/** 生效剩余毫秒（界面读数用；0 = 未生效） */
export function synapticAccelerantRemainMs(state: GameState): number {
  return Math.max(0, (state.skillBoostUntilMs ?? 0) - state.gameMs)
}
