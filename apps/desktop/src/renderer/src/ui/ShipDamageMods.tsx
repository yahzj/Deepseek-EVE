import { cleanShipDamage, SHIP_DAMAGE_DEFS, SHIP_DAMAGE_PENALTY, type ShipDamageKind } from '@whale/core'
import { tr } from '../i18n/locale'
import { Glyph } from './Glyphs'
import { hoverTipProps } from './Tooltip'
import { infoCardContent } from './shipInfo'

/** 同一份详情用于舰船、装配与沉船记录；展开可供触屏读取。 */
export function ShipDamageMods({ ids }: { ids?: readonly ShipDamageKind[] }) {
  const damage = cleanShipDamage(ids)
  if (!damage) return null
  const pct = `${Math.round(SHIP_DAMAGE_PENALTY * 100)}%`
  return <div className="app-ship-damage" data-ship-damage>
    <div className="app-bay-title">{tr('ui.shipDamage.013')}</div>
    {damage.map(id => {
      const def = SHIP_DAMAGE_DEFS.find(row => row.id === id)!
      const content = infoCardContent(tr(def.nameId), [], tr(def.descriptionId, { pct }), tr('ui.shipDamage.014'))
      return <details key={id} className="app-ship-damage-detail">
        <summary className="app-btn is-small is-warn" data-damage-kind={id} {...hoverTipProps(content)}>
          <Glyph name="ico-hint" size={16} />{tr(def.nameId)}
        </summary>
        {content}
      </details>
    })}
  </div>
}
