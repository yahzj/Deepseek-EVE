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

/**
 * 玩家指令：**拆解一件虫洞货柜**（F4d · 船长 2026-09-13 定案；2026-09-14 增图纸货柜）。
 *
 * 口径（船长原话要点）：走**精炼配方口径**（与精炼 / 回收**同一条产线机器**：主控亲自 或 1 枚 AI 核心）·
 * **90 秒/件** · 一箱出 **1 件**。**抽取口径 2026-09-14 起分岔**：安全货柜 = 100% 族专属池；
 * 图纸货柜 = 5% 永久图纸 / 95% 一次性图纸（按该货柜的层档过滤）。
 * 抽取见 `wormholeSalvage.wormholeUnboxRoll`；产出走**与随行战利品同一条入库路径**。
 */
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
    /** 顺序同 `startRefineRun`：判据 → **同档换机器收口（停手上那台 + 统一日志）** → 位置门槛 */
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
  // 谜质科技「货柜拆解技术」：每级 −25%（加法口径 ⇒ 满级 −75%；船长 2026-09-19）
  const unboxBase = Math.round(UNBOX_CYCLE_MS * (1 - matterTechUnboxCut(state, ctx)))
  let cycleEff = Math.max(1, Math.round(unboxBase / eff))
  // 产线节拍学（与精炼 / 回收同款）：每级 −5% 周期（手动与 AI 核心驱动同享）
  const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
  if (autoLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.05 * autoLv)))
  // 调试「1 秒化」（2026-10-01 补 · 全仓同款）：固定 1 秒、不吃技能乘区；只影响新起的线
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
