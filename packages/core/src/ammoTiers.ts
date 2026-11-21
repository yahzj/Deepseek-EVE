import type { DamageType, ItemDef, SimContext } from './types'

export function ammoTiersOf(ctx: SimContext, type: DamageType): ItemDef[] {
  return ['l', '2', '3'].flatMap(tier => {
    const item = ctx.items.get(`ammo-${type}-${tier}`)
    return item?.kind === 'ammo' && item.damageType === type ? [item] : []
  })
}
