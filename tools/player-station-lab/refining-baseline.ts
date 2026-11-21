import { buildSimContext } from '../../packages/data/src/context'
import { createInitialState } from '../../packages/core/src/state'
import { startRefineRun } from '../../packages/core/src/industry/refining/start'
import { refineBatchOutputOf } from '../../packages/core/src/industry/refining/params'

// 仅合成宿主取数，模块自身不引用GameState、SimContext或第二套精炼公式。
const context = buildSimContext()
const cache = new Map<string, { batchUnits: number; cycleMs: number }>()
const profiles = new Map<number, ReturnType<typeof createInitialState>>()
export const REFINING_ITEMS = [...context.items.values()].filter(item =>
  ['ore', 'gas', 'ice'].includes(item.kind) && !!item.refine?.length)

function baseline(level: number) {
  const cached = profiles.get(level)
  if (cached) return cached
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  for (const skill of context.skills.values()) state.skills.trained[skill.id] = level
  profiles.set(level, state)
  return state
}
export function refiningRecipe(itemId: string, level: number) {
  if (!REFINING_ITEMS.some(item => item.id === itemId)) return undefined
  const key = `${level}:${itemId}`
  let recipe = cache.get(key)
  if (!recipe) {
    const state = structuredClone(baseline(level))
    state.warehouse.items[itemId] = 1_000_000_000
    const result = startRefineRun(state, itemId, 'pilot', context)
    if (!result.ok) throw new Error(result.error)
    const run = state.refineRuns.find(entry => entry.active && entry.recipe === 'refine')!
    recipe = { batchUnits: run.batchUnits, cycleMs: run.cycleMs }
    cache.set(key, recipe)
  }
  return { ...recipe }
}
export function refiningOutput(itemId: string, batchUnits: number, level: number): Record<string, number> {
  const item = context.items.get(itemId)
  if (!item?.refine?.length) return {}
  return Object.fromEntries(refineBatchOutputOf(baseline(level), context, item, batchUnits).map(row => [row.mineralId, row.units]))
}
export function refiningItemName(itemId: string): string { return context.items.get(itemId)?.name ?? itemId }
export const REFINING_ITEM_IDS = [...new Set(REFINING_ITEMS.flatMap(item => [item.id, ...item.refine!.map(row => row.mineralId)]))]
