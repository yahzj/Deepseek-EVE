import { useState } from 'react'
import { FLEET_PRESET_MAX, FLEET_PRESET_NAME_MAX, commandBudgetOf, shipDisplayName } from '@whale/core'
import type { CommandResult } from '@whale/core'
import { Check, Copy, Play, Plus, Trash2, Wrench, X } from '../../ui/layoutIcons'
import type { GameEngine } from '../../game/engine'
import { cmdText, tr } from '../../i18n/locale'
import './fleetPresets.css'

export function FleetPresets({ engine, busy, onToast }: { engine: GameEngine; busy: boolean; onToast: (text: string, error?: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; kind: 'replace' | 'delete' } | null>(null)
  const presets = engine.state.fleetPresets ?? []
  function finish(result: CommandResult, textId: string): void {
    onToast(result.ok ? tr(textId) : cmdText(result), !result.ok)
    if (result.ok) { setEditing(null); setName(''); setConfirm(null) }
  }
  return <section className="app-fleet-presets" aria-label={tr('ui.fleetPreset.001')}>
    <div className="app-fleet-presets-toolbar">
      <button className="app-btn is-small" aria-expanded={open} aria-controls="fleet-preset-list" onClick={() => setOpen(!open)}>
        {tr('ui.fleetPreset.001')} {presets.length}/{FLEET_PRESET_MAX}
      </button>
      <input className="app-head-search" aria-label={tr('ui.fleetPreset.002')} placeholder={tr('ui.fleetPreset.002')} value={name} maxLength={FLEET_PRESET_NAME_MAX} onChange={e => setName(e.target.value)} />
      <button className="app-btn is-small app-fleet-preset-icon" disabled={!name.trim() || (!editing && (busy || presets.length >= FLEET_PRESET_MAX))}
        title={tr(editing ? 'ui.fleetPreset.005' : 'ui.fleetPreset.003')} aria-label={tr(editing ? 'ui.fleetPreset.005' : 'ui.fleetPreset.003')}
        onClick={() => { setOpen(true); finish(editing ? engine.fleetPresetRename(editing, name) : engine.fleetPresetSave(name), editing ? 'ui.fleetPreset.014' : 'ui.fleetPreset.012') }}>
        {editing ? <Check size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
      </button>
      {editing ? <button className="app-btn is-small app-fleet-preset-icon" title={tr('ui.fleetPreset.009')} aria-label={tr('ui.fleetPreset.009')} onClick={() => { setEditing(null); setName('') }}><X size={15} aria-hidden /></button> : null}
    </div>
    {open ? <div id="fleet-preset-list" className="app-fleet-presets-list">
      {!presets.length ? <span className="app-dim">{tr('ui.fleetPreset.017')}</span> : null}
      {presets.map(preset => {
        const budget = commandBudgetOf(engine.state, engine.ctx, preset.shipIds)
        const names = preset.shipIds.map(id => engine.state.fleet[id] ? shipDisplayName(engine.state, engine.ctx, id) : id)
        return <div className="app-fleet-preset-row" key={preset.id}>
          <div className="app-fleet-preset-detail">
            <strong>{preset.name}</strong>
            <span className={budget.ok ? 'app-dim' : 'app-warn'}>{tr('ui.fleetPreset.016', { p1: names[0] ?? preset.leaderShipId, p2: budget.cost, p3: budget.capacity, p4: preset.shipIds.length })}</span>
            <span>{names.join(' / ')}</span>
          </div>
          <div className="app-fleet-preset-actions">
            <button className="app-btn is-small app-fleet-preset-icon" disabled={busy} title={tr('ui.fleetPreset.004')} aria-label={tr('ui.fleetPreset.004')} onClick={() => finish(engine.fleetPresetApply(preset.id), 'ui.fleetPreset.013')}><Play size={15} aria-hidden /></button>
            <button className="app-btn is-small app-fleet-preset-icon" title={tr('ui.fleetPreset.005')} aria-label={tr('ui.fleetPreset.005')} onClick={() => { setEditing(preset.id); setName(preset.name); setConfirm(null) }}><Wrench size={15} aria-hidden /></button>
            <button className="app-btn is-small app-fleet-preset-icon" disabled={busy} title={tr('ui.fleetPreset.006')} aria-label={tr('ui.fleetPreset.006')} onClick={() => setConfirm({ id: preset.id, kind: 'replace' })}><Copy size={15} aria-hidden /></button>
            <button className="app-btn is-small app-fleet-preset-icon" title={tr('ui.fleetPreset.007')} aria-label={tr('ui.fleetPreset.007')} onClick={() => setConfirm({ id: preset.id, kind: 'delete' })}><Trash2 size={15} aria-hidden /></button>
          </div>
          {confirm?.id === preset.id ? <div className="app-fleet-preset-confirm">
            <span>{tr(confirm.kind === 'replace' ? 'ui.fleetPreset.010' : 'ui.fleetPreset.011', { p1: preset.name })}</span>
            <button className="app-btn is-small" disabled={busy && confirm.kind === 'replace'} onClick={() => finish(confirm.kind === 'replace' ? engine.fleetPresetSave(preset.name, preset.id) : engine.fleetPresetDelete(preset.id), confirm.kind === 'replace' ? 'ui.fleetPreset.012' : 'ui.fleetPreset.015')}>{tr('ui.fleetPreset.008')}</button>
            <button className="app-btn is-small" onClick={() => setConfirm(null)}>{tr('ui.fleetPreset.009')}</button>
          </div> : null}
        </div>
      })}
    </div> : null}
  </section>
}
