import { buildSimContext } from '../../packages/data/src/context'
import { createInitialState } from '../../packages/core/src/state'
import { startManufacturing } from '../../packages/core/src/industry/manufacturing/start'
import { advanceManufacturing } from '../../packages/core/src/industry/manufacturing/advance'
import type { StationManufacturingRecipe } from '../../packages/core/src/playerStation/manufacturing'

// 合成主控只用于取数，既有开工/扣料/交付单点和正式业务均不修改。
const context = buildSimContext()
const blueprints = [...context.blueprints.values()].filter(bp => bp.learnless === true && bp.partTier === 'basic'
  && bp.itemId !== undefined && context.items.get(bp.itemId)?.kind === 'part')
export const MANUFACTURING_RECIPES: readonly { blueprintId: string; itemId: string; name: string }[] = Object.freeze(blueprints.map(bp =>
  Object.freeze({ blueprintId: bp.id, itemId: bp.itemId!, name: context.items.get(bp.itemId!)!.name })))
export const MANUFACTURING_ITEM_IDS: readonly string[] = Object.freeze([...new Set(blueprints.flatMap(bp =>
  [bp.itemId!, ...bp.materials.map(row => row.itemId)]))])
const cache = new Map<string, StationManufacturingRecipe>()
const profiles = new Map<number, ReturnType<typeof createInitialState>>()

function profile(level: number) {
  let state = profiles.get(level)
  if (!state) {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    for (const skill of context.skills.values()) state.skills.trained[skill.id] = level
    profiles.set(level, state)
  }
  return state
}
/** 输入真实蓝图 id 与统一合成技能等级，返回可独立修改的单批配方。 */
export function manufacturingRecipe(blueprintId: string, level = 0): StationManufacturingRecipe | undefined {
  const bp = blueprints.find(entry => entry.id === blueprintId)
  if (!bp) return undefined
  if (!Number.isInteger(level) || level < 0 || level > 5) throw new Error('Invalid manufacturing baseline level')
  const key = `${level}:${blueprintId}`
  let recipe = cache.get(key)
  if (!recipe) {
    const state = structuredClone(profile(level))
    for (const row of bp.materials) state.warehouse.items[row.itemId] = 1_000_000_000
    const result = startManufacturing(state, blueprintId, 'pilot', context)
    if (!result.ok) throw new Error(result.error)
    const run = state.manufacturingRuns.find(entry => entry.active && entry.blueprintId === blueprintId)
    if (!run?.spentMaterials?.length) throw new Error('Missing manufacturing baseline run')
    const input: Record<string, number> = {}
    for (const row of run.spentMaterials) input[row.itemId] = (input[row.itemId] ?? 0) + row.count
    const before = { ...state.warehouse.items }
    state.gameMs = run.finishAtGameMs
    advanceManufacturing(state, context)
    const output = Object.fromEntries(Object.entries(state.warehouse.items).flatMap(([id, n]) =>
      n > (before[id] ?? 0) ? [[id, n - (before[id] ?? 0)]] : []))
    if (Object.keys(output).length === 0) throw new Error('Missing manufacturing baseline output')
    recipe = { cycleMs: run.durationMs, input, output }
    cache.set(key, recipe)
  }
  return { cycleMs: recipe.cycleMs, input: { ...recipe.input }, output: { ...recipe.output } }
}
export function manufacturingItemName(itemId: string): string { return context.items.get(itemId)?.name ?? itemId }
export function manufacturingBlueprintName(blueprintId: string): string { return context.blueprints.get(blueprintId)?.name ?? blueprintId }
