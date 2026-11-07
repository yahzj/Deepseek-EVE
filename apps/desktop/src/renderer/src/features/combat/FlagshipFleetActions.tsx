import { useState } from 'react'
import { combatRosterOf, commandBudgetOf, shipDisplayName } from '@whale/core'
import type { CommandResult } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { cmdText, tr } from '../../i18n/locale'
import './flagshipFleet.css'

/** 三个旗舰入口共用当前编队和预设切换，不另存旗舰专属选舰状态。 */
export function FlagshipFleetActions({ engine, onStarted }: { engine: GameEngine; onStarted?: () => void }) {
  const [presetId, setPresetId] = useState('')
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const presets = engine.state.fleetPresets ?? []
  const selected = presets.some(p => p.id === presetId) ? presetId : ''
  const roster = combatRosterOf(engine.state)
  const budget = commandBudgetOf(engine.state, engine.ctx, roster, true)
  const names = roster.map(id => shipDisplayName(engine.state, engine.ctx, id)).join(' / ')
  function report(result: CommandResult): void {
    setFailed(!result.ok)
    setMessage(result.ok ? tr('ui.fleetPreset.013') : cmdText(result))
  }
  return <div className="app-flagship-fleet" onClick={e => e.stopPropagation()}>
    <span className="app-dim" title={names}>{tr('ui.flagshipFleet.001', { p1: roster.length, p2: budget.cost, p3: budget.capacity })}</span>
    <div className="app-flagship-fleet-tools">
      <select className="app-select" aria-label={tr('ui.fleetPreset.001')} value={selected} onChange={e => { setPresetId(e.target.value); setMessage('') }}>
        <option value="">{tr('ui.flagshipFleet.002')}</option>
        {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="app-btn is-small" disabled={!selected} onClick={() => report(engine.fleetPresetApply(selected))}>{tr('ui.flagshipFleet.003')}</button>
      <button className="app-btn is-small is-primary" disabled={!budget.ok} title={budget.ok ? names : cmdText(budget)} onClick={() => {
        const result = engine.challengeWeekendFlagship()
        if (result.ok) { setMessage(''); onStarted?.() }
        else report(result)
      }}>{tr('ui.weekend.074')}</button>
    </div>
    {message ? <div className={failed ? 'app-warn app-battle-ammo-warning' : 'app-dim'} role={failed ? 'alert' : 'status'}>{message}</div> : null}
  </div>
}
