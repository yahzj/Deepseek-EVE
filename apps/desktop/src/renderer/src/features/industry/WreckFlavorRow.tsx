import { RARE_BOX_DRONE_UNITS, recycleProfileOf } from '@whale/core'
import type { ItemDef } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import '../../styles-unbox-ledger.css'
import { FlavorTip, recycleFeatureOf } from '../../ui/wreckFlavor'

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
