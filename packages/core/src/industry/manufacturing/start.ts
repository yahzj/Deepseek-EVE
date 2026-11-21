import { addLog, haltActivityForSwitch } from '../../state'
import { applyActivityGate, logAutoHalt } from '../../activityGate'
import type { CommandResult } from '../../engine'
import type { GameState } from '../../state'
import type { AiCoreType, SimContext } from '../../types'
import { formatDurationMs } from '../../time'
import { aiCoreCapBlock, aiCoreName, aiEfficiency, countAiCore, occupyAiCore } from '../../ai'
import { stationIndustryBlocked, stationActivityStartBlockReason } from '../../location'
import { queueStationActivity } from '../../stationActivityPending'
import { DEEP_SPACE_PROBE_BLUEPRINT_ID, probeManufacturingUnlocked } from '../../probeManufacturing'
import { findBuildable, isSingleUseBlueprint, recipeCapability, ownsBlueprint, blueprintName, spendOneTimeBook, productNameOf } from './blueprints'
import { missingMaterials, spendMaterialsFor } from './materials'
import { manufacturingManualActive } from './view'
import { calcBuildDurationMs } from './duration'

export function startManufacturing(
  state: GameState,
  blueprintId: string,
  worker: 'pilot' | AiCoreType,
  ctx: SimContext,
): CommandResult {
  const buildable = findBuildable(ctx, blueprintId)
  if (!buildable) {
    return { ok: false, error: `未知蓝图：${blueprintId}。`, errorId: 'core.manufacturing.002', errorParams: { p1: blueprintId } }
  }
  if (blueprintId === DEEP_SPACE_PROBE_BLUEPRINT_ID && !probeManufacturingUnlocked(state)) {
    return { ok: false, error: '星系搜索尚未解锁，无法制造深空探测机。', errorId: 'core.probeManufacturing.001' }
  }
  const singleUse = isSingleUseBlueprint(ctx, blueprintId)
  const cap = recipeCapability(state, blueprintId, singleUse)
  if (!ownsBlueprint(state, blueprintId) && buildable.spec.learnless !== true) {
    if (singleUse) {
      if (cap.kind !== 'ok') {
        if ((state.spentOneTimeRecipes ?? []).includes(blueprintId)) {
          return {
            ok: false,
            error: '这张一次性图纸的制造名额已用尽：需要再获得一张同名一次性图纸。',
            errorId: 'core.manufacturing.003',
          }
        }
        return {
          ok: false,
          error: '一次性图纸不在蓝图书架：请先获得这张图纸。',
          errorId: 'core.manufacturing.004',
        }
      }
    } else {
      const bpName = blueprintName(ctx, blueprintId)
      return {
        ok: false,
        error: `尚未学会「${bpName}」的配方：在市场买回蓝图书并学习后才能制造。`,
        errorId: 'core.manufacturing.005',
        errorParams: { p1: bpName },
      }
    }
  }
  const missing = missingMaterials(state, ctx, buildable.spec, blueprintId)
  if (missing.length > 0) {
    const missingText = missing.join('、')
    return {
      ok: false,
      error: `材料不足：${missingText}。`,
      errorId: 'core.manufacturing.010',
      errorParams: { p1: missingText },
    }
  }
  if (worker === 'pilot') {
    const dockBlock = stationActivityStartBlockReason(state, ctx, 'manufacturing')
    if (dockBlock) return { ok: false, ...dockBlock }
    const queued = queueStationActivity(state, ctx, { kind: 'manufacturing', blueprintId })
    if (queued) return queued
    const gateSkip = applyActivityGate(state, 'manufacturing', ctx)
    if (gateSkip) return gateSkip
    if (manufacturingManualActive(state)) {
      haltActivityForSwitch(state, 'manufacturing')
      logAutoHalt(state, 'manufacturing')
    }
  } else {
    const capBlock = aiCoreCapBlock(state, ctx, 'industry')
    if (capBlock) return { ok: false, error: capBlock.error, errorId: capBlock.errorId, errorParams: capBlock.errorParams }
    if (countAiCore(state, worker) <= 0) {
      return {
        ok: false,
        error: `${aiCoreName(worker)} 库存不足，无法接入组装机。`,
        errorId: 'core.manufacturing.008',
        errorParams: { p1: aiCoreName(worker) },
      }
    }
  }
  if (stationIndustryBlocked(worker, state, ctx)) {
    return {
      ok: false,
      error: '组装机随协会基地网络运转：需停靠空间站（母港或已建成副站）才能开工制造（AI 核心驱动不受此限）。',
      errorId: 'core.manufacturing.001',
    }
  }
  let durationMs = calcBuildDurationMs(state, ctx, buildable.spec)
  if (worker !== 'pilot') {
    const eff = aiEfficiency(state, ctx, worker)
    durationMs = Math.max(1, Math.round(durationMs / eff))
  }
  const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
  if (autoLv > 0) durationMs = Math.max(1, Math.round(durationMs * Math.max(0, 1 - 0.05 * autoLv)))
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return {
      ok: false,
      error: `${aiCoreName(worker)} 占用失败（库存异常）。`,
      errorId: 'core.manufacturing.009',
      errorParams: { p1: aiCoreName(worker) },
    }
  }
  const spentMaterials: { itemId: string; count: number }[] = []
  if (!spendMaterialsFor(state, buildable.spec.materials, spentMaterials, blueprintId)) {
    return { ok: false, error: '材料不足：物品仓库里的料凑不齐这一件。', errorId: 'core.manufacturing.010', errorParams: { p1Id: 'core.manufacturing.016' } }
  }
  if (cap.consumeBook && !spendOneTimeBook(state, blueprintId)) {
    return {
      ok: false,
      error: '一次性图纸不在蓝图书架：请先获得这张图纸。',
      errorId: 'core.manufacturing.004',
    }
  }

  state.manufacturingRuns.push({
    active: true,
    id: state.manufacturingSeq++,
    blueprintId,
    worker,
    finishAtGameMs: state.gameMs + durationMs,
    durationMs,
    ...(cap.consumeBook ? { bookSpent: true } : {}),
    spentMaterials,
  })
  const productName = productNameOf(ctx, buildable, blueprintId)
  addLog(
    state,
    'trade',
    `制造开始：${productName}（蓝图「${blueprintName(ctx, blueprintId)}」）${cap.consumeBook ? '［一次性图纸：已消耗，本配方只能制造一次］' : ''}，${worker === 'pilot' ? '主控亲自开线' : `${aiCoreName(worker)}驱动`}，预计 ${formatDurationMs(durationMs)} 完成。`,
  )
  return { ok: true }
}
