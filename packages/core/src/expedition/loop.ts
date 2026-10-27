/** 战斗域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { autoLoopReopenBlockReason, autoLoopWaitLabel, stopAutoLoopReason } from './loopState'
import { actionBlockReason } from '../explore'
import { bountyCooldownRemainingMs } from './cooldown'
import { cargoUnitM3, freeCargoM3 } from '../inventory'
import { repairWithKits } from '../shipyard'
import { weekendZoneLiveAt } from '../weekendBounty'
import { weekendClockOf } from '../weekendEvent'
import { withBattleRangeCheck } from '../battleRangeMemory'
import { startExpedition } from './launch'

/** 重复清剿开关（落档：重启后自动恢复）；null = 关闭。⚠ **关闭一律放行**；开启过 `autoLoopReopenBlockReason` */
export function setAutoLoopBounty(state: GameState, ctx: SimContext, anomalyId: string | null): CommandResult {
  if (anomalyId !== null) {
    const block = autoLoopReopenBlockReason(state)
    if (block !== null) return { ok: false, error: block.error, errorId: block.errorId, errorParams: block.errorParams }
  }
  state.autoLoopAnomalyId = anomalyId
  if (anomalyId === null) {
    state.autoLoopDroneFloor = null
    addLog(state, 'combat', '重复清剿已停止。', 'core.state.008')
  } else {
    state.autoLoopDroneFloor = null // 重新开环 ⇒ 清掉上一轮的机群前置记账
    const def = ctx.anomalies.get(anomalyId)
    const name = def?.name ?? anomalyId
    addLog(
      state,
      'combat',
      `重复清剿已开启：「${name}」完成后冷却结束会自动再次出发（货仓/耐久不满足时自动暂停）。`,
      'core.expedition.031',
      { p1: name },
    )
  }
  return { ok: true }
}

/**
 * 重复清剿推进（在线心跳调用；落档开关在重开档后从可出发条件自动恢复）：
 * 忙（远征/采矿/星图扫描/打捞/航行）或冷却中 → 等待；条件不满足 → 停环并记原因。
 * 返回 null = 继续等待/已再出发；否则 = 停止原因。
 */
export function advanceAutoLoopBounty(state: GameState, ctx: SimContext): string | null {
  const id = state.autoLoopAnomalyId
  if (id === null) return null
  // 别的作业在跑：等（**判据单点 = `autoLoopWaitLabel`**，与活动栏那行同源）
  if (autoLoopWaitLabel(state) !== null) return null
  const anomaly = ctx.anomalies.get(id)
  if (!anomaly) {
    stopAutoLoopReason(state, '目标已不存在。')
    return '目标已不存在'
  }
  const block = actionBlockReason(state, anomaly.galaxyId)
  if (block) {
    stopAutoLoopReason(state, block)
    return block
  }
  if (bountyCooldownRemainingMs(state, id) > 0) return null // 冷却中：等
  const fleetShip = state.fleet[state.shipId]
  if (!fleetShip) {
    stopAutoLoopReason(state, '舰队里找不到当前舰船。')
    return '舰队里找不到当前舰船'
  }
  // 装甲/结构 + 货仓两道门槛（**与入侵「重复出击」共用同一份**，见 `autoLoopPreflight`）
  const lootM3 = anomaly.loot.reduce((sum, row) => {
    const def = ctx.items.get(row.itemId)
    return sum + row.units * (def ? cargoUnitM3(state, def) : 0)
  }, 0)
  // 出发（内部含声望/冷却/探索/位置全部校验）
  const r = startLoopBattle(state, id, ctx, lootM3)
  if (r.loopBlock) {
    stopAutoLoopReason(state, r.loopBlock.notice)
    return r.loopBlock.reason
  }
  if (!r.ok) {
    if (r.rangeConfirmation) return null
    stopAutoLoopReason(state, r.error ?? '无法再出发。')
    return r.error ?? '无法再出发'
  }
  return null
}

/**
 * **循环出发前的两道硬门槛**（装甲/结构 ＋ 货仓）——常驻悬赏的「重复清剿」与入侵的「重复出击」**共用这一份**。
 * 返回 `null` = 通过；否则 **`notice`**（长文案，写日志与在线提示）＋ **`reason`**（短理由，作为函数返回值）。
 * ⚠ 两个字段**都要保留原契约别合并**：既有用例与活动栏都按"返回值 = 短理由"断言
 * （第一版合并成一条 ⇒ `expedition.test.ts` / `t8.test.ts` 三处当场转红）。
 *
 * 口径来源（勿改）：
 * - 耐久（2026-09-08 船长定：装甲或结构 <50% 即自动修补到 60%，为战斗内"结构损失过半自动撤退"留缓冲；
 *   **2026-09-16 船长改判**：改成需要玩家**携带船体维修装置**，消耗的组件类型跟着装置走）；
 * - 货仓（B 甲：无远程入库，回港卸货是玩家的决定；体积按压缩技术折算）。
 */
export function autoLoopPreflight(
  state: GameState,
  ctx: SimContext,
  cardName: string,
  lootM3: number,
): { notice: string; reason: string; noticeId?: string; noticeParams?: Record<string, string | number> } | null {
  const fleetShip = state.fleet[state.shipId]
  if (!fleetShip) return { notice: '舰队里找不到当前舰船。', reason: '舰队里找不到当前舰船', noticeId: 'core.shipyard.007' }
  if ((fleetShip.armorPct ?? 1) < 0.5 || fleetShip.durability < 0.5) {
    const rep = repairWithKits(state, ctx, 0.6)
    const fs = state.fleet[state.shipId]
    if (!fs || (fs.armorPct ?? 1) < 0.5 || fs.durability < 0.5) {
      if (!rep.hasDevice) {
        return {
          notice:
            '装甲或结构低于 50%：自动修补需要该船装着船体维修装置（中槽）——装上装置并带够对应组件，或先到空间站付费维修。',
          reason: '耐久不足（装甲或结构低于 50%）且未装船体维修装置',
          noticeId: 'core.invasionLoop.009',
        }
      }
      return {
        notice: '装甲或结构低于 50% 且货仓修理组件不足——请先到空间站付费维修（或补充修理组件）再开启。',
        reason: '耐久不足（装甲或结构低于 50%）且修理组件耗尽',
        noticeId: 'core.invasionLoop.010',
      }
    }
  }
  if (freeCargoM3(state, ctx) < lootM3) {
    return {
      notice: `货仓剩余空间不足以装载「${cardName}」的缴获——舰船已在母港，请卸货后重新开启讨伐。`,
      reason: '货仓空间不足',
      noticeId: 'core.invasionLoop.011', noticeParams: { p1: cardName },
    }
  }
  return null
}

/** 自动修补与开战同一事务，射程待确认时不提前消耗修理组件。 */
export interface LoopBattleResult extends CommandResult { loopBlock?: NonNullable<ReturnType<typeof autoLoopPreflight>> }

export function startLoopBattle(state: GameState, cardId: string, ctx: SimContext, lootM3?: number,
  options?: { foeGalaxyId?: string; rewardIskOverride?: number }): LoopBattleResult {
  const invasionSeq = options?.foeGalaxyId && weekendZoneLiveAt(state, options.foeGalaxyId, weekendClockOf(state)) ? state.weekendEvent?.seq : undefined
  return withBattleRangeCheck(state, { kind: 'expedition', cardId, autoRepair: true, options, invasionSeq }, staged => {
    const card = ctx.anomalies.get(cardId)
    if (!card) return { ok: false }
    const volume = lootM3 ?? card.loot.reduce((sum, row) => sum + row.units * (ctx.items.get(row.itemId) ? cargoUnitM3(staged, ctx.items.get(row.itemId)!) : 0), 0)
    const pre = autoLoopPreflight(staged, ctx, card.name, volume)
    if (pre) return { ok: false, loopBlock: pre }
    return startExpedition(staged, cardId, ctx, options)
  })
}
