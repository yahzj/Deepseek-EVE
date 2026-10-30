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
  // 稀有残骸已开放（船长 2026-09-10：二号五族专属装备齐备后解禁）——它与普通残骸同一条链路，
  // 区别只在"首批触发一次高级箱"（`profile.rare === true`，见下方结算处）：
  // 一炉一箱（船长定：按炉结算，不按件累积），其余保底/彩头/碎片照常。
  const def = ctx.items.get(wreckItemId)
  if (!def) return { ok: false, error: `未知物品：${wreckItemId}。`, errorId: 'core.industry.002', errorParams: { p1: wreckItemId } }
  if (def.kind !== 'wreck') {
    return { ok: false, error: `「${def.name}」不是残骸——残骸回收只接受打捞到的残骸。`, errorId: 'core.industry.009', errorParams: { p1: def.name } }
  }
  const profile = recycleProfileOf(ctx, wreckItemId)
  if (!profile) {
    return { ok: false, error: `「${def.name}」来源记录缺失，无法回收。`, errorId: 'core.industry.010', errorParams: { p1: def.name } }
  }
  /**
   * ⚠ **2026-09-26：H 族残骸的回收闸门已退役**（船长 2026-09-25 曾令「先关闭对应的精炼炉，
   * 等势力装备出来再说」；2026-09-26 三件势力装备定稿 ⇒ 理由消失，闸门与拒因 `core.industry.084`
   * 一并删除）。`salvage.wreckRecycleClosedOf` 保留为"日后要关某族"的落点、**现在恒 false**。
   */
  const available = industryAvailable(state, ctx, wreckItemId, worker === 'pilot' ? worker : undefined)
  if (available <= 0) {
    return { ok: false, error: `货仓与仓库里都没有 ${def.name}。`, errorId: 'core.industry.004', errorParams: { p1: def.name } }
  }
  // 2026-09-06（船长反馈：数量不足仍能开工）：起炉需 ≥ 一批；运行中余量不足的"尾批"处理不受影响
  // **2026-09-23 船长令**：「稀有残骸就是 30 起炉。普通残骸 100 起炉」＋问「批大小为什么要公用」⇒ 裁定**乙**：
  // **普通残骸 = 批 100 m³ / 起炉 100**、**稀有残骸 = 批 30 m³ / 起炉 30**（`RARE_UNIT_M3` = 一件的体积）。
  // 于是稀有一炉 = 一件 = **必给一次彩头**（节奏 1:1，"一炉一件"名副其实）；09-11 定下的"不预占、不分件、
  // 彩头按体积必给"三条全部保留，只是批大小不再与普通共用。
  const batchM3 = recycleBatchM3Of(wreckItemId)
  if (available < batchM3) {
    return {
      ok: false,
      error: `残骸不足一批（每批 ${batchM3} m³，现有 ${Math.round(available * 100) / 100} m³）——先凑够同型号残骸再拆解。`,
      errorId: 'core.industry.011',
      errorParams: { p1: batchM3, p2: Math.round(available * 100) / 100 },
    }
  }
  /**
   * 主控亲自回收：**跨活动统一判据**（含"手动工作位换机器"——见 `startRefineRun` 的说明）。
   * ⚠ 判据排在**位置门槛之前**（停机即把舰船带回空间站）；上面的"够不够一批"与停机无关
   * （`oreAvailable` = 货仓 + 仓库，停下来的货留在船上）⇒ 谁先谁后都行。
   */
  if (worker === 'pilot') {
    const dockBlock = stationActivityStartBlockReason(state, ctx, 'refine')
    if (dockBlock) return { ok: false, ...dockBlock }
    const queued = queueStationActivity(state, ctx, { kind: 'recycle', itemId: wreckItemId })
    if (queued) return queued
    const gateSkip = applyActivityGate(state, 'refine', ctx)
    if (gateSkip) return gateSkip
    /** 同档换机器（见 `startRefineRun`）：停掉手上那台 + 统一日志 */
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
  // AI 核心驱动不看位置（判据单点 = `stationIndustryBlocked`）：出海时照常开工，亲自运转仍要求在基地网络内。
  if (stationIndustryBlocked(worker, state, ctx)) {
    return {
        ok: false,
        error: '残骸回收炉随协会基地网络运转：需停靠空间站（母港或已建成副站）才能启动（AI 核心驱动不受此限）。',
        errorId: 'core.industry.086',
      }
  }
  const eff = worker === 'pilot' ? 1 : aiEfficiency(state, ctx, worker)
  let cycleEff = Math.max(1, Math.round(RECYCLE_CYCLE_MS / eff))
  // 残骸回收学（salvage-recycling）：回收批周期每级 −4%（手动与 AI 同享；
  // 2026-09-08 船长定：移除「至少保留 60%」护栏）
  const recLv = Math.min(5, state.skills.trained['salvage-recycling'] ?? 0)
  if (recLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.04 * recLv)))
  // 2026-09-27 上位技能：残骸流水线学 −1.5%/级（与残骸回收学同乘区）
  const recUpLv = Math.min(5, state.skills.trained['salvage-recycling-integration'] ?? 0)
  if (recUpLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.015 * recUpLv)))
  // 调试「1 秒化」（2026-10-01 补 · 全仓同款）：固定 1 秒、不吃技能乘区；只影响新起的线
  if (state.debugQuick) cycleEff = 1000
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return { ok: false, error: `${aiCoreName(worker)} 占用失败（库存异常）。`, errorId: 'core.industry.013', errorParams: { p1: aiCoreName(worker) } }
  }
  // 2026-09-11 船长定（第二次修订）：**稀有残骸照普通残骸回收的机制走**（不预占、不分"件/单元"、
  // 不解锁额外状态），只改两件事：
  //   ① 高级箱不再按概率抽 —— **每烧掉 `RARE_UNIT_M3`（= 30 m³）就必给**一次彩头；
  //   ② 抽奖池里加入该敌族的**专属装备**（`rollRareBoxExtra` 内已含 poolOnly 的专属件）。
  // 彩头按**累计已烧体积**每满 30 m³ 结算一次（同一批料无论怎么起停都只结算一次）。
  // ⚠ 原句「批大小仍与普通残骸一致（`RECYCLE_BATCH_M3`）」**已按 2026-09-23 船长令（乙案）删除**：
  //   现在是「普通批 100 m³ / 稀有批 30 m³（`RARE_UNIT_M3`）」——留着那句旧话会再次把人带偏
  //   （卡面文案曾因此出现"锁 30 = 1 件 · 每批 100"的自相矛盾）。
  // 老档兼容：历史档里 `claimedUnits`（起炉预占的炉内料账）**一律退回仓库**——新语义下料不再进炉内账。
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
    // 2026-09-11 最终口径：稀有残骸与普通残骸**同一条路径**（实时扣料、不预占、不写炉内账）。
    // 彩头结算按 `state.rareBurnUnits`（全局累计已烧体积）每满 30 m³ 一次——见批结算处的门闸。
    recAcc: { min: {}, mod: {}, frag: {}, drone: {} }, // 回收所得累计（停炉/料尽/自然结束时写明细日志）
  })
  // 2026-09-06：不再写开工日志（同精炼炉口径；结束/停炉日志统一带回收所得明细）
  return { ok: true }
}
