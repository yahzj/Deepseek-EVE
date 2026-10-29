

/* ═══════════════ 组装机卡片排序（纯函数 · 口径单点） ═══════════════
 * 为什么放在 core：**渲染层没有测试运行器**（与 `battleVerdictOf` 同一条理由），
 * 而排序口径一旦漂移只会表现为"看着乱"，不会报错 ⇒ 抽成纯函数由 `tests/manu-order.test.ts` 钉住。
 * 2026-09-08 船长定：按「类型（装备→舰船→消耗品）→ 蓝图价格（升序）」排序；无市场价沉底。
 * 2026-09-14 船长改定：「**一次性图纸应该和原图纸放在一起**」（注：船长原话；上一条"按价值排序"
 *   由船长本人当场作废）⇒ 在 09-08 口径上加一条**成组规则**：
 *   同产物（`productKey` 相同）的图纸**相邻**，**原图纸（非一次性）在前、一次性图纸紧随**；
 *   **组位次仍按原图纸的书价**（升序、无市场价沉底、同价按原图纸名）
 *   ⇒ **非一次性卡的相对位次与 09-08 口径逐格一致**，只有一次性卡被上提到各自原图纸正后方。
 * 组内兜底：先按产物键（不同产物绝不交错），再按自身书价、名称。 */

/** 组装机一级分类序（2026-09-08 船长定；2026-09-11 档名随「消耗品蓝图」改） */
export const MANU_KIND_ORDER: Record<string, number> = { 装备: 0, 舰船: 1, 消耗品: 2 }

/** 组装机卡片排序所需的最小行（渲染层与用例共用；只认排序要用的字段） */
export interface ManuOrderRow {
  /** 一级分类名（'装备' / '舰船' / '消耗品'；表外的一律排最后） */
  kindLabel: string
  /** 图纸名（同一产物两张图时是「X 图纸」与「X 图纸（一次性）」） */
  name: string
  /** 蓝图书市场价（市场目录 basePrice；0 = 无市场价 ⇒ 沉底） */
  bookPrice: number
  /** 产物唯一键：`ship:<id>` / `module:<id>` / `item:<id>`（同键 = 同一产物的图纸） */
  productKey: string
  /** 本卡是否为一次性图纸（`singleUse`） */
  singleUse: boolean
  /** 零件档位（2026-09-20 零件体系：基础零件默认排序在前、高级在后；非零件缺省 undefined 不参与） */
  partTier?: 'basic' | 'advanced'
}

/** 无市场价的书一律沉底（`Number.MAX_SAFE_INTEGER` 不是价格，只表示"排最后"） */
function manuPriceRank(v: number): number {
  return v > 0 ? v : Number.MAX_SAFE_INTEGER
}

/** 零件档位排序权重（2026-09-20 船长「默认低级零件排序在前」；非零件 = 0 不参与） */
function partRank(it: { partTier?: 'basic' | 'advanced' }): number {
  return it.partTier === 'advanced' ? 1 : 0
}

/** 组装机卡片排序（见本段顶部口径；不改入参，返回新数组）
 *
 * ⚠ **2026-10-01 修返回类型**：原来是 `ManuOrderRow[]`（**把泛型 T 丢了**）——调用方拿了排序结果
 * 再放进自己的行类型数组时会被判成"类型不兼容"（工业 HUD 页的书架行加了一个 `keys` 字段就露出来了）。
 * 语义上它本来就返回"同一批行、只换了顺序" ⇒ 正确签名是 `T[]`。 */
export function sortManuRows<T extends ManuOrderRow>(rows: readonly T[]): T[] {
  // 组锚 = 同产物里那张**非一次性**图纸（=「原图纸」）；没有原图纸（洞内定制船/装备的一次性图纸）
  // 就锚自己 ⇒ 这类卡的位置与 09-08 口径完全一致。
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
      partRank(a) - partRank(b) || // 2026-09-20 零件体系：同门类内基础零件排在前
      manuPriceRank(aa.bookPrice) - manuPriceRank(ab.bookPrice) ||
      aa.name.localeCompare(ab.name, 'zh-Hans-CN') ||
      a.productKey.localeCompare(b.productKey) || // 组键兜底：不同产物绝不交错
      Number(a.singleUse) - Number(b.singleUse) || // 组内：原图纸在前
      manuPriceRank(a.bookPrice) - manuPriceRank(b.bookPrice) ||
      a.name.localeCompare(b.name, 'zh-Hans-CN')
    )
  })
}
