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

/**
 * 玩家指令：开始制造（2026-09-08 劳动者制与精炼炉完全同款，仅处理层不同：worker = 'pilot'
 * 主控亲自（全局限 1 条、与手动精炼/回收共用手动工作位、占主控不可离港作业）或 AiCoreType
 * 一枚核心驱动一条线（同时启用数计入「AI 核心上限」——上限由 AI 核心上限技能决定、
 * 与 AI 副船任务共用；出库占用、完成/取消归还）；同一蓝图可多条线、
 * 不同蓝图不限，皆受劳动者约束；材料立即扣除（2026-09-08 船长定：取消每次制造费），
 * 时间到自动完成）。
 */
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
  // 配方可用性（2026-09-12 船长定）：普通蓝图 = 必须已学会；一次性图纸 = 有书 + 名额未用尽
  // （⚠ **已永久学会时，一次性书不消耗也不使用** —— 船长裁定「2乙」）
  // 2026-09-20 零件体系：隐式蓝图（learnless = 基础零件）无需学习即可开工。
  const singleUse = isSingleUseBlueprint(ctx, blueprintId)
  const cap = recipeCapability(state, blueprintId, singleUse)
  if (!ownsBlueprint(state, blueprintId) && buildable.spec.learnless !== true) {
    if (singleUse) {
      // ⚠ **先看"书架有没有书"**：有书就能用掉（可能是重复获得的那张）；
      // 只有"书架没书"时才区分两种拒绝——名额已用尽（要再获得一张）／从未获得过。
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
  // 2026-09-08 船长定：取消每次制造费——开工不再校验/收取 buildCostIsk（蓝图数据字段保留为历史遗留）
  // ⚠ 材料校验放在**统一判据之前**（它是本入口自己的前置，且与停机无关——材料读的是货仓 + 仓库）
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
  /**
   * 主控亲自制造 ⇒ **跨活动统一判据**（**2026-09-21 船长令**：能直接切就自动取消当前活动，长途运输
   * 先警告，远征/快递/战斗中/洞里/返航途中一律拒）。
   *
   * ⚠ **手动工作位（精炼炉·回收炉·拆解·制造线）之间也允许直接切**（船长当日答 1「允许切换」）：
   * 由统一判据顺带完成——在跑的手动炉是 `refine` 档 ⇒ gate 判 `halt` ⇒ 停炉（当前那批进度丢弃，
   * 代价写在统一日志里）＋照常开线。原先那条"手动位互斥"硬拒本轮删除。
   *
   * ⚠ 判据排在**位置门槛之前**：停机本身就把舰船即时带回母港/空间站（玩家 2026-09-21 报障
   * 「采矿时无法直接切换…手动运转」的同一处坑）。
   */
  if (worker === 'pilot') {
    const dockBlock = stationActivityStartBlockReason(state, ctx, 'manufacturing')
    if (dockBlock) return { ok: false, ...dockBlock }
    const queued = queueStationActivity(state, ctx, { kind: 'manufacturing', blueprintId })
    if (queued) return queued
    const gateSkip = applyActivityGate(state, 'manufacturing', ctx)
    if (gateSkip) return gateSkip
    /**
     * **同档再开一条 = 换线**（**2026-09-21 船长答 1「允许切换」**）：判据见"同一项"一律放行
     * （`current === next`），所以这里自己收口——停掉手上那条（当前那批进度丢弃）＋统一日志。
     */
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
  // 耗时链：calcBuildDurationMs（工业理论 × 批量生产学）为共同基准；AI 先 ÷核心效率；
  // 产线节拍学 −5%/级（2026-09-08 船长定：手动与 AI 核心驱动同享）最后统一再乘一区（无下限护栏）
  /**
   * **位置门槛（放在统一判据之后）**：AI 核心驱动不看位置（判据单点 = `stationIndustryBlocked`），
   * 出海时照常开工；亲自开线要求在基地网络内——而这一步可能刚被上面的自动停机**满足**
   * （采矿/打捞/掩护巡逻停下时舰船已即时归位）。
   */
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
  // AI 线：先占用核心（材料校验之后、扣料之前——失败不产生任何副作用）
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return {
      ok: false,
      error: `${aiCoreName(worker)} 占用失败（库存异常）。`,
      errorId: 'core.manufacturing.009',
      errorParams: { p1: aiCoreName(worker) },
    }
  }
  // 扣材料（物品仓库，按材料学折扣后数量）；制造费已于 2026-09-08 取消，不再扣款
  /**
   * **逐条记下这一线实际扣了多少料**（2026-09-24 船长令「自动停机材料一起退」）：
   * 停机那条路没有 ctx ⇒ 退料只能靠这本账；顺带保证"扣多少退多少"（不受中途升技能影响）。
   *
   * ⚠ **这本账只记"在跑那一件已扣的料"**（**2026-10-01 收口**）：一件交付时账结清（见 `advanceManufacturing`），
   * 循环续做下一件时换记那一件的 ⇒ 取消/停机时退的**正好是在跑那件**，不会多退也不会少退。
   */
  const spentMaterials: { itemId: string; count: number }[] = []
  if (!spendMaterialsFor(state, buildable.spec.materials, spentMaterials, blueprintId)) {
    /** 上面已用 `missingMaterials` 挡过一次；走到这里 = 库存竞态（同批多个入口并发扣）⇒ 照实报，不留半扣 */
    return { ok: false, error: '材料不足：物品仓库里的料凑不齐这一件。', errorId: 'core.manufacturing.010', errorParams: { p1Id: 'core.manufacturing.016' } }
  }
  // 一次性图纸：**开工那一刻吃掉这本书**（船长裁定「3甲」，与材料同源）；
  // ⚠ 2026-09-20 船长改判：「一次性蓝图的制造取消后返还玩家蓝图」
  //   ⇒ 取消时**书与名额一起退还**（见 `cancelManufacturing` / `refundOneTimeBook`）；
  //   完工仍照旧 = 书已兑现成产物、不退（那才是"只能制造一次"的落点）。
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
    // 记下"这一线确实扣了一本一次性书" ⇒ 取消时据此只退这一本（显式记账，不靠事后推断）
    ...(cap.consumeBook ? { bookSpent: true } : {}),
    // 记下这一线**实际扣掉的材料**（2026-09-24 船长令：自动停机材料一起退；见字段头注）
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
