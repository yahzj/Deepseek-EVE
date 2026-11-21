import { useState } from 'react'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'

export { debugAllowed, debugEnabled, setDebugEnabled } from '../game/debugFlag'

export function DebugButton({
  engine,
  onFastForwarded,
}: {
  engine: GameEngine
  onFastForwarded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [quick, setQuick] = useState(engine.state.debugQuick)
  const [amount, setAmount] = useState('30')
  const [unit, setUnit] = useState<'min' | 'hour'>('min')

  function doFastForward(): void {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return
    const ms = unit === 'hour' ? Math.round(n * 3_600_000) : Math.round(n * 60_000)
    engine.debugFastForward(ms)
    onFastForwarded()
  }

  return (
    <span className="app-debug-wrap">
      <button
        className={`app-btn${quick ? ' is-warn' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={tr("ui.DebugPanel.001")}
      >
        {tr("ui.DebugPanel.002")}{quick ? tr("ui.DebugPanel.003") : ''}
      </button>
      {open ? (
        <>
          <div className="app-debug-backdrop" onClick={() => setOpen(false)} />
          <div className="app-debug-pop">
            <div className="app-debug-title">{tr("ui.DebugPanel.004")}</div>
            <label className="app-check">
              <input
                type="checkbox"
                checked={quick}
                onChange={(e) => {
                  setQuick(e.target.checked)
                  engine.setDebugQuick(e.target.checked)
                }}
              />
              {tr("ui.DebugPanel.005")}
            </label>
            <div className="app-debug-row">
              <span className="app-dim">{tr("ui.DebugPanel.006")}</span>
              <input
                className="app-select app-debug-input"
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <select className="app-select" value={unit} onChange={(e) => setUnit(e.target.value as 'min' | 'hour')}>
                <option value="min">{tr("ui.DebugPanel.007")}</option>
                <option value="hour">{tr("ui.DebugPanel.008")}</option>
              </select>
              <button className="app-btn is-small is-primary" onClick={doFastForward} title={tr("ui.DebugPanel.009")}>
                {tr("ui.DebugPanel.010")}
              </button>
            </div>
            <div className="app-dim app-debug-note">{tr("ui.DebugPanel.011")}</div>
          </div>
        </>
      ) : null}
    </span>
  )
}
