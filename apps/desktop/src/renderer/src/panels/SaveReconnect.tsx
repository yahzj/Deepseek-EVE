import { useEffect, useRef, useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ReconnectChoice, ReconnectProgress } from '../game/saveReconnect'
import { tr } from '../i18n/locale'
import { fmtDuration, localeTag } from '../i18n/fmt'

function Progress({ value }: { value: ReconnectProgress }) {
  return <div className="app-note" style={{ overflowWrap: 'anywhere' }}>
    <div>{value.name}</div>
    <div>{new Date(value.wallMs).toLocaleString(localeTag(), { hour12: false })}</div>
    <div>{fmtDuration(value.gameMs)}</div>
    <div>{value.ironman ? tr('ui.Ironman.001', { p1: value.seq }) : tr('ui.Ironman.007')}</div>
  </div>
}

export function SaveReconnect({ engine, choice, onChoice, onClose, onDone }: {
  engine: GameEngine
  choice: ReconnectChoice
  onChoice: (choice: ReconnectChoice) => void
  onClose: () => void
  onDone: (loaded: boolean, paused: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!busyRef.current) closeRef.current()
      }
      if (event.key !== 'Tab') return
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      if (!buttons.length) { event.preventDefault(); dialog.current?.focus(); return }
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); buttons[buttons.length - 1]?.focus() }
      else if (!event.shiftKey && (index < 0 || index === buttons.length - 1)) { event.preventDefault(); buttons[0]?.focus() }
    }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus() }
  }, [])
  async function resolve(value: 'file' | 'current'): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const result = await engine.resolveReconnectLocalSave(value)
      if (result.choice) onChoice(result.choice)
      if (!result.ok) setError(result.error ?? tr('ui.engine.027'))
      else onDone(result.loaded === true, result.filePaused === true)
    } finally { busyRef.current = false; setBusy(false) }
  }
  return <div className="app-modal-mask" style={{ zIndex: 1200 }} onClick={() => { if (!busy) onClose() }}>
    <div ref={dialog} className="app-modal" role="dialog" aria-modal="true" aria-labelledby="save-reconnect-title"
      tabIndex={-1} style={{ width: 580, maxWidth: '95%', maxHeight: '95%', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
      <div className="app-modal-head"><span id="save-reconnect-title" className="app-report-title">{tr('ui.saveReconnect.001')}</span></div>
      <div className="app-modal-body">
        <div className="app-note">{tr('ui.saveReconnect.002')}</div>
        <div className="app-save-actions" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
          <section style={{ flex: '1 1 200px', minWidth: 0 }}><h3 className="app-bay-title">{tr('ui.saveReconnect.003')}</h3><Progress value={choice.current} /></section>
          <section style={{ flex: '1 1 200px', minWidth: 0 }}><h3 className="app-bay-title">{tr('ui.saveReconnect.004')}</h3>
            <div className="app-dim" style={{ overflowWrap: 'anywhere' }}>{choice.fileName}</div><Progress value={choice.file} /></section>
        </div>
        <div role="alert" className="app-warn" style={{ minHeight: 28 }}>{error}</div>
        <div className="app-save-actions" style={{ flexWrap: 'wrap' }}>
          <button className="app-btn is-small" disabled={busy} onClick={() => void resolve('file')}>{tr('ui.saveReconnect.005')}</button>
          <button className="app-btn is-small is-danger" disabled={busy} onClick={() => void resolve('current')}>{tr('ui.saveReconnect.006')}</button>
          <button ref={cancel} className="app-btn is-small" disabled={busy} onClick={onClose}>{tr('ui.saveReconnect.007')}</button>
        </div>
      </div>
    </div>
  </div>
}
