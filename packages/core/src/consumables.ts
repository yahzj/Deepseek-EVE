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
import type { SimContext } from './types'
import { countItem, countWare, removeItem, removeWare } from './inventory'
import { addLog } from './state'
import { SYNAPTIC_ACCELERANT_MS, synapticAccelerantActive } from './training'
import { weekendRollOccupation } from './weekendEvent'

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

/* ═══════════════════════ 信号发射器（第 2 批） ═══════════════════════ */

/** 信号发射器物品 id */
export const INVASION_BEACON_ITEM_ID = 'invasion-beacon'

/**
 * **可选入侵势力清单**（**船长 2026-09-29 Q2**：「**做个列表之类的，之后有新增入侵就添加选项**」）。
 *
 * ⚠ **这里是唯一登记处**：将来做了第二个入侵族（如 A/C/G），**在表里加一行**，界面与校验自动跟上
 * （界面按这张表渲染列表；`useInvasionBeacon` 用它校验 id）。今天只有 **H 族（墨潮帮）**
 * —— 入侵卡表 `WEEKEND_FOE_CARD_IDS` 目前也只登记了 H 族。
 */
export const INVASION_BEACON_FAMILIES: readonly { readonly id: string; readonly nameId: string }[] = [
  { id: 'H', nameId: 'ui.consumable.002' },
]

/**
 * **使用一枚信号发射器**：主动诱发一次入侵（**船长 2026-09-29 六答**：
 * Q3a「和现有规则一样（**随机星系**入侵）」· Q3b「**只能在没有入侵时候使用**」·
 * Q3c「**消耗一个**，不做限制」· Q3d「能获得虚空晶必然声望达标。**不做限制**」）。
 *
 * 落法 = **复用现有那一抽**：`weekendRollOccupation(state, ctx, seq)` 正是"随机核心星系 ＋ 外围 ＋ 势力"，
 * 抽到后把 `startedAtWallMs` 设为**现在**（而不是本周排期的 T0）⇒ 这一场按既有规则活满 96 小时窗口
 * （`weekendWindowOpen` 按 `startedAtWallMs` 起算，正常排期那条路也会因为"上一场不足一个窗口"而不重复开）。
 *
 * ⚠ **不做的事**（照 Q3b/c/d）：**不判声望、不判窗口、不判周排期**；只在**已有一场未结束的入侵**时拒绝。
 * ⚠ **抽不到目标星系时不扣料**（`weekendRollOccupation` 返回 null ⇒ 直接拒，避免白扔 10,000 虚空晶）。
 */
export function useInvasionBeacon(state: GameState, ctx: SimContext, familyId?: string): CommandResult {
  if (consumableStockOf(state, INVASION_BEACON_ITEM_ID) <= 0) {
    return { ok: false, error: '仓库里没有信号发射器。', errorId: 'core.consumable.004' }
  }
  const ev = state.weekendEvent
  if (ev !== undefined && ev.endedAtWallMs === undefined) {
    return { ok: false, error: '已经有一场入侵在进行中：等它结束再用信号发射器。', errorId: 'core.consumable.005' }
  }
  const family = INVASION_BEACON_FAMILIES.find((f) => f.id === (familyId ?? INVASION_BEACON_FAMILIES[0]!.id))
  if (!family) {
    return {
      ok: false,
      error: `未知的入侵势力：${familyId ?? '(空)'}。`,
      errorId: 'core.consumable.006',
      errorParams: { p1: familyId ?? '(空)' },
    }
  }
  const seq = (ev?.seq ?? 0) + 1
  const rolled = weekendRollOccupation(state, ctx, seq)
  if (!rolled) {
    return { ok: false, error: '当前没有可入侵的目标星系。', errorId: 'core.consumable.007' }
  }
  takeOne(state, INVASION_BEACON_ITEM_ID)
  state.weekendEvent = {
    seq,
    startedAtWallMs: state.wallMs ?? Date.now(),
    ...rolled,
    family: family.id,
    contributed: {},
  }
  const galaxyName = ctx.galaxies.get(rolled.coreId)?.name ?? rolled.coreId
  addLog(
    state,
    'fleet',
    `✦ 信号发射器已启动：入侵舰队正在逼近「${galaxyName}」（第 ${seq} 场）。`,
    'core.consumable.008',
    { p1: galaxyName, p2: seq },
  )
  return { ok: true }
}
