import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { saveWriterState, subscribeSaveWriter } from '../game/saveWriter'
import { saveBridge, readStoredWebSave } from '../game/storage'
import { loadSaveFile } from '@whale/core'
import { tr } from '../i18n/locale'

/** 第二个页面不启动引擎，只读取持久化摘要；分享调用保持在点击手势内。 */
export function SaveWriterGate({ children }: { children?: ReactNode }) {
  const [state, setState] = useState(saveWriterState)
  const [text, setText] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  useEffect(() => subscribeSaveWriter(() => setState(saveWriterState())), [])
  useEffect(() => {
    if (state === 'writer') return
    let live = true
    void Promise.resolve().then(readStoredWebSave).then((value) => {
      if (!live) return
      setText(value)
      if (value) { try { setName(loadSaveFile(value).state.character.name) } catch { setName('') } }
    }).catch((err) => { if (live) setError(String(err)) })
    return () => { live = false }
  }, [state])
  if (state === 'writer') return <>{children}</>
  return <div className="app-loading" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div>{tr(state === 'busy' ? 'ui.saveReconnect.010' : 'ui.saveReconnect.013')}</div>
    <div className="app-note">{tr('ui.saveReconnect.011')}</div>
    {name ? <div>{name}</div> : null}
    <div className="app-save-actions">
      <button className="app-btn" onClick={() => window.location.reload()}>{tr('ui.saveReconnect.012')}</button>
      <button className="app-btn" disabled={text === null} onClick={() => {
        if (text === null) return
        void saveBridge.exportSaveToFile(text).then((result) => {
          if (!result.ok && !result.canceled) setError(result.error ?? tr('ui.SaveManager.030'))
        }).catch((err) => setError(String(err)))
      }}>{tr('ui.SaveManager.016')}</button>
    </div>
    <div role="alert">{error}</div>
  </div>
}
