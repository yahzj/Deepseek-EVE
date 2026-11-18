import { haltActivityForSwitch } from '../../state'
import { applyActivityGate, logAutoHalt } from '../../activityGate'
import type { CommandResult } from '../../engine'
import type { GameState } from '../../state'
import type { AiCoreType, SimContext } from '../../types'
import { addWare } from '../../inventory'
import { aiCoreCapBlock, aiCoreName, aiEfficiency, countAiCore, occupyAiCore } from '../../ai'
import { stationIndustryBlocked, stationActivityStartBlockReason } from '../../location'
import { queueStationActivity } from '../../stationActivityPending'
import { RECYCLE_CYCLE_MS, recycleProfileOf } from '../../salvage'
import { industryAvailable, recycleBatchM3Of } from './params'

export function startRecycleRun(
  state: GameState,
  wreckItemId: string,
  worker: 'pilot' | AiCoreType,
  ctx: SimContext,
): CommandResult {
  const def = ctx.items.get(wreckItemId)
  if (!def) return { ok: false, error: `未知物品：${wreckItemId}。`, errorId: 'core.industry.002', errorParams: { p1: wreckItemId } }
  if (def.kind !== 'wreck') {
    return { ok: false, error: `「${def.name}」不是残骸——残骸回收只接受打捞到的残骸。`, errorId: 'core.industry.009', errorParams: { p1: def.name } }
  }
  const profile = recycleProfileOf(ctx, wreckItemId)
  if (!profile) {
    return { ok: false, error: `「${def.name}」来源记录缺失，无法回收。`, errorId: 'core.industry.010', errorParams: { p1: def.name } }
  }
  const available = industryAvailable(state, ctx, wreckItemId, worker === 'pilot' ? worker : undefined)
  if (available <= 0) {
    return { ok: false, error: `货仓与仓库里都没有 ${def.name}。`, errorId: 'core.industry.004', errorParams: { p1: def.name } }
  }
  const batchM3 = recycleBatchM3Of(wreckItemId)
  if (available < batchM3) {
    return {
      ok: false,
      error: `残骸不足一批（每批 ${batchM3} m³，现有 ${Math.round(available * 100) / 100} m³）——先凑够同型号残骸再拆解。`,
      errorId: 'core.industry.011',
      errorParams: { p1: batchM3, p2: Math.round(available * 100) / 100 },
    }
  }
  if (worker === 'pilot') {
    const dockBlock = stationActivityStartBlockReason(state, ctx, 'refine')
    if (dockBlock) return { ok: false, ...dockBlock }
    const queued = queueStationActivity(state, ctx, { kind: 'recycle', itemId: wreckItemId })
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
      return { ok: false, error: `${aiCoreName(worker)} 库存不足，无法接入回收炉。`, errorId: 'core.industry.012', errorParams: { p1: aiCoreName(worker) } }
    }
  }
  if (stationIndustryBlocked(worker, state, ctx)) {
    return {
        ok: false,
        error: '残骸回收炉随协会基地网络运转：需停靠空间站（母港或已建成副站）才能启动（AI 核心驱动不受此限）。',
        errorId: 'core.industry.086',
      }
  }
  const eff = worker === 'pilot' ? 1 : aiEfficiency(state, ctx, worker)
  let cycleEff = Math.max(1, Math.round(RECYCLE_CYCLE_MS / eff))
  const recLv = Math.min(5, state.skills.trained['salvage-recycling'] ?? 0)
  if (recLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.04 * recLv)))
  const recUpLv = Math.min(5, state.skills.trained['salvage-recycling-integration'] ?? 0)
  if (recUpLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.015 * recUpLv)))
  if (state.debugQuick) cycleEff = 1000
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return { ok: false, error: `${aiCoreName(worker)} 占用失败（库存异常）。`, errorId: 'core.industry.013', errorParams: { p1: aiCoreName(worker) } }
  }
  const legacyClaim = Math.max(0, state.refineRuns.reduce((s, x) => s + (x.claimedUnits ?? 0), 0))
  if (legacyClaim > 0) {
    for (const x of state.refineRuns) {
      if ((x.claimedUnits ?? 0) > 0 && x.itemId) addWare(state, x.itemId, x.claimedUnits!)
      x.claimedUnits = 0
    }
  }
  state.refineRuns.push({
    active: true,
    id: state.refineSeq++,
    worker,
    recipe: 'recycle',
    itemId: wreckItemId,
    batchUnits: batchM3,
    cycleMs: cycleEff,
    finishAtGameMs: state.gameMs + cycleEff,
    batchesDone: 0,
    recAcc: { min: {}, mod: {}, frag: {}, drone: {} },
  })
  return { ok: true }
}
