import type { SkillDef } from '@whale/core'

export const HEX_W = 96
export const HEX_H = 84
export const GAP_X = 20
export const GAP_Y = 18
export const TAG_W = 26
export const PAD = 10
export const ISO_GAP = 14

export function hexPathAt(cx: number, cy: number, w: number, h: number): string {
  const hw = w / 2
  const hh = h / 2
  const q = w / 4
  return [
    `M ${cx - q} ${cy - hh}`,
    `L ${cx + q} ${cy - hh}`,
    `L ${cx + hw} ${cy}`,
    `L ${cx + q} ${cy + hh}`,
    `L ${cx - q} ${cy + hh}`,
    `L ${cx - hw} ${cy}`,
    'Z',
  ].join(' ')
}

export function hexPath(cx: number, cy: number): string {
  return hexPathAt(cx, cy, HEX_W, HEX_H)
}

export function nameLines(name: string): string[] {
  const chars = [...name]
  if (chars.length <= 4) return [name]
  const per = Math.ceil(chars.length / 2)
  return [chars.slice(0, per).join(''), chars.slice(per).join('')]
}

export type BookLayout = {
  branch: string
  w: number
  h: number
  tiers: readonly number[]
  nodes: Array<{ def: SkillDef; x: number; y: number }>
  edges: Array<{ x1: number; y1: number; x2: number; y2: number; sameRank: boolean }>
}

export type SkillTreePositions = Readonly<Record<string, { readonly x: number; readonly y: number }>>

export const CELL_W = HEX_W + GAP_X
export const CELL_H = HEX_H + GAP_Y
export const ORIGIN_X = PAD + TAG_W + HEX_W / 2
export const ORIGIN_Y = PAD + HEX_H / 2

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
  const ranks = [...new Set(defs.map((d) => d.rank))].sort((a, b) => a - b)
  const rowY = new Map<number, number>()
  ranks.forEach((r, i) => rowY.set(r, PAD + i * (HEX_H + GAP_Y) + HEX_H / 2))
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
      if (!p) continue
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
