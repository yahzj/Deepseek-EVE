/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, type AiAssignment, addLog } from '../state'
import type { SimContext } from '../types'
import { type SettleStats, addAiSalvageDone } from '../settleStats'
import { aiEfficiency } from './cores'
import { shipDisplayName } from '../instances'
import { gainAiCore, aiCoreName } from '../aiCores'
import { shortestTravelMinutes, HOME_GALAXY_ID } from '../expedition'
import { travelLegMs } from '../travel'
import { scaledReturnMs } from '../trips'
import { markExplored } from '../explore'
import { salvagerCyclesOf, pullOneWreck, wreckUnitsOf, legMsFor } from '../salvaging'
import { freeCargoM3Of } from '../inventory'
import { bumpFirst } from '../firstTasks'
import { beginJumpFuelLeg } from '../jumpFuel'

export type AiSalvageTaskState = Extract<GameState['aiAssignments'][string]['task'], { kind: 'salvage' }>

/** AI 打捞任务推进（自动循环，2026-09-09 船长定：与 AI 采矿同构——出航 → 打捞 → 满仓返航 →
 * 到港卸货 → 同星系自动再出航，直到取消；行程/周期按核心效率拉长，满仓返港后不结束） */
export function advanceAiSalvage(
  state: GameState,
  shipId: string,
  assignment: AiAssignment,
  deltaMs: number,
  ctx: SimContext,
  stats?: SettleStats,
): void {
  const task = assignment.task as AiSalvageTaskState
  const eff = aiEfficiency(state, ctx, assignment.coreType)
  const shipName = shipDisplayName(state, ctx, shipId)
  const abort = (why: string): void => {
    delete state.aiAssignments[shipId]
    gainAiCore(state, assignment.coreType)
    addLog(state, 'warn', `[AI·${shipName}] ${why}（${aiCoreName(assignment.coreType)} 已归还）。`, 'core.ai.023', {
      p1: shipName,
      p2: why,
      p3: aiCoreName(assignment.coreType),
    })
  }
  const legBaseOf = (): number => {
    if (state.debugQuick) return 1000
    const mins = shortestTravelMinutes(ctx, HOME_GALAXY_ID, task.galaxyId)
    const travel = Number.isFinite(mins) ? mins : 0
    return Math.max(1, ctx.balance.mining.localLegMs + travelLegMs(state, ctx, travel, shipId))
  }
  let remaining = deltaMs
  let guard = 0
  while (remaining > 0) {
    if (++guard > 100_000) break
    // ── 出航 / 返航（效率只拉长出航腿；返航腿与主控同口径——2026-09-08 卷B2⑥ 船长定稿：
    //    满仓基准先按货仓占比缩放，不再 ÷核心效率） ──
    if (task.phase === 'outbound' || task.phase === 'returning') {
      const legBase =
        task.phase === 'outbound'
          ? Math.round(legBaseOf() / 2)
          : scaledReturnMs(legBaseOf(), state, ctx, shipId, task.fuelMul)
      const legReal = task.phase === 'outbound' ? Math.max(1, Math.round(legBase / eff)) : Math.max(1, Math.round(legBase))
      const need = legReal - task.phaseAccMs
      if (remaining < need) {
        task.phaseAccMs += remaining
        remaining = 0
        break
      }
      remaining -= need
      task.phaseAccMs = 0
      if (task.phase === 'returning') {
        // 到港：整仓卸入物品仓库 → 自动循环（同星系再出航）；取消任务才归还核心
        const cargo = state.fleet[shipId]?.cargo
        let moved = 0
        if (cargo) {
          for (const [itemId, units] of Object.entries(cargo)) {
            if (units > 0) {
              state.warehouse.items[itemId] = (state.warehouse.items[itemId] ?? 0) + units
              moved += units
            }
          }
          for (const itemId of Object.keys(cargo)) delete cargo[itemId]
        }
        const galaxyName = ctx.galaxies.get(task.galaxyId)?.name ?? task.galaxyId
        addLog(
          state,
          'trade',
          `[AI·${shipName}] 打捞自动返港：${galaxyName} 残骸已卸入物品仓库（本趟约 ${Math.round(task.tripM3 * 100) / 100} m³ 当量）。自动循环：继续出航打捞（取消任务即归还${aiCoreName(assignment.coreType)}）。`,
          'core.ai.024',
          {
            p1: shipName,
            p2: galaxyName,
            p3: Math.round(task.tripM3 * 100) / 100,
            p4: aiCoreName(assignment.coreType),
          },
        )
        if (stats) addAiSalvageDone(stats, assignment.coreType) // 2026-09-08：离线结算按次统计（残骸卖出/拆解变现不计入粗估）
        task.phase = 'outbound'
        task.phaseAccMs = 0
        task.tripM3 = 0
        task.deviceAccMs = {}
        continue
      }
      // 抵达目标星系
      markExplored(state, task.galaxyId)
      task.phase = 'salvaging'
      task.cycleAccMs = 0
      continue
    }
    // ── 打捞：逐台打捞器按各自真实周期结算（周期 = 基础周期 ÷ 效率） ──
    const rawCycles = salvagerCyclesOf(state, ctx, shipId)
    if (rawCycles.length === 0) {
      abort('打捞器记录缺失，打捞任务终止')
      return
    }
    const reals = rawCycles.map((c) => Math.max(1, Math.ceil(c / eff)))
    const stepMs = Math.min(...reals)
    if (task.cycleAccMs < stepMs) {
      const need = stepMs - task.cycleAccMs
      const take = Math.min(remaining, need)
      task.cycleAccMs += take
      remaining -= take
      if (task.cycleAccMs < stepMs) break
    }
    task.cycleAccMs = 0
    for (const real of reals) {
      const key = String(real)
      task.deviceAccMs[key] = (task.deviceAccMs[key] ?? 0) + stepMs
      while ((task.deviceAccMs[key] ?? 0) >= real) {
        task.deviceAccMs[key] = (task.deviceAccMs[key] ?? 0) - real
        const freeM3 = freeCargoM3Of(state, ctx, shipId)
        const pulled = pullOneWreck(state, ctx, task.galaxyId, real, freeM3)
        if (!pulled) {
          abort('该星系敌群记录缺失，打捞任务终止')
          return
        }
        /**
         * **AI 副船的打捞计入终身计数**（船长 2026-09-20：「成就系统和重要任务的累计，
         * 也计入AI副船的产量」）。
         *
         * 与主控**同口径同位置**：主控那侧写在 `pullOneWreck` 成功之后（`salvaging.ts`），
         * 这里也放在"确实捞上来一批"之后 ⇒ **成功才算一次**，下面的"货仓装不下"是
         * 捞上来了但没装下，也照记（与主控的口径一致：捞取动作发生了）。
         */
        bumpFirst(state, 'salvageRuns')
        if (pulled.volumeM3 <= 0) continue
        if (wreckUnitsOf(pulled.volumeM3) > freeM3) {
          task.phase = 'returning'
          task.phaseAccMs = 0
          /** 副船去程独立推进；扣料只取本船实际返航单程，与推进及读数同源。 */
          if (task.kind === 'salvage') {
            const baseAi = scaledReturnMs(
              legMsFor(state, ctx, task.galaxyId, shipId),
              state,
              ctx,
              shipId,
            )
            task.fuelMul = beginJumpFuelLeg(state, 'ai', baseAi)
          }
          addLog(
            state,
            'fleet',
            `[AI·${shipName}] 货仓装不下下一轮打捞（余 ${Math.round(freeM3)} m³ ／ 每轮 ${Math.round(pulled.volumeM3)} m³）：自动返航卸货（本趟约 ${Math.round(task.tripM3 * 100) / 100} m³ 当量）。`,
            'core.ai.025',
            {
              p1: shipName,
              p2: Math.round(freeM3),
              p3: Math.round(pulled.volumeM3),
              p4: Math.round(task.tripM3 * 100) / 100,
            },
          )
          break
        }
        const cargo = state.fleet[shipId]!.cargo
        /**
         * **入舱件数走单点 `wreckUnitsOf`**（**2026-10-02 船长令「按你推荐」**）：与主控作业同一把尺
         * —— 计数 = 体积（m³）、不足 1 m³ 的那一轮至少 1 件。改前这里**直接累加小数**
         * （`cargo[id] += 0.51`）⇒ AI 打捞的货舱里会攒出"0.51 件残骸"这种读数，且不足 1 件时
         * 玩家在货舱里也看不见东西。
         */
        cargo[pulled.itemId] = (cargo[pulled.itemId] ?? 0) + wreckUnitsOf(pulled.volumeM3)
        task.tripM3 += pulled.volumeM3
      }
      if (task.phase === 'returning') break
    }
  }
}
