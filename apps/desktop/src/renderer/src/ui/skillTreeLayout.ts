/**
 * **技能树的排布算法**（纯函数 · 无 React 依赖 ⇒ 可以被工具/读数直接跑）。
 *
 * 为什么单独成文件：树的形状是本页最容易出错的地方（重叠 / 越界 / 连线交叉），抽出来才能**离线读坐标**
 * 核对，而不是靠肉眼看截图。
 *
 * **口径（2026-09-22 船长四条反馈后定稿）**：
 * 1. **层紧凑**：「假设没有 T1 或者 T2，就整体上移」⇒ 行位置按**出现过的 rank 顺序**压紧，行标写真实 rank；
 * 2. **前置优先左上角**：每条线占一**列**——根落在左上，**第一个子技能承父列、正落在它下方**，其余兄弟开新列；
 *    几棵小树并排 ⇒ **不全部往左靠齐**；
 * 3. **没有连线的孤立技能**：排在所有树列之后、按自己的 rank 逐行从左往右填（不画任何线）；
 * 4. 同 rank 的父与子画**层内横线**；跨书的前置**不画线**（2026-09-22 船长选「甲」）。
 */
import type { SkillDef } from '@whale/core'

/* ───────── 六边形几何（逻辑单位；一格 = 一个技能） ───────── */
export const HEX_W = 96
export const HEX_H = 84
export const GAP_X = 20
export const GAP_Y = 18
export const TAG_W = 26
export const PAD = 10
/** 孤立点与"树列"之间多留一点空（视觉上分组，但仍不画线） */
export const ISO_GAP = 14

/** 平顶六边形（左右出尖、上下平边）——参考图的形状，横向宽正好放两行名字 */
export function hexPath(cx: number, cy: number): string {
  const w = HEX_W / 2
  const h = HEX_H / 2
  const q = HEX_W / 4
  return [
    `M ${cx - q} ${cy - h}`,
    `L ${cx + q} ${cy - h}`,
    `L ${cx + w} ${cy}`,
    `L ${cx + q} ${cy + h}`,
    `L ${cx - q} ${cy + h}`,
    `L ${cx - w} ${cy}`,
    'Z',
  ].join(' ')
}

/** 名字按不超过 4 字一行折成最多两行（全名不裁字——船长令「先试试看全名的效果」） */
export function nameLines(name: string): string[] {
  const chars = [...name]
  if (chars.length <= 4) return [name]
  const per = Math.ceil(chars.length / 2)
  return [chars.slice(0, per).join(''), chars.slice(per).join('')]
}

export type BookLayout = {
  branch: string
  /** 本图的宽高（viewBox 用） */
  w: number
  h: number
  /** 压紧后的行标（写真实 rank：`T2`…） */
  tiers: readonly number[]
  nodes: Array<{ def: SkillDef; x: number; y: number }>
  /** 连线（父 → 子） */
  edges: Array<{ x1: number; y1: number; x2: number; y2: number; sameRank: boolean }>
}

/** **坐标覆盖表**（船长在 Excel 里手调后回写的那张表：`技能 id → 节点中心点像素坐标`，本书局部坐标） */
export type SkillTreePositions = Readonly<Record<string, { readonly x: number; readonly y: number }>>

/** 一格 = 116 × 102 像素（`HEX_W+GAP_X` × `HEX_H+GAP_Y`）；列/行反推读数用得到 */
export const CELL_W = HEX_W + GAP_X
export const CELL_H = HEX_H + GAP_Y
/** 第 0 列 / 第 0 行的中心点（由 `PAD/TAG_W/HEX_*` 推出，导出工具与 Excel 说明都引用它） */
export const ORIGIN_X = PAD + TAG_W + HEX_W / 2
export const ORIGIN_Y = PAD + HEX_H / 2

/**
 * @param override **坐标覆盖表**（**2026-09-22 船长令**：「**将其位置转换成坐标。我来手动调整图标位置？**」）——
 *   按技能 id 覆盖算法算出来的中心点；缺省/空表 ⇒ 完全按算法走。**画布宽高按覆盖后的实际坐标现算**，
 *   所以往右下挪也不会被裁掉。
 */
export function layoutBook(
  branch: string,
  defs: readonly SkillDef[],
  override?: SkillTreePositions,
): BookLayout {
  const inBook = new Set(defs.map((d) => d.id))
  const hasParentInBook = (d: SkillDef): boolean => (d.prereq ?? []).some((p) => inBook.has(p))
  const kidsOf = new Map<string, SkillDef[]>()
  for (const d of defs) {
    for (const p of d.prereq ?? []) {
      if (!inBook.has(p)) continue
      const arr = kidsOf.get(p) ?? []
      arr.push(d)
      kidsOf.set(p, arr)
    }
  }

  /**
   * ① 列分配：根（本图内没有父、但有子）按数据顺序从左到右；
   * **深一层的第一个子承父列（正落在它下方）**，其余子开新列；
   * ⚠ **同 rank 的子一律开新列**（它与父在同一行 ⇒ 承父列会重合；这种父子关系画成层内横线，
   *   正如参考图里那种同排连线）。离线探针 `_probe-skilltree-layout` 会钉住"同行不重叠 ＋ 子在前置正下方"。
   */
  const colOf = new Map<string, number>()
  let nextCol = 0
  const visit = (d: SkillDef): void => {
    const kids = kidsOf.get(d.id) ?? []
    const deeper = kids.filter((k) => k.rank > d.rank && !colOf.has(k.id))
    const sameRow = kids.filter((k) => k.rank === d.rank && !colOf.has(k.id))
    let inherited = false
    for (const k of deeper) {
      colOf.set(k.id, inherited ? nextCol++ : (colOf.get(d.id) ?? nextCol++))
      inherited = true
      visit(k)
    }
    for (const k of sameRow) {
      colOf.set(k.id, nextCol++)
      visit(k)
    }
  }
  const roots = defs.filter((d) => !hasParentInBook(d) && (kidsOf.get(d.id)?.length ?? 0) > 0)
  for (const r of roots) {
    if (colOf.has(r.id)) continue
    colOf.set(r.id, nextCol++)
    visit(r)
  }
  /** ② 行：只算出现过的 rank，压紧（没有 T1/T2 就整体上移） */
  const ranks = [...new Set(defs.map((d) => d.rank))].sort((a, b) => a - b)
  const rowY = new Map<number, number>()
  ranks.forEach((r, i) => rowY.set(r, PAD + i * (HEX_H + GAP_Y) + HEX_H / 2))
  /** ③ 孤立技能（本图内既没有父也没有子）：排在树列之后，按 rank 逐行从左往右填 */
  const isoBase = nextCol
  const isolated = defs.filter((d) => !hasParentInBook(d) && (kidsOf.get(d.id)?.length ?? 0) === 0)
  for (const r of ranks) {
    let cursor = isoBase
    for (const d of isolated) {
      if (d.rank !== r) continue
      colOf.set(d.id, cursor++)
      nextCol = Math.max(nextCol, cursor)
    }
  }
  /** ④ 坐标（坐标覆盖表优先——船长手调过的那几个按手调的落位） */
  const nodes: BookLayout['nodes'] = defs.map((d) => {
    const ov = override?.[d.id]
    if (ov && Number.isFinite(ov.x) && Number.isFinite(ov.y)) return { def: d, x: ov.x, y: ov.y }
    const col = colOf.get(d.id) ?? 0
    const extra = col >= isoBase && isoBase > 0 ? ISO_GAP : 0
    return {
      def: d,
      x: PAD + TAG_W + col * (HEX_W + GAP_X) + extra + HEX_W / 2,
      y: rowY.get(d.rank) ?? HEX_H / 2 + PAD,
    }
  })
  const at = new Map(nodes.map((n) => [n.def.id, n]))
  const edges: BookLayout['edges'] = []
  for (const n of nodes) {
    for (const pid of n.def.prereq ?? []) {
      const p = at.get(pid)
      if (!p) continue // 前置在本图之外（跨书）⇒ 不画线
      const sameRank = p.def.rank === n.def.rank
      edges.push({
        x1: sameRank ? p.x + HEX_W / 2 : p.x,
        y1: sameRank ? p.y : p.y + HEX_H / 2,
        x2: sameRank ? n.x - HEX_W / 2 : n.x,
        y2: sameRank ? n.y : n.y - HEX_H / 2,
        sameRank,
      })
    }
  }
  const cols = nodes.reduce((m, n) => Math.max(m, colOf.get(n.def.id) ?? 0), 0) + 1
  /** 画布宽高按**覆盖后的真实坐标**现算（手调往右下挪也不会画到框外） */
  const maxRight = nodes.reduce((m, n) => Math.max(m, n.x + HEX_W / 2), 0)
  const maxBottom = nodes.reduce((m, n) => Math.max(m, n.y + HEX_H / 2), 0)
  return {
    branch,
    w: Math.max(PAD * 2 + TAG_W + cols * HEX_W + (cols - 1) * GAP_X + (isoBase > 0 ? ISO_GAP : 0), maxRight + PAD),
    h: Math.max(PAD * 2 + ranks.length * HEX_H + (ranks.length - 1) * GAP_Y, maxBottom + PAD),
    tiers: ranks,
    nodes,
    edges,
  }
}
