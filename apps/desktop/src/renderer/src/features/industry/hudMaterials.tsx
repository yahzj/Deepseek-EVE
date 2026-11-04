import { countWare, matNeedCount, materialDisplayIdOf, materialGroupIdsOf, type MaterialNeed } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { itemGlyphName } from '../../ui/Glyphs'
import { marketPriceOf } from '../../ui/yieldView'

/**
 * **材料齐备度**（0~1）——**与"能不能开工"同一把尺**（`matNeedCount` 折扣后需求 ·
 * 等价组按组内合计，口径同 core `missingMaterials`）。
 *
 * 取**逐项达标率的平均**（不是 Σ 现有 ÷ Σ 需求）：不同料的件数量级差很大，求和会让大件吃掉整个读数。
 * 技能口径（chart 域 Bullet）：「每个区间与目标都要有文字标注，颜色只是补充」⇒ 调用处必须把
 * 百分比与"缺哪几项"用文字给出（`title` 与可见读数同源）。
 */
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

/**
 * **材料清单行**（组装机 / 造船厂 / 实验室的输入都是"多料"）——取数口径与 `readinessOf` 同一份，
 * 悬浮卡的**左列**直接用它的输出（**2026-09-30 船长令**：「因为还需要应用到组装机和造船厂，
 * 所以请对左侧输入进行一定优化」⇒ 左列做成清单形态，而不是写死"一味料"）。
 */
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

/** 一批料的**料值**（按当前行情价估；取不到行情退回物品基准价——与卡面行情同一把尺） */
export function matsValueOf(engine: GameEngine, materials: readonly MaterialNeed[], blueprintId?: string): number {
  let v = 0
  for (const m of materials) {
    const price = marketPriceOf(engine.state, engine.ctx, m.itemId) ?? engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0
    v += matNeedCount(engine.state, m.count, blueprintId) * price
  }
  return v
}
