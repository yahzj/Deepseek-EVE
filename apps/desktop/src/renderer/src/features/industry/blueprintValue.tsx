import { marketGoodOf } from '@whale/core'
import type { GameEngine } from '../../game/engine'

/** 在市场目录里找某蓝图的市场商品（key）；找不到返回 null */
export function bpGoodKey(engine: GameEngine, blueprintId: string): string | null {
  return marketGoodOf(engine.ctx, 'blueprint', blueprintId)?.key ?? null
}

/** 产物现货基准价（产物在市场目录的 basePrice；弹药等按单次产出数量折算） */
export function productBaseOf(engine: GameEngine, kind: 'module' | 'ship' | 'item', refId: string, units = 1): number {
  for (const good of engine.ctx.marketGoods.values()) {
    if (good.kind === kind && good.refId === refId) return (good.basePrice ?? 0) * units
  }
  return 0
}

/** 蓝图书市场价（组装机排序用：市场目录 basePrice；缺省 = 蓝图字段；再无 = 沉底） */
export function bookPriceOf(engine: GameEngine, blueprintId: string, fallback: number): number {
  const k = bpGoodKey(engine, blueprintId)
  if (k) {
    for (const g of engine.ctx.marketGoods.values()) {
      if (g.key === k) return g.basePrice ?? fallback
    }
  }
  return fallback
}
