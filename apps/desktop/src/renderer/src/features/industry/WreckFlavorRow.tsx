import { RARE_BOX_DRONE_UNITS, recycleProfileOf } from '@whale/core'
import type { ItemDef } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import '../../styles-unbox-ledger.css'
import { FlavorTip, recycleFeatureOf } from '../../ui/wreckFlavor'

/** B3.1：残骸回收卡「特色掉落」说明行（2026-09-06 船长：直接告诉玩家具体低出率物；
 *  2026-09-10 船长定"说明精简"：只讲特色（主题件/专属装备具名），其余泛化为系列名；
 *  行内容与星图打捞页星系卡共用 ui/wreckFlavor） */
export function WreckFlavorRow({ def, engine }: { def: ItemDef; engine: GameEngine }) {
  const ctx = engine.ctx
  const profile = recycleProfileOf(ctx, def.id)
  if (!profile) return null
  const feature = recycleFeatureOf(
    {
      lowSec: profile.lowSec,
      threat: profile.threat,
      loot: profile.theme,
      lairGear: profile.lairGear,
    },
    { mods: ctx.modules, items: ctx.items, droneUnits: RARE_BOX_DRONE_UNITS },
  )
  return (
    <FlavorTip
      featureLabel={feature.label}
      named={feature.named}
      generic={feature.generic}
      tone={feature.tone}
    />
  )
}
