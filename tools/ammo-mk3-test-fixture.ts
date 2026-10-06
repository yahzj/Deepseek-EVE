/** MK3全新测试状态，供注册造档入口与界面工具使用，不读个人档。 */
import { addShipToFleet, ensureBlackMarket, fitModule, loadSaveFile, type GameState } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { blackMarketTestSave } from './black-market-test-fixture'

export function injectAmmoMk3TestState(state: GameState): string[] {
  const ctx = buildSimContext()
  const now = state.savedAtWallMs
  const fresh = loadSaveFile(blackMarketTestSave(now)).state
  fresh.character.name = 'MK3弹药验收'
  fresh.shipId = addShipToFleet(fresh, 'sh-hammerhead')
  for (const id of ['mod-turret-kin-1', 'mod-missile-1', 'mod-laser-1']) {
    fresh.moduleBay[id] = 1
    if (!fitModule(fresh, id, ctx).ok) throw new Error(`测试武器无法装配:${id}`)
  }
  const books = ['bp-ammo-kinetic-3', 'bp-ammo-explosive-3', 'bp-ammo-plasma-3']
  const narrow = { ...ctx, marketGoods: new Map(books.map(id => [id, ctx.marketGoods.get(id)!])) }
  const boardState = structuredClone(fresh)
  delete boardState.blackMarket
  if (!ensureBlackMarket(boardState, narrow, now)) throw new Error('MK3测试货架无法生成')
  fresh.blackMarket!.offers = [...boardState.blackMarket!.offers, ...fresh.blackMarket!.offers.filter(row => !books.includes(row.goodKey))].slice(0, 9)
  for (const type of ['kinetic', 'explosive', 'plasma']) {
    for (const tier of ['l', '2', '3']) fresh.warehouse.items[`ammo-${type}-${tier}`] = 1200
  }
  for (const id of books) for (const material of ctx.blueprints.get(id)!.materials) {
    fresh.warehouse.items[material.itemId] = (fresh.warehouse.items[material.itemId] ?? 0) + material.count * 10
  }
  Object.assign(state, fresh)
  return ['全新合成档，累计声望100、资金充足，停靠母港；三张图纸已在黑市，未购买或学习。',
    '主控锤头鲨装三系基础武器，三档弹药各1200发；MK3按十批准备材料，无虚空晶。',
    '路径：市场→黑市购图→工业蓝图书架学习→组装机消耗品开工→装配选MK3→出战。']
}
