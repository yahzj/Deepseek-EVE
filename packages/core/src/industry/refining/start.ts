import { ceilFinalQuantity } from '../../quantity'
import { matterTechVoidRefineCut } from '../../matterTech'
import { WORMHOLE_ORE_ITEM_ID } from '../../wormhole'
import { haltActivityForSwitch } from '../../state'
import { applyActivityGate, logAutoHalt } from '../../activityGate'
import type { CommandResult } from '../../engine'
import type { GameState } from '../../state'
import type { AiCoreType, SimContext } from '../../types'
import { aiCoreCapBlock, aiCoreName, aiEfficiency, countAiCore, occupyAiCore } from '../../ai'
import { stationActivityStartBlockReason } from '../../location'
import { queueStationActivity } from '../../stationActivityPending'
import { industryAvailable, refineBaseParamsOf } from './params'

export function startRefineRun(
  state: GameState,
  itemId: string,
  worker: 'pilot' | AiCoreType,
  ctx: SimContext,
): CommandResult {
  const def = ctx.items.get(itemId)
  if (!def) {
    return { ok: false, error: `未知物品：${itemId}。`, errorId: 'core.industry.002', errorParams: { p1: itemId } }
  }
  if (!def.refine || def.refine.length === 0) {
    return { ok: false, error: `「${def.name}」没有精炼配方（只支持原矿/气体/冰矿）。`, errorId: 'core.industry.003', errorParams: { p1: def.name } }
  }
  const available = industryAvailable(state, ctx, itemId, worker === 'pilot' ? worker : undefined)
  if (available <= 0) {
    return { ok: false, error: `货仓与仓库里都没有 ${def.name}。`, errorId: 'core.industry.004', errorParams: { p1: def.name } }
  }
  if (worker === 'pilot') {
    const dockBlock = stationActivityStartBlockReason(state, ctx, 'refine')
    if (dockBlock) return { ok: false, ...dockBlock }
  } else {
    const capBlock = aiCoreCapBlock(state, ctx, 'industry')
    if (capBlock) return { ok: false, error: capBlock.error, errorId: capBlock.errorId, errorParams: capBlock.errorParams }
    if (countAiCore(state, worker) <= 0) {
      return { ok: false, error: `${aiCoreName(worker)} 库存不足，无法接入精炼炉。`, errorId: 'core.industry.005', errorParams: { p1: aiCoreName(worker) } }
    }
  }
  const { batchUnits, cycleMs } = refineBaseParamsOf(def)
  const eff = worker === 'pilot' ? 1 : aiEfficiency(state, ctx, worker)
  let cycleEff = Math.max(1, Math.round(cycleMs / eff))
  let batchEff = batchUnits
  const smeltLv = Math.min(5, state.skills.trained['core-smelting'] ?? 0)
  if (smeltLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * (1 - 0.04 * smeltLv)))
  const pressLv = Math.min(5, state.skills.trained['furnace-pressure'] ?? 0)
  if (pressLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * (1 - 0.04 * pressLv)))
  const fineLv = Math.min(5, state.skills.trained['furnace-precision'] ?? 0)
  if (fineLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.03 * fineLv)))
  const fineUpLv = Math.min(5, state.skills.trained['furnace-thermal-control'] ?? 0)
  if (fineUpLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.015 * fineUpLv)))
  const expLv = Math.min(5, state.skills.trained['furnace-expansion'] ?? 0)
  const expMul = 1 + 0.06 * expLv
  const expUpLv = Math.min(5, state.skills.trained['furnace-amplification'] ?? 0)
  const expUpMul = 1 + 0.04 * expUpLv
  const expReLv = Math.min(5, state.skills.trained['furnace-reconfiguration'] ?? 0)
  const expReMul = 1 + 0.02 * expReLv
  if (expLv > 0 || expUpLv > 0 || expReLv > 0) {
    batchEff = Math.max(1, ceilFinalQuantity(batchUnits * expMul * expUpMul * expReMul))
  }
  const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
  if (autoLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.05 * autoLv)))
  if (def.id === WORMHOLE_ORE_ITEM_ID) {
    const voidCut = matterTechVoidRefineCut(state, ctx)
    if (voidCut > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - voidCut)))
  }
  if (state.debugQuick) cycleEff = 1000
  if (available < batchEff) {
    return {
      ok: false,
      error: `可炼量不足一批（每批 ${batchEff} 单位，现有 ${available} 单位）——先集齐再开工。`,
      errorId: 'core.industry.006',
      errorParams: { p1: batchEff, p2: available },
    }
  }
  if (worker === 'pilot') {
    const queued = queueStationActivity(state, ctx, { kind: 'refine', itemId })
    if (queued) return queued
    const gateSkip = applyActivityGate(state, 'refine', ctx)
    if (gateSkip) return gateSkip
    if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
      haltActivityForSwitch(state, 'refine')
      logAutoHalt(state, 'refine')
    }
  }
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return { ok: false, error: `${aiCoreName(worker)} 占用失败（库存异常）。`, errorId: 'core.industry.013', errorParams: { p1: aiCoreName(worker) } }
  }
  state.refineRuns.push({
    active: true,
    id: state.refineSeq++,
    worker,
    recipe: 'refine',
    itemId,
    batchUnits: batchEff,
    cycleMs: cycleEff,
    finishAtGameMs: state.gameMs + cycleEff,
    batchesDone: 0,
    recAcc: { min: {}, mod: {}, frag: {}, drone: {} },
  })
  return { ok: true }
}
