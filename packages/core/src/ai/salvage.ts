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
        if (stats) addAiSalvageDone(stats, assignment.coreType)
        task.phase = 'outbound'
        task.phaseAccMs = 0
        task.tripM3 = 0
        task.deviceAccMs = {}
        continue
      }
      markExplored(state, task.galaxyId)
      task.phase = 'salvaging'
      task.cycleAccMs = 0
      continue
    }
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
        bumpFirst(state, 'salvageRuns')
        if (pulled.volumeM3 <= 0) continue
        if (wreckUnitsOf(pulled.volumeM3) > freeM3) {
          task.phase = 'returning'
          task.phaseAccMs = 0
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
        cargo[pulled.itemId] = (cargo[pulled.itemId] ?? 0) + wreckUnitsOf(pulled.volumeM3)
        task.tripM3 += pulled.volumeM3
      }
      if (task.phase === 'returning') break
    }
  }
}
