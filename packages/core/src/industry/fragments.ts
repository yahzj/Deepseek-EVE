import { addLog } from '../state'
import type { CommandResult } from '../engine'
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { countItem, removeItem, removeWare } from '../inventory'
import { shipActuallyDocked } from '../shipActionPolicy'
import { FRAGMENT_RECIPES, fragmentItemIdOf } from '../salvage'
import { industryAvailable } from './refining/params'

/**
 * **逆向研究（B3 蓝图碎片兑换，2026-09-05 船长定稿）：消耗指定装备的蓝图碎片**
 * （货仓+仓库），把对应蓝图**永久**加入 learnedRecipes（一次掌握，之后可无限自制，
 * 无需再经市场购图）。母港操作。
 *
 * ⚠ **2026-09-19（玩家报障「回收残骸集齐了 25 个蓝图碎片，但是找不到在哪换成蓝图」）**：
 * 本函数与配方表一直都在，**但界面从没接线**——物品页「蓝图碎片」行只有一个禁用的
 * 「不在市场目录」按钮，`逆向` 二字在玩家可见 UI 里 0 处，玩家读完物品说明（"可在母港逆向解锁"）
 * 却找不到任何入口 ⇒ 碎片只能烂在仓库（MK3 三本书按设定只从碎片出，这条路一断就等于 MK3 无法自制）。
 * 修法 = 物品页「蓝图碎片」行内「逆向解锁」按钮（读数走下面的 `fragmentRedeemRowsOf` 单点），
 * 并加 `content:check` 的「碎片兑现入口契约」防再次漏接。
 */
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

/** 一条「逆向解锁」读数（物品页「蓝图碎片」每一行 + 界面按钮状态用） */
export interface FragmentRedeemRow {
  /** 目标装备 id（`mod-turret-kin-2`…）：`redeemFragments` 的入参 */
  moduleId: string
  /** 碎片物品 id（`frag-<装备 id>`） */
  fragmentItemId: string
  /** 碎片中文名（物品目录名，界面直显） */
  fragmentName: string
  /** 目标装备中文名（`「攻坚炮台 MK2」蓝图` 用） */
  moduleName: string
  /** 解锁后得到的蓝图 id */
  blueprintId: string
  /** 蓝图中文名 */
  blueprintName: string
  /** 现有碎片（货仓 + 仓库合计；与 `redeemFragments` 同一口径，不预扣） */
  have: number
  /** 集齐门槛 */
  need: number
  /** 该蓝图是否已掌握（已掌握 ⇒ 不再需要逆向，界面显示"已解锁"） */
  learned: boolean
  /** 是否已具备兑换条件（未掌握 + 片数够 + 在空间站） */
  ready: boolean
}

/**
 * **「逆向解锁」读数单点**（2026-09-19 玩家报障修 · 与 `redeemFragments` 同源）：
 * 逐条逆向配方给出「现有 / 门槛 / 是否已掌握 / 是否可兑」，界面只负责渲染按钮状态
 * （口径不许各自再算一遍 `countItem + countWare`，否则会出现"按钮亮着但一点就报碎片不足"）。
 * 排序 = 配方表现有顺序（`FRAGMENT_RECIPES` 的键序：MK2 三张在前、MK3 三张在后）。
 */
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
