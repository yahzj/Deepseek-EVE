import { addLog } from '../../state'
import type { GameState } from '../../state'
import type { AiCoreType, SimContext } from '../../types'
import { addWare } from '../../inventory'
import { bumpFirst } from '../../firstTasks'
import { addModule } from '../../equipment'
import { shipStoredCount } from '../../fleetBook'
import { aiEfficiency, releaseAiCore } from '../../ai'
import { addAiIncome, addAiMakeDone, addAiShipDone, type SettleStats } from '../../settleStats'
import { DEEP_SPACE_PROBE_BLUEPRINT_ID, probeManufacturingUnlocked } from '../../probeManufacturing'
import { loopRefOf } from './loop'
import { findBuildable, productNameOf } from './blueprints'
import { missingMaterials, spendMaterialsFor } from './materials'
import { calcBuildDurationMs } from './duration'

function marketBasePrice(ctx: SimContext, kind: 'module' | 'ship', refId: string): number {
  for (const g of ctx.marketGoods.values()) {
    if (g.kind === kind && g.refId === refId) return g.basePrice ?? 0
  }
  return 0
}

export function advanceManufacturing(state: GameState, ctx: SimContext, stats?: SettleStats): void {
  for (let i = state.manufacturingRuns.length - 1; i >= 0; i--) {
    const mf = state.manufacturingRuns[i]!
    if (!mf.active || state.gameMs < mf.finishAtGameMs) continue

    const blueprintId = mf.blueprintId
    const worker = mf.worker
    const byCore = worker !== undefined && worker !== 'pilot'
    const loop = loopRefOf(state, blueprintId)
    const auto = loop?.on === true
    let guard = 0
    let stopWhy = ''


    const settlePiece = (buildable: NonNullable<ReturnType<typeof findBuildable>>): boolean => {
      const coreType = byCore ? (worker as AiCoreType) : undefined
      if (buildable.kind === 'module') {
        const moduleDef = buildable.moduleId ? ctx.modules.get(buildable.moduleId) : undefined
        if (!moduleDef) return false
        addModule(state, moduleDef.id)
        addLog(
          state,
          'industry',
          `制造完成：${moduleDef.name} 已放入装备库，可以到装配台安装了。`,
          'core.manufacturing.014',
          { p1: moduleDef.name },
        )
        if (stats && coreType) {
          addAiMakeDone(stats, coreType)
          addAiIncome(stats, coreType, marketBasePrice(ctx, 'module', moduleDef.id))
        }
      } else if (buildable.kind === 'ship') {
        const shipDef = buildable.shipId ? ctx.ships.get(buildable.shipId) : undefined
        if (!shipDef) return false
        state.shipStore = state.shipStore ?? {}
        state.shipStore[shipDef.id] = shipStoredCount(state, shipDef.id) + 1
        if (state.firstShipBuilt !== true) state.firstShipBuilt = true
        bumpFirst(state, 'ships')
        addLog(
          state,
          'industry',
          `造船完成：${shipDef.name} 已入舰船仓库（现有 ${state.shipStore[shipDef.id]} 艘）——到舰船页「舰船仓库」可转入舰队。`,
        )
        if (stats && coreType) {
          addAiMakeDone(stats, coreType)
          addAiShipDone(stats, coreType)
          addAiIncome(stats, coreType, marketBasePrice(ctx, 'ship', shipDef.id))
        }
      } else {
        const itemDef = buildable.itemId ? ctx.items.get(buildable.itemId) : undefined
        if (!itemDef) return false
        const n = Math.max(1, buildable.outputUnits ?? 1)
        addWare(state, itemDef.id, n)
      bumpFirst(state, 'produceUnits', n)
        if (itemDef.kind !== 'part') {
          addLog(state, 'industry', `制造完成：${itemDef.name} ×${n.toLocaleString('zh-CN')} 已放入物品仓库（弹药可出发预载装船）。`)
        }
        if (itemDef.kind !== 'part') {
          addLog(
            state,
            'industry',
            `制造完成：${itemDef.name} ×${n.toLocaleString('zh-CN')} 已放入物品仓库（弹药可出发预载装船）。`,
            'core.manufacturing.015',
            { p1: itemDef.name, p2: n.toLocaleString('zh-CN') },
          )
        }
        if (stats && coreType) {
          addAiMakeDone(stats, coreType)
          addAiIncome(stats, coreType, n * (itemDef.baseSellPriceIsk ?? 0))
        }
      }
      return true
    }

    while (state.gameMs >= mf.finishAtGameMs) {
      if (++guard > 100_000) {
        stopWhy = '连续推进超过保护上限，循环已中断'
        break
      }
      const buildable = blueprintId ? findBuildable(ctx, blueprintId) : null
      if (!buildable) {
        addLog(state, 'industry', '制造作业引用的蓝图记录缺失，产出已丢弃（异常）。', 'core.manufacturing.012')
        stopWhy = '蓝图记录缺失'
        break
      }
      if (loop && loop.on === true) loop.produced = (loop.produced ?? 0) + 1
      if (!settlePiece(buildable)) {
        addLog(state, 'industry', '制造作业引用的产物记录缺失，产出已丢弃（异常）。', 'core.manufacturing.013')
        stopWhy = '产物记录缺失'
        break
      }
      mf.spentMaterials = []
      if (!auto) break
      const goal = loop && loop.goal && loop.goal > 0 ? loop.goal : null
      if (goal !== null && (loop?.produced ?? 0) >= goal) {
        stopWhy = `已达成目标 ${goal} 批`
        break
      }
      if (blueprintId === DEEP_SPACE_PROBE_BLUEPRINT_ID && !probeManufacturingUnlocked(state)) {
        stopWhy = '星系搜索尚未解锁'
        break
      }
      const missing = missingMaterials(state, ctx, buildable.spec, blueprintId ?? undefined)
      if (missing.length > 0) {
        stopWhy = `材料不足（缺 ${missing.join('、')}）`
        break
      }
      let durationMs = calcBuildDurationMs(state, ctx, buildable.spec)
      if (worker !== undefined && worker !== 'pilot') {
        const eff = aiEfficiency(state, ctx, worker)
        durationMs = Math.max(1, Math.round(durationMs / eff))
      }
      const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
      if (autoLv > 0) durationMs = Math.max(1, Math.round(durationMs * Math.max(0, 1 - 0.05 * autoLv)))
      const spent: { itemId: string; count: number }[] = []
      if (!spendMaterialsFor(state, buildable.spec.materials, spent, blueprintId!)) {
        stopWhy = `材料不足（缺 ${missing.join('、')}）`
        break
      }
      mf.spentMaterials = spent
      mf.finishAtGameMs += durationMs
      mf.durationMs = durationMs
    }

    const lineEnds = !auto || stopWhy !== ''
    if (!lineEnds) continue
    state.manufacturingRuns.splice(i, 1)
    if (byCore) releaseAiCore(state, worker)
    if (auto && stopWhy) {
      const rest = blueprintId
        ? state.manufacturingRuns.filter((r) => r.active && r.blueprintId === blueprintId).length
        : 0
      const b = blueprintId ? findBuildable(ctx, blueprintId) : null
      const nm = b ? productNameOf(ctx, b, blueprintId ?? '') : (blueprintId ?? '')
      if (loop && loop.on === true) {
        loop.on = false
        loop.stopWhy = stopWhy
        addLog(
          state,
          'industry',
          `循环制造停止：${nm}（本卡合计 ${loop.produced ?? 0} 批）——${stopWhy}${
            rest > 0 ? `；本卡其余 ${rest} 条线跑完当前件即停` : ''
          }${byCore ? '；AI 核心已归还核心库' : ''}`,
        )
      }
    }
  }
}
