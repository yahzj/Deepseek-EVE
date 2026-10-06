import type { DamageType, ItemDef, SimContext } from './types'

/** 装配与设置命令共用可选档；仅收录已上线同族弹药，缺失目录不造占位条目。 */
export function ammoTiersOf(ctx: SimContext, type: DamageType): ItemDef[] {
  return ['l', '2', '3'].flatMap(tier => {
    const item = ctx.items.get(`ammo-${type}-${tier}`)
    return item?.kind === 'ammo' && item.damageType === type ? [item] : []
  })
}
