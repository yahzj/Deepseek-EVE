/** 停靠规则验收合成档；make-test-save.ts station-action生成，不读取个人档。
 * v0.1.0 / 存档v31，2026-10-13；真实采矿主控、空闲带伤副船与仓库研究材料。
 */
import assert from 'node:assert/strict'
import { addShipToFleet, fitModule, loadSaveFile, startMining, FRAGMENT_RECIPES, fragmentItemIdOf } from '@whale/core'
import type { GameState } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { blackMarketTestSave } from './black-market-test-fixture'

export function injectStationActionFixture(state: GameState): string[] {
  const ctx = buildSimContext()
  Object.assign(state, loadSaveFile(blackMarketTestSave()).state)
  state.onboarding.step = 99
  state.shipId = addShipToFleet(state, 'sh-megalodon')
  const current = state.fleet[state.shipId]!
  current.customName = '在外作业'
  state.moduleBay['mod-miner-1'] = 3
  state.moduleBay['mod-turret-kin-1'] = 3
  assert(fitModule(state, 'mod-miner-1', ctx).ok)
  const idle = addShipToFleet(state, 'sh-mako')
  state.fleet[idle]!.customName = '港内副船'
  state.fleet[idle]!.durability = .5
  state.fleet[idle]!.armorPct = .5
  state.fleet[idle]!.cargo = { 'ammo-kinetic-l': 60 }
  state.warehouse.items['ammo-kinetic-l'] = 1000
  state.warehouse.items['drone-scout'] = 20
  const belt = [...ctx.belts.values()].find(row => row.galaxyId === 'galaxy-hub' && ctx.items.get(row.oreId)?.kind === 'ore')!
  assert(belt, '缺少母港矿带')
  assert(startMining(state, belt.id, ctx).ok)
  current.cargo = { 'ammo-kinetic-l': 20 }
  for (const [moduleId, recipe] of Object.entries(FRAGMENT_RECIPES)) {
    state.warehouse.items[fragmentItemIdOf(moduleId)] = recipe.need
    state.learnedRecipes = state.learnedRecipes.filter(id => id !== recipe.blueprintId)
  }
  return ['主控“在外作业”正在采矿，普通装卸/站内维修不可操作；远程黑市和仓库研究仍可用。',
    '副船“港内副船”货仓60发弹药、半耐久半装甲；主控不在港时仍可整仓卸货和付费维修。',
    '工业页可安排手动炉，真实返航后自动开工；活动栏可取消待办，返航本身仍继续。']
}
