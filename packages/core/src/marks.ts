import type { GameState, MarksState } from './state'
import type { CommandResult } from './engine'
import type { SimContext } from './types'
import { emptyMarks } from './state'

export type MarkKind = 'goods' | 'recipes' | 'blueprints' | 'ships' | 'labRecipes'

export const MARK_KIND_TEXT: Record<MarkKind, string> = {
  goods: '市场商品',
  recipes: '精炼资源',
  blueprints: '蓝图',
  ships: '舰船',
  labRecipes: '实验室配方',
}

export function markedIds(state: GameState, kind: MarkKind): readonly string[] {
  const marks = state.marks as MarksState | undefined
  const list = marks?.[kind]
  return Array.isArray(list) ? list : []
}

export function isMarked(state: GameState, kind: MarkKind, id: string): boolean {
  return markedIds(state, kind).includes(id)
}

export function markTargetExists(state: GameState, ctx: SimContext, kind: MarkKind, id: string): boolean {
  if (kind === 'ships') return id in state.fleet
  if (kind === 'goods') return ctx.marketGoods.has(id)
  if (kind === 'blueprints') {
    return ctx.blueprints.has(id) || ctx.shipBlueprints.has(id)
  }
  if (kind === 'labRecipes') return ctx.labRecipes.has(id)
  const def = ctx.items.get(id)
  if (!def) return false
  return (def.refine !== undefined && def.refine.length > 0) || def.kind === 'wreck'
}

function ensureMarks(state: GameState): MarksState {
  const marks = state.marks as MarksState | undefined
  if (!marks || typeof marks !== 'object') {
    state.marks = emptyMarks()
    return state.marks
  }
  for (const kind of ['goods', 'recipes', 'blueprints', 'ships', 'labRecipes'] as const) {
    if (!Array.isArray(marks[kind])) marks[kind] = []
  }
  return marks
}

export function toggleMark(state: GameState, ctx: SimContext, kind: MarkKind, id: string): CommandResult {
  if (!markTargetExists(state, ctx, kind, id)) {
    return {
      ok: false,
      error: `没有可标记的${MARK_KIND_TEXT[kind]}（${id}）。`,
      errorId: 'core.marks.001',
      errorParams: { p1: MARK_KIND_TEXT[kind], p2: id },
    }
  }
  const marks = ensureMarks(state)
  const list = marks[kind]
  const at = list.indexOf(id)
  if (at >= 0) list.splice(at, 1)
  else list.push(id)
  return { ok: true }
}

export function clearMarks(state: GameState, kind: MarkKind): void {
  const marks = ensureMarks(state)
  marks[kind] = []
}

export function pruneMarks(state: GameState): MarksState {
  const marks = ensureMarks(state)
  const seen = new Set<string>()
  marks.ships = marks.ships.filter((uid) => {
    if (typeof uid !== 'string' || uid.length === 0) return false
    if (!(uid in state.fleet)) return false
    if (seen.has(uid)) return false
    seen.add(uid)
    return true
  })
  for (const kind of ['goods', 'recipes', 'blueprints', 'labRecipes'] as const) {
    const uniq = new Set<string>()
    for (const id of marks[kind]) {
      if (typeof id === 'string' && id.length > 0) uniq.add(id)
    }
    marks[kind] = [...uniq]
  }
  return marks
}
