import type { MarketGoodDef } from '@whale/core'
import { ceilFinalQuantity, encryptedBlueprintPool, encryptedFamilyOf, ENCRYPTED_BLUEPRINT_COUNT } from '@whale/core'
import { BLUEPRINTS } from '../blueprints'
import { SHIP_BLUEPRINTS } from '../shipBlueprints'
import { ITEMS } from '../items'
import { SHIP_PLUGS, isFactionPlugId } from '../plugs'

/** 玩家独占产物参考基价；不新增NPC供应或收购。 */
export const PLAYER_ONLY_GOODS: readonly MarketGoodDef[] = (() => {
  const plugs = SHIP_PLUGS.filter(mod => !mod.unreleased)
  const plugIds = new Set(plugs.map(mod => mod.id))
  const items = new Map(ITEMS.map(item => [item.id, item]))
  const blueprints = new Map([...BLUEPRINTS, ...SHIP_BLUEPRINTS].map(bp => [bp.id, bp]))
  const priced = (value: number | undefined, id: string): number => {
    if (value === undefined || !Number.isFinite(value) || value <= 0) throw new Error(`市场估值缺少有效价格：${id}`)
    return value
  }
  const rows = [
    ...plugs.map(mod => {
      const bp = BLUEPRINTS.find(bp => bp.moduleId === mod.id && !bp.singleUse && !bp.unreleased)
      if (!bp) throw new Error(`插件缺少制造配方：${mod.id}`)
      const materialValue = bp.materials.reduce((sum, mat) => sum + mat.count * priced(items.get(mat.itemId)?.baseSellPriceIsk, mat.itemId), 0)
      return { id: mod.id, kind: 'module' as const, basePrice: ceilFinalQuantity(materialValue * 10 / (bp.outputUnits ?? 1)) }
    }),
    ...BLUEPRINTS.filter(bp => plugIds.has(bp.moduleId ?? '') && isFactionPlugId(bp.moduleId ?? '') && !bp.unreleased)
      .map(bp => ({ id: bp.id, kind: 'blueprint' as const, basePrice: priced(bp.priceIsk, bp.id) })),
    ...ITEMS.filter(item => item.id.startsWith('box-encrypted-') && !item.unreleased)
      .map(item => {
        const family = encryptedFamilyOf(item.id)
        if (!family) throw new Error(`加密柜缺少图纸分组：${item.id}`)
        const groups = encryptedBlueprintPool(family)
        const meanDrawValue = groups.reduce((sum, group) => sum + group.reduce((total, id) => total + priced(blueprints.get(id)?.priceIsk, id), 0) / group.length, 0) / groups.length
        const meanCount = (ENCRYPTED_BLUEPRINT_COUNT.min + ENCRYPTED_BLUEPRINT_COUNT.max) / 2
        return { id: item.id, kind: 'item' as const, basePrice: ceilFinalQuantity(meanDrawValue * meanCount * 0.3) }
      }),
  ]
  return [...new Map(rows.map(({ id, kind, basePrice }) => [id, {
    key: id, refId: id, kind, rarity: 'exotic' as const, basePrice, demandMultiplier: 0,
    playerBuyable: false, playerSellable: false, blackMarketBuyable: false,
  }])).values()]
})()
