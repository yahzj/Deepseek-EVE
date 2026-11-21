


export const MANU_KIND_ORDER: Record<string, number> = { 装备: 0, 舰船: 1, 消耗品: 2 }

export interface ManuOrderRow {
  kindLabel: string
  name: string
  bookPrice: number
  productKey: string
  singleUse: boolean
  partTier?: 'basic' | 'advanced'
}

function manuPriceRank(v: number): number {
  return v > 0 ? v : Number.MAX_SAFE_INTEGER
}

function partRank(it: { partTier?: 'basic' | 'advanced' }): number {
  return it.partTier === 'advanced' ? 1 : 0
}

export function sortManuRows<T extends ManuOrderRow>(rows: readonly T[]): T[] {
  const anchorByProduct = new Map<string, T>()
  for (const it of rows) {
    const cur = anchorByProduct.get(it.productKey)
    if (!cur || (cur.singleUse && !it.singleUse)) anchorByProduct.set(it.productKey, it)
  }
  const anchorOf = (it: T): T => anchorByProduct.get(it.productKey) ?? it
  return [...rows].sort((a, b) => {
    const aa = anchorOf(a)
    const ab = anchorOf(b)
    return (
      (MANU_KIND_ORDER[a.kindLabel] ?? 9) - (MANU_KIND_ORDER[b.kindLabel] ?? 9) ||
      partRank(a) - partRank(b) ||
      manuPriceRank(aa.bookPrice) - manuPriceRank(ab.bookPrice) ||
      aa.name.localeCompare(ab.name, 'zh-Hans-CN') ||
      a.productKey.localeCompare(b.productKey) ||
      Number(a.singleUse) - Number(b.singleUse) ||
      manuPriceRank(a.bookPrice) - manuPriceRank(b.bookPrice) ||
      a.name.localeCompare(b.name, 'zh-Hans-CN')
    )
  })
}
