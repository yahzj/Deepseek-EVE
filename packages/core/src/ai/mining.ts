import { type GameState, type AiAssignment, addLog } from '../state'
import type { SimContext } from '../types'
import { type SettleStats, addAiMiningTrip, addAiIncome } from '../settleStats'
import { aiEfficiency, aiServicingUpgradeMult } from './cores'
import { shipDisplayName } from '../instances'
import { nearestStationGalaxyId } from '../location'
import { HOME_GALAXY_ID } from '../expedition'
import { oneOutboundLegMs, oneLegMs, getMiningParams, rollBeltOutput, richVeinP } from '../mining'
import { scaledReturnMs } from '../trips'
import { markExplored } from '../explore'
import { gainAiCore, aiCoreName } from '../aiCores'
import { cargoUnitM3, freeCargoM3Of } from '../inventory'
import { beginJumpFuelLeg } from '../jumpFuel'
import { nextRandom } from '../rng'
import { bumpFirst } from '../firstTasks'

export function advanceAiMining(
  state: GameState,
  shipId: string,
  assignment: AiAssignment,
  deltaMs: number,
  ctx: SimContext,
  stats?: SettleStats,
): void {
  const task = assignment.task as AiMiningTaskState
  const eff = aiEfficiency(state, ctx, assignment.coreType)
  const realCycleDiv = eff
  const shipName = shipDisplayName(state, ctx, shipId)

  let remaining = deltaMs
  while (remaining > 0) {
    if (task.phase === 'returning' || task.phase === 'outbound') {
      const beltDef = ctx.belts.get(task.beltId)
      const stGal = beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID
      const legBase =
        task.phase === 'outbound'
          ? oneOutboundLegMs(state, ctx, task.beltId, shipId, stGal)
          : scaledReturnMs(oneLegMs(state, ctx, task.beltId, shipId, stGal), state, ctx, shipId, task.fuelMul)
      const legMsReal = task.phase === 'outbound' ? Math.max(1, Math.round(legBase / eff)) : Math.max(1, Math.round(legBase))
      const need = legMsReal - task.phaseAccMs
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
        let gain = 0
        if (cargo) {
          for (const [itemId, units] of Object.entries(cargo)) {
            if (units > 0) {
              state.warehouse.items[itemId] = (state.warehouse.items[itemId] ?? 0) + units
              moved += units
              gain += units * (ctx.items.get(itemId)?.baseSellPriceIsk ?? 0)
            }
          }
          for (const itemId of Object.keys(cargo)) delete cargo[itemId]
        }
        const belt = ctx.belts.get(task.beltId)
        const oreName = belt ? ctx.items.get(belt.oreId)?.name ?? '' : ''
        addLog(
          state,
          'trade',
          `[AI·${shipName}] 自动返港：把 ${moved.toLocaleString('zh-CN')} 单位${oreName}卸入物品仓库（本趟采得 ${task.tripUnits} 单位）。`,
          'core.ai.019',
          { p1: shipName, p2: moved.toLocaleString('zh-CN'), p3: oreName, p4: task.tripUnits },
        )
        if (stats) {
          addAiMiningTrip(stats, assignment.coreType)
          if (gain > 0) addAiIncome(stats, assignment.coreType, gain)
        }
        task.phase = 'outbound'
        task.tripUnits = 0
      } else {
        const belt = ctx.belts.get(task.beltId)
        if (belt?.galaxyId) markExplored(state, belt.galaxyId)
        task.phase = 'mining'
        task.cycleAccMs = 0
      }
      continue
    }

    const params = getMiningParams(state, ctx, { shipId, beltId: task.beltId })
    if (!params) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      addLog(state, 'warn', `[AI·${shipName}] 矿带已不存在，任务终止（${aiCoreName(assignment.coreType)} 已归还）。`, 'core.ai.020', {
        p1: shipName,
        p2: aiCoreName(assignment.coreType),
      })
      return
    }
    const servLv = Math.min(5, state.skills.trained['ai-servicing'] ?? 0)
    const servFactor = (1 - 0.03 * servLv) * aiServicingUpgradeMult(state)
    const cycleReal = Math.max(1, Math.ceil((params.cycleMs * servFactor) / realCycleDiv))
    if (task.cycleAccMs < cycleReal) {
      const need = cycleReal - task.cycleAccMs
      const take = Math.min(remaining, need)
      task.cycleAccMs += take
      remaining -= take
      if (task.cycleAccMs < cycleReal) break
    }
    task.cycleAccMs = 0

    const beltDef = ctx.belts.get(task.beltId)
    const oreNow = rollBeltOutput(state, ctx, beltDef)

    const oreM3PerCycle = params.unitsPerCycle * cargoUnitM3(state, oreNow ?? params.ore)
    const freeM3 = freeCargoM3Of(state, ctx, shipId)
    if (oreM3PerCycle > freeM3) {
      task.phase = 'returning'
      task.phaseAccMs = 0
      if (task.kind === 'mining') {
        const stGalAi = beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID
        const baseAi = scaledReturnMs(
          oneLegMs(state, ctx, task.beltId, shipId, stGalAi),
          state,
          ctx,
          shipId,
        )
        task.fuelMul = beginJumpFuelLeg(state, 'ai', baseAi)
      }
      addLog(
        state,
        'fleet',
        `[AI·${shipName}] 货仓装不下下一循环（余 ${Math.round(freeM3)} m³ ／ 每循环 ${Math.round(oreM3PerCycle)} m³）：自动返航卸货（本趟 ${task.tripUnits} 单位${oreNow?.name ?? params.ore.name}）。`,
        'core.ai.021',
        {
          p1: shipName,
          p2: Math.round(freeM3),
          p3: Math.round(oreM3PerCycle),
          p4: task.tripUnits,
          p5: oreNow?.name ?? params.ore.name,
        },
      )
      continue
    }
    let units = params.unitsPerCycle
    const rvLeft = task.rvLeft ?? 0
    if (rvLeft > 0) {
      units *= 3
      task.rvLeft = rvLeft - 1
    } else if (nextRandom(state.rng) < richVeinP(cycleReal, state, ctx)) {
      units *= 3
      task.rvLeft = 1
      addLog(state, 'fleet', `[AI·${shipName}] 富矿脉！连续 2 个循环产量 ×3。`, 'core.ai.022', { p1: shipName })
    }
    units = Math.min(units, Math.floor(freeM3 / cargoUnitM3(state, oreNow ?? params.ore)))
    if (!oreNow) {
      const cargoFallback = state.fleet[shipId]!.cargo
      cargoFallback[params.ore.id] = (cargoFallback[params.ore.id] ?? 0) + units
      task.tripUnits += units
bumpFirst(state, 'mineUnits', units)
      continue
    }
    const cargo = state.fleet[shipId]!.cargo
    cargo[oreNow.id] = (cargo[oreNow.id] ?? 0) + units
    task.tripUnits += units
bumpFirst(state, 'mineUnits', units)
  }
}

export type AiMiningTaskState = Extract<GameState['aiAssignments'][string]['task'], { kind: 'mining' }>
