import { cargoCapacityM3Of, fleetDefOf, shipCommandCostOf, shipDisplayName, wormholeShipMass } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { tr } from '../../i18n/locale'
import { ShipSprite } from '../../ui/ShipSprite'
import { shipTierText } from '../../ui/labelsText'

export interface PreparationFleetRow {
  uid: string
  tier: number
  ok: boolean
  on: boolean
  busy: string | null
  armor: number
  dur: number
}

/** 信号空间与实验虫洞的选舰卡共用规格读数，玩法门槛仍由各入口负责。 */
export function PreparationFleetCards({ engine, rows, auto, handoverName, togglePick }: {
  engine: GameEngine
  rows: readonly PreparationFleetRow[]
  auto: boolean
  handoverName?: string
  togglePick: (uid: string) => void
}) {
  return <ul className="app-wh-cards">{rows.map(({ uid, tier, ok, on, busy, armor, dur }) => {
    const def = fleetDefOf(engine.state, engine.ctx, uid)
    const canPick = ok && !busy
    const title = !ok ? busy ?? tr('ui.Wormhole.201') : busy ?? (auto && uid === engine.state.shipId && handoverName
      ? tr('ui.Wormhole.202', { p1: handoverName }) : on ? tr('ui.Wormhole.024') : tr('ui.Wormhole.136'))
    const damage = [armor < 1 ? tr('ui.Wormhole.205', { p1: Math.round(armor * 100) }) : '',
      dur < 1 ? tr('ui.Wormhole.206', { p1: Math.round(dur * 100) }) : ''].filter(Boolean).join(' · ')
    return <li key={uid}><button type="button" data-wh-pick={uid} aria-pressed={on}
      className={`app-wh-card${on ? ' is-picked' : ''}${canPick ? '' : ' is-locked'}`}
      disabled={!canPick && !on} onClick={() => togglePick(uid)} title={title}>
      <span className="app-wh-card-art" aria-hidden><ShipSprite shipId={def?.id ?? uid} size={132} /></span>
      <span className="app-wh-card-name">{shipDisplayName(engine.state, engine.ctx, uid)}</span>
      <span className="app-wh-card-sub">{shipTierText(tier)}{busy ? <span className="app-chip is-dim"> {busy}</span> : null}</span>
      <span className="app-wh-card-sub">{tr('ui.command.003')} {shipCommandCostOf(def)}</span>
      <span className="app-wh-card-sub">{tr('ui.Handbook.159')} {def ? wormholeShipMass(def).toLocaleString('zh-CN') : '?'}
        {tr('ui.Wormhole.280')}{cargoCapacityM3Of(engine.state, engine.ctx, uid).toLocaleString('zh-CN')} m³</span>
      <span className="app-wh-card-tags"><span className={`app-wh-card-tag${on ? ' is-on' : ''}`}>
        {on ? tr('ui.Wormhole.091') : !ok ? tr('ui.Wormhole.203') : busy ? tr('ui.Wormhole.092') : tr('ui.Wormhole.204')}
      </span>{damage ? <span className="app-wh-card-tag is-warn" title={damage}>{tr('ui.Wormhole.093')} {damage}</span> : null}</span>
    </button></li>
  })}</ul>
}
