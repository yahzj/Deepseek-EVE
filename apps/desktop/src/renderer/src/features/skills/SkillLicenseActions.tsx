import { DSI_FACTION_ID, skillLicensePriceOf, skillLicenseStandingBlock, standingOf } from '@whale/core'
import type { GameState, SkillDef } from '@whale/core'
import { cmdText, tr } from '../../i18n/locale'

/** 列表与详情共用的许可价格、声望提示和购买动作。 */
export function SkillLicenseActions({ state, def, confirming, onBuy }: {
  state: GameState
  def: SkillDef
  confirming: boolean
  onBuy: (id: string) => void
}) {
  const block = skillLicenseStandingBlock(state, def)
  const price = (skillLicensePriceOf(def) ?? 0).toLocaleString('zh-CN')
  return <>
    {(def.licenseStandingReq ?? 0) > 0 ? <span className={block ? 'app-warn' : 'app-dim'}>
      {tr('ui.Expedition.336', { p1: def.licenseStandingReq!, standing: standingOf(state, DSI_FACTION_ID) })}
    </span> : null}
    <span className="app-dim">{tr('ui.SkillTree.025', { p1: price })}</span>
    <button
      className={`app-btn is-small${confirming ? ' is-primary' : ''}`}
      disabled={block !== null}
      title={block ? cmdText(block) : undefined}
      data-skill-license={def.id}
      onClick={() => onBuy(def.id)}
    >
      {confirming ? tr('ui.SkillTree.026', { p1: price }) : tr('ui.SkillTree.023', { p1: price })}
    </button>
  </>
}
