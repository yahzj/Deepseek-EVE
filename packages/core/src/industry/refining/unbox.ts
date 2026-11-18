import { matterTechUnboxCut } from '../../matterTech'
import { haltActivityForSwitch } from '../../state'
import { applyActivityGate, logAutoHalt } from '../../activityGate'
import type { CommandResult } from '../../engine'
import type { GameState } from '../../state'
import type { AiCoreType, SimContext } from '../../types'
import { aiCoreCapBlock, aiCoreName, aiEfficiency, countAiCore, occupyAiCore } from '../../ai'
import { stationIndustryBlocked, stationActivityStartBlockReason } from '../../location'
import { queueStationActivity } from '../../stationActivityPending'
import { industryAvailable, UNBOX_CYCLE_MS } from './params'
import { encryptedBlueprintGroups, encryptedFamilyOf } from '../../encryptedContainer'

export function startUnboxRun(
  state: GameState,
  ctx: SimContext,
  boxItemId: string,
  worker: 'pilot' | AiCoreType,
): CommandResult {
  const def = ctx.items.get(boxItemId)
  if (!def) return { ok: false, error: `未知物品：${boxItemId}。`, errorId: 'core.industry.002', errorParams: { p1: boxItemId } }
  if (def.kind !== 'container') {
    return { ok: false, error: `「${def.name}」不是货柜——「货柜拆解」只拆虫洞带回来的货柜（安全货柜 / 图纸货柜）。`, errorId: 'core.industry.008', errorParams: { p1: def.name } }
  }
  const encryptedFamily = encryptedFamilyOf(boxItemId)
  if (encryptedFamily && !encryptedBlueprintGroups(ctx, encryptedFamily)) return { ok: false, errorId: 'core.encrypted.001' }
  if (industryAvailable(state, ctx, boxItemId, worker === 'pilot' ? worker : undefined) <= 0) {
    return { ok: false, error: `货仓与仓库里都没有 ${def.name}。`, errorId: 'core.industry.004', errorParams: { p1: def.name } }
  }
  if (worker === 'pilot') {
    const dockBlock = stationActivityStartBlockReason(state, ctx, 'refine')
    if (dockBlock) return { ok: false, ...dockBlock }
    const queued = queueStationActivity(state, ctx, { kind: 'unbox', itemId: boxItemId })
    if (queued) return queued
    const gateSkip = applyActivityGate(state, 'refine', ctx)
    if (gateSkip) return gateSkip
    if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
      haltActivityForSwitch(state, 'refine')
      logAutoHalt(state, 'refine')
    }
  } else {
    const capBlock = aiCoreCapBlock(state, ctx, 'industry')
    if (capBlock) return { ok: false, error: capBlock.error, errorId: capBlock.errorId, errorParams: capBlock.errorParams }
    if (countAiCore(state, worker) <= 0) {
      return { ok: false, error: `${aiCoreName(worker)} 库存不足，无法接入「货柜拆解」。`, errorId: 'core.industry.007', errorParams: { p1: aiCoreName(worker) } }
    }
  }
  if (stationIndustryBlocked(worker, state, ctx)) {
    return {
        ok: false,
        error: '精炼炉的「货柜拆解」随协会基地网络运转：需停靠空间站（母港或已建成副站）才能启动（AI 核心驱动不受此限）。',
        errorId: 'core.industry.085',
      }
  }
  const eff = worker === 'pilot' ? 1 : aiEfficiency(state, ctx, worker)
  const unboxBase = Math.round(UNBOX_CYCLE_MS * (1 - matterTechUnboxCut(state, ctx)))
  let cycleEff = Math.max(1, Math.round(unboxBase / eff))
  const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
  if (autoLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.05 * autoLv)))
  if (state.debugQuick) cycleEff = 1000
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return { ok: false, error: `${aiCoreName(worker)} 占用失败（库存异常）。`, errorId: 'core.industry.013', errorParams: { p1: aiCoreName(worker) } }
  }
  state.refineRuns.push({
    active: true,
    id: state.refineSeq++,
    worker,
    recipe: 'unbox',
    itemId: boxItemId,
    batchUnits: 1,
    cycleMs: cycleEff,
    finishAtGameMs: state.gameMs + cycleEff,
    batchesDone: 0,
    recAcc: { min: {}, mod: {}, frag: {}, drone: {} },
  })
  return { ok: true }
}
