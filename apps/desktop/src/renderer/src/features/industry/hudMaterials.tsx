import { countWare, matNeedCount, materialDisplayIdOf, materialGroupIdsOf, type MaterialNeed } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { itemGlyphName } from '../../ui/Glyphs'
import { marketPriceOf } from '../../ui/yieldView'

export function readinessOf(engine: GameEngine, materials: readonly MaterialNeed[], blueprintId?: string): { pct: number; short: string[] } {
  const rows = matRowsOf(engine, materials, blueprintId)
  if (rows.length === 0) return { pct: 1, short: [] }
  let sum = 0
  const short: string[] = []
  for (const r of rows) {
    sum += Math.min(1, r.need > 0 ? r.have / r.need : 1)
    if (!r.ok) short.push(r.name)
  }
  return { pct: sum / rows.length, short }
}

export function matRowsOf(
  engine: GameEngine,
  materials: readonly MaterialNeed[],
  blueprintId?: string,
): Array<{ id: string; name: string; glyph: string; need: number; have: number; ok: boolean }> {
  return materials.map((m) => {
    const need = matNeedCount(engine.state, m.count, blueprintId)
    const have = materialGroupIdsOf(m.itemId).reduce((s, id) => s + countWare(engine.state, id), 0)
    const def = engine.ctx.items.get(materialDisplayIdOf(engine.state, m.itemId))
    return {
      id: m.itemId,
      name: def?.name ?? m.itemId,
      glyph: itemGlyphName(def?.id, def?.kind ?? 'item'),
      need,
      have,
      ok: have >= need,
    }
  })
}

export function matsValueOf(engine: GameEngine, materials: readonly MaterialNeed[], blueprintId?: string): number {
  let v = 0
  for (const m of materials) {
    const price = marketPriceOf(engine.state, engine.ctx, m.itemId) ?? engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0
    v += matNeedCount(engine.state, m.count, blueprintId) * price
  }
  return v
}
