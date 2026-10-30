import { addLog, refundMaterialsToWarehouse } from '../../state'
import type { CommandResult } from '../../engine'
import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { addWare } from '../../inventory'
import { releaseAiCore } from '../../ai'
import { findBuildable, productNameOf, refundOneTimeBook } from './blueprints'
import { matNeedCount } from './materials'

/**
 * 玩家指令：取消指定的制造线（v21 按线号定位；T1 活动窗口统一停止）。
 * 材料按蓝图清单全额退回物品仓库（2026-09-08 起开工不收取制造费，无退费一说）；
 * 产物不产生；AI 核心驱动的线取消时核心归还核心库（旧作业无线可退）。
 *
 * **一次性图纸一并退还**（2026-09-20 船长：「一次性蓝图的制造取消后返还玩家蓝图」）：
 * 只要这一线开工时**确实扣了书**（`mf.bookSpent`，未完工就能取消、不分进度），
 * 就把书与"名额"一起还回去 ⇒ 玩家可以换张卡/换条线重来，不必因为点错一次就损失一张稀缺图纸。
 * **完工不适用**：跑完的线已不在在跑列表里，书已兑现成产物（那才是"只能制造一次"的落点）。
 */
export function cancelManufacturing(state: GameState, ctx: SimContext, runId: number): CommandResult {
  const idx = state.manufacturingRuns.findIndex((r) => r.id === runId)
  if (idx < 0) {
    return { ok: false, error: '没有找到该制造线（已完成或已取消）。', errorId: 'core.manufacturing.006' }
  }
  const [mf] = state.manufacturingRuns.splice(idx, 1)
  const buildable = mf.blueprintId ? findBuildable(ctx, mf.blueprintId) : null
  const productName = buildable ? productNameOf(ctx, buildable, mf.blueprintId ?? '') : (mf.blueprintId ?? '')
  if (mf.worker !== undefined && mf.worker !== 'pilot') releaseAiCore(state, mf.worker)
  /**
   * **退书**（2026-09-20 船长）——只认 `mf.bookSpent`（本线确实扣过书），不靠事后推断：
   * 推断（`isSingleUseBlueprint` ＋ 查标记表）在"同名书存量 > 1、且其中一次已完工"时会多退。
   */
  const bookBack = mf.bookSpent === true && mf.blueprintId !== null && refundOneTimeBook(state, mf.blueprintId)
  if (buildable) {
    /**
     * 退回 = 开工时实际扣除的数量：**优先用本线的账**（`spentMaterials`，扣多少退多少、
     * 不受中途升技能影响，2026-09-24 加）；老档在跑的线没有这本账 ⇒ 按蓝图 + 当前技能现算兜底
     * （与改动前逐值一致）。
     */
    if (mf.spentMaterials) {
      refundMaterialsToWarehouse(state, mf.spentMaterials)
    } else {
      for (const need of buildable.spec.materials) {
        addWare(state, need.itemId, matNeedCount(state, need.count, mf.blueprintId ?? undefined))
      }
    }
    addLog(
      state,
      'industry',
      `已取消制造「${productName}」：材料全额退回物品仓库（按材料学折扣后的实际用量${mf.worker !== undefined && mf.worker !== 'pilot' ? '；AI 核心已归还核心库' : ''}）` +
        (bookBack ? '；一次性图纸已退回蓝图书架（名额同时恢复，可再次开工）。' : '。'),
    )
  } else {
    addLog(
      state,
      'warn',
      '制造作业已取消（引用的蓝图记录缺失，无材料可退）。',
      'core.manufacturing.011',
    )
  }
  return { ok: true }
}
