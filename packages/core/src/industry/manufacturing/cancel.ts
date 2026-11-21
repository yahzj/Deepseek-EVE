import { addLog, refundMaterialsToWarehouse } from '../../state'
import type { CommandResult } from '../../engine'
import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { addWare } from '../../inventory'
import { releaseAiCore } from '../../ai'
import { findBuildable, productNameOf, refundOneTimeBook } from './blueprints'
import { matNeedCount } from './materials'

export function cancelManufacturing(state: GameState, ctx: SimContext, runId: number): CommandResult {
  const idx = state.manufacturingRuns.findIndex((r) => r.id === runId)
  if (idx < 0) {
    return { ok: false, error: '没有找到该制造线（已完成或已取消）。', errorId: 'core.manufacturing.006' }
  }
  const [mf] = state.manufacturingRuns.splice(idx, 1)
  const buildable = mf.blueprintId ? findBuildable(ctx, mf.blueprintId) : null
  const productName = buildable ? productNameOf(ctx, buildable, mf.blueprintId ?? '') : (mf.blueprintId ?? '')
  if (mf.worker !== undefined && mf.worker !== 'pilot') releaseAiCore(state, mf.worker)
  const bookBack = mf.bookSpent === true && mf.blueprintId !== null && refundOneTimeBook(state, mf.blueprintId)
  if (buildable) {
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
