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

/**
 * 玩家指令：启动一台精炼炉（v20：同资源允许多台同时运转、原料不锁定——每批到点从仓库
 * 实时扣取，耗尽自动停；worker = 'pilot'（主控亲自运转，全局限 1 台、占主控工作位）或
 * AI 核心类型（每台需一枚闲置核心 + 一个「AI 核心上限」名额——上限由 AI 核心上限技能
 * 决定，与 AI 副船任务共用；核心出库占用、停炉/料尽自动归还）。
 */
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
  /**
   * **主控亲自运转 ⇒ 走统一判据**（**2026-09-21 船长令**：能直接切就自动取消当前活动，只有长途运输
   * 那一档先警告；远征/快递/战斗中/洞里/返航途中一律拒）。
   *
   * ⚠ **手动工作位（精炼炉·回收炉·拆解·制造线）之间也允许直接切**（**船长当日答 1/2「允许切换」**）：
   * 它由统一判据**顺带**完成——当前那一台是 `refine` 这一档 ⇒ gate 判 `halt` ⇒ 停炉（**当前那批进度
   * 丢弃**，代价写在统一日志里）＋照常开工新机器。原先这里另有一条"手动位互斥"硬拒，本轮删除。
   *
   * ⚠ **判据排在"位置门槛"之前**（玩家 2026-09-21 报障「采矿时无法直接切换精炼炉手动运转」）——
   * 自动停机**本身就把舰船即时带回母港/空间站**（`miningHalt`/`salvageHalt`/`haulingHalt`/掩护巡逻
   * 召回全是即时归位），位置门槛正是被这次停机**满足**的；若排在它后面，玩家会先看到
   * 「需停靠空间站」，而其实一键就能回来。
   */
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
  /**
   * **手动精炼双技都改成"手动与 AI 核心驱动同享"**（2026-09-22 船长令）。
   *
   * 船长先点炉心熔炼学：「炉心熔炼学好像只对主控生效？现在希望改成对所有都生效。并修改文案」；
   * 同日追问炉膛扩容学要不要一起放开，船长裁定「**一起开放**」。
   *
   * 原先这两条**整段写在 `worker === 'pilot'` 分支里** ⇒ AI 核心驱动的精炼炉一点不吃这两个技能。
   * 现在都挪出分支、对**所有劳动者**生效（与 2026-09-08 产线节拍学「手动与 AI 核心驱动同享」同一改法）；
   * 乘算顺序不变：先 ÷核心效率、再吃技能、最后乘产线节拍学。
   *
   * ⚠ **已知副作用（船长已知情并接受）**：批容变大 ⇒ 下面那道「可炼量不足一批」的开工门对 AI 线也更严
   * （炉膛扩容学满级 10 → 13 单位，囤货不足 13 就开不了工）。要放宽这道门是另一件事，本函数不做。
   */
  const smeltLv = Math.min(5, state.skills.trained['core-smelting'] ?? 0)
  /**
   * ⚠ **下限 0.6 已移除**（**2026-09-29 船长令**：「炉心熔炼学为什么还会有下限？移除」）——
   * 旧写法是 `Math.max(0.6, 1 - 0.04 * smeltLv)`，而满级 5 级 = 恰好 0.80，**下限从来没生效过**
   * （它只在"技能等级被外力写到 10 以上"时才会咬，属历史遗留的假护栏）。
   * 现在与同乘区的其余四条一致：**只做乘算、不设下限**（乘算本身有界：每条 ≤5 级）。
   */
  if (smeltLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * (1 - 0.04 * smeltLv)))
  /**
   * 炉压调控学（**2026-09-29 船长令**：新 R3，插在炉心熔炼学与炉温精调学之间，每级 −4%）——
   * 与炉心熔炼学**同一乘区**（都是精炼炉周期），手动与 AI 核心驱动同享。
   */
  const pressLv = Math.min(5, state.skills.trained['furnace-pressure'] ?? 0)
  if (pressLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * (1 - 0.04 * pressLv)))
  /**
   * 炉温精调学：**每级 4% → 3%**（**2026-09-29 船长令**：「炉温精调学效果下调到 −3%/级」）
   * —— 与炉心熔炼学、炉压调控学同一乘区，手动与 AI 核心驱动同享。
   */
  const fineLv = Math.min(5, state.skills.trained['furnace-precision'] ?? 0)
  if (fineLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.03 * fineLv)))
  // 2026-09-27 上位技能：恒温炉控学 −1.5%/级（与炉温精调学同乘区）
  const fineUpLv = Math.min(5, state.skills.trained['furnace-thermal-control'] ?? 0)
  if (fineUpLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.015 * fineUpLv)))
  const expLv = Math.min(5, state.skills.trained['furnace-expansion'] ?? 0)
  const expMul = 1 + 0.06 * expLv
  /**
   * 炉膛倍增学：**每级 2% → 4%**（**2026-09-29 船长令**：「炉膛倍增学效果上调到 4%/级」）；
   * 炉膛重构学（**2026-09-29 船长令**：新 R5，炉膛倍增学的后续，每级再 +2%）——
   * 三者同乘区（精炼炉批容），手动与 AI 核心驱动同享。
   * ⚠ 每级的乘式都紧挨自己的 id 字面量写：`content:check` 的技能说明契约按"id ±400 字符"现场复核每级值。
   */
  const expUpLv = Math.min(5, state.skills.trained['furnace-amplification'] ?? 0)
  const expUpMul = 1 + 0.04 * expUpLv
  const expReLv = Math.min(5, state.skills.trained['furnace-reconfiguration'] ?? 0)
  const expReMul = 1 + 0.02 * expReLv
  if (expLv > 0 || expUpLv > 0 || expReLv > 0) {
    batchEff = Math.max(1, ceilFinalQuantity(batchUnits * expMul * expUpMul * expReMul))
  }
  // 产线节拍学（原"工业自动化"，id industrial-automation；2026-09-08 船长定：手动与 AI 核心驱动同享）：
  // 精炼炉作业每级再 −5% 周期（下限护栏已于同日移除，乘算本身有界）
  const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
  if (autoLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - 0.05 * autoLv)))
  /**
   * **谜质科技「虚空精炼加速 / 虚空精炼统合」**（**2026-09-30 船长令**：两个洞外工业科技，
   * 每级 −10% / −5%，各 3 级）——**只作用于虚空母矿那一支**（判据 = 物品 id，与
   * `refineBatchOutputOf` 里"虚空晶那一支吃 `voidCrystalYield`"同一把尺）。
   * 与上面那串技能**同乘区**（都是精炼炉周期），两支加法汇总后一次性折算。
   */
  if (def.id === WORMHOLE_ORE_ITEM_ID) {
    const voidCut = matterTechVoidRefineCut(state, ctx)
    if (voidCut > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0, 1 - voidCut)))
  }
  /**
   * **调试「1 秒化」**（**2026-10-01 补** · 普查发现炉子是唯一漏的一档）。
   *
   * 口径与另两条产线**逐字同款**（`calcBuildDurationMs` 的 `state.debugQuick ? 1000 : …`、
   * `labCycleMsOf` 的 `if (state.debugQuick) return 1000`）：**固定 1 秒**、不吃技能乘区；
   * 调试面板自称「**所有作业**按 1 秒完成」，而全仓 20 处 `state.debugQuick` 触点里 `industry.ts` 原先**零处**
   * ⇒ 开着调试开炉仍要等满周期。放在技能乘区**之后**，与另两条一致（调试值不参与折算）。
   * ⚠ 只影响**新起的炉/线**：在跑的那台周期在起炉那一刻已锁定（与制造线同款，不重算）。
   */
  if (state.debugQuick) cycleEff = 1000
  // 原料和位置前置全部通过后才停旧作业，失败不丢掉手动产线进度。
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
  // v20：原料不预锁定——仓库/货仓余量即炉料，每批到点实时扣取
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
    recAcc: { min: {}, mod: {}, frag: {}, drone: {} }, // 炉内所得累计（停炉/料尽/自然结束时写明细日志；精炼只用 min）
  })
  // 2026-09-06：不再写开工日志（活动栏/卡片已实时可见，开工即写会刷屏）；结束/停炉日志统一带所得明细
  return { ok: true }
}
