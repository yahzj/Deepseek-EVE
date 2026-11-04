/** 功能域职责拆分，保持原计算与顺序。 */
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

/** AI 采矿任务推进（真实毫秒口径；循环/周转周期按效率拉长） */
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
  const realCycleDiv = eff // 玩家周期 cycleMs ÷ eff = 副船真实周期
  const shipName = shipDisplayName(state, ctx, shipId)

  let remaining = deltaMs
  while (remaining > 0) {
    // 返航 / 出航（T4：腿分方向——出航空船腿减半（跃迁×2），返航满载用正常腿；
    // 效率只拉长出航腿与循环周期，返航腿与主控一致不再 ÷eff（卷B2⑥））
    if (task.phase === 'returning' || task.phase === 'outbound') {
      // T9：AI 采矿往返以"离矿带最近空间站"为基准（未建副站时 = 母港）
      const beltDef = ctx.belts.get(task.beltId)
      const stGal = beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID
      // 返航腿与主控同口径（2026-09-08 卷B2⑥ 船长定稿）：满仓基准时长先按货仓占比缩放，不再 ÷核心效率
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
        // 到港：把船上货仓全部卸入物品仓库（2026-09-08：离线结算按趟统计 + 卸货按站内收价估收入）
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
        // 到达矿带：恢复采掘（V13：AI 船实际抵达 → 点亮该星系）
        const belt = ctx.belts.get(task.beltId)
        if (belt?.galaxyId) markExplored(state, belt.galaxyId)
        task.phase = 'mining'
        task.cycleAccMs = 0
      }
      continue
    }

    // 采掘：逐循环结算（周期 = 玩家 cycleMs ÷ eff；副船整备学再 −3%/级）
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
    // 2026-09-27 上位技能：副船统合整备学走单点（与读数口同一函数，天然同源）
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

    // V16 复合带：本循环先掷产物（决定单位体积与入舱品种；与主控同一随机源）
    const beltDef = ctx.belts.get(task.beltId)
    const oreNow = rollBeltOutput(state, ctx, beltDef)

    // 满舱检查（货仓放不下整个循环 → 自动返航）：剩余空间走 inventory.freeCargoM3Of 单点
    // （2026-09-12 P0：此处原为手写副本 freeCargoFor，漏算货舱类技能 ⇒ AI 船未满即返航）
    const oreM3PerCycle = params.unitsPerCycle * cargoUnitM3(state, oreNow ?? params.ore)
    const freeM3 = freeCargoM3Of(state, ctx, shipId)
    if (oreM3PerCycle > freeM3) {
      task.phase = 'returning'
      task.phaseAccMs = 0
      /**
       * **跃迁燃料**（2026-09-29）：AI 副船这一支按 `'ai'` 这一个开关走（不按船分档）——
       * 与"设置哪些活动使用燃料"的界面口径一致；原返航时长按秒扣料，倍率存进本条任务。
       */
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
    // 富矿脉判定与主控一致（卷B2⑥ 红利窗口：触发当轮 ×3 并开 1 个红利循环；窗口内不掷点不写日志；
    // 判定恒消耗一次随机数保 rng 时序；窗口与矿带绑定，自动循环返航卸货回原带保留）
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
    if (!oreNow) {
      // 记录缺失：按主产物入舱兜底（正常情况下 roll 不会返回 null）
      const cargoFallback = state.fleet[shipId]!.cargo
      cargoFallback[params.ore.id] = (cargoFallback[params.ore.id] ?? 0) + units
      task.tripUnits += units
      /**
       * **AI 副船的产量计入终身计数**（船长 2026-09-20：「**成就系统和重要任务的累计，
       * 也计入AI副船的产量**」）。
       *
       * 为什么补在这里：`mineUnits` 原先只在**主控采掘循环**（`mining.ts`）里记，
       * AI 侧只累计了本趟的 `task.tripUnits`（纯日志用）⇒ **同样一单位原矿，玩家亲自采算、
       * 派 AI 采不算**。而精炼/制造/造船/维修那几项**早就含 AI**（`industry.ts` /
       * `manufacturing.ts` / `shipyard.ts` 的结算函数主控与 AI 共用）⇒ 补齐后口径统一。
       *
       * ⚠ 两处入账点（正常 / 兜底）都要记，否则"矿脉记录缺失"那条支路会静默漏账。
       * 计数口径与主控一致 = **入舱的实际单位数**（含富矿脉 ×3 之后的数）。
       */
bumpFirst(state, 'mineUnits', units)
      continue
    }
    const cargo = state.fleet[shipId]!.cargo
    cargo[oreNow.id] = (cargo[oreNow.id] ?? 0) + units
    task.tripUnits += units
    // 同上：AI 副船采掘计入终身计数（与主控同口径）
bumpFirst(state, 'mineUnits', units)
  }
}

export type AiMiningTaskState = Extract<GameState['aiAssignments'][string]['task'], { kind: 'mining' }>
