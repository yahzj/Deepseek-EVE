import { addLog } from '../state'
import type { CommandResult } from '../engine'
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { countItem, removeItem, removeWare } from '../inventory'
import { shipActuallyDocked } from '../shipActionPolicy'
import { FRAGMENT_RECIPES, fragmentItemIdOf } from '../salvage'
import { industryAvailable } from './refining/params'

export function redeemFragments(state: GameState, ctx: SimContext, moduleId: string): CommandResult {
  const recipe = FRAGMENT_RECIPES[moduleId]
  if (!recipe) return { ok: false, error: `「${moduleId}」没有对应的逆向研究蓝图。` }
  if (state.learnedRecipes.includes(recipe.blueprintId)) {
    return { ok: false, error: '该蓝图已掌握（learnedRecipes 永久生效），无需重复逆向。', errorId: 'core.industry.031' }
  }
  const def = ctx.modules.get(moduleId)
  const bpDef = ctx.blueprints.get(recipe.blueprintId)
  const fragId = fragmentItemIdOf(moduleId)
  const fragDef = ctx.items.get(fragId)
  const have = industryAvailable(state, ctx, fragId)
  if (have < recipe.need) {
    return {
      ok: false,
      error: `碎片不足：${fragDef?.name ?? fragId} 现有 ${have}/${recipe.need} 片（还需 ${recipe.need - have} 片）。`,
    }
  }
  let need = recipe.need
  const fromCargo = shipActuallyDocked(state, ctx) ? Math.min(countItem(state, fragId), need) : 0
  if (fromCargo > 0) {
    removeItem(state, fragId, fromCargo)
    need -= fromCargo
  }
  if (need > 0) removeWare(state, fragId, need)
  state.learnedRecipes.push(recipe.blueprintId)
  addLog(
    state,
    'industry',
    `逆向研究完成：${fragDef?.name ?? fragId} ×${recipe.need} → 已解锁「${bpDef?.name ?? recipe.blueprintId}」蓝图（${def?.name ?? moduleId} 可自制备；无需市场购图）。`,
    'core.industry.042',
    {
      p1: fragDef?.name ?? fragId,
      p2: recipe.need,
      p3: bpDef?.name ?? recipe.blueprintId,
      p4: def?.name ?? moduleId,
    },
  )
  return { ok: true }
}

export interface FragmentRedeemRow {
  moduleId: string
  fragmentItemId: string
  fragmentName: string
  moduleName: string
  blueprintId: string
  blueprintName: string
  have: number
  need: number
  learned: boolean
  ready: boolean
}

export function fragmentRedeemRowsOf(state: GameState, ctx: SimContext): FragmentRedeemRow[] {
  const rows: FragmentRedeemRow[] = []
  for (const [moduleId, recipe] of Object.entries(FRAGMENT_RECIPES)) {
    const fragmentItemId = fragmentItemIdOf(moduleId)
    const have = industryAvailable(state, ctx, fragmentItemId)
    const learned = state.learnedRecipes.includes(recipe.blueprintId)
    rows.push({
      moduleId,
      fragmentItemId,
      fragmentName: ctx.items.get(fragmentItemId)?.name ?? fragmentItemId,
      moduleName: ctx.modules.get(moduleId)?.name ?? moduleId,
      blueprintId: recipe.blueprintId,
      blueprintName: ctx.blueprints.get(recipe.blueprintId)?.name ?? recipe.blueprintId,
      have,
      need: recipe.need,
      learned,
      ready: !learned && have >= recipe.need,
    })
  }
  return rows
}
