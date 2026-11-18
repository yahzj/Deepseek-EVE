import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { BUILD, BUILD_FORM } from '../game/buildInfo'
import { tr } from '../i18n/locale'

const FEEDBACK_ENDPOINT = 'https://game.bajibaji.party:7777/api/feedback'
const DRAFT_KEY = 'whale-idle:feedback-draft'
const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_TEXT = 4000
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeDraft(text: string): void {
  try {
    if (text === '') localStorage.removeItem(DRAFT_KEY)
    else localStorage.setItem(DRAFT_KEY, text)
  } catch {
  }
}

interface Shot {
  id: number
  base64: string
  dataUrl: string
}

async function fileToShot(file: File, id: number): Promise<Shot> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const base64 = btoa(binary)
  return { id, base64, dataUrl: `data:${file.type};base64,${base64}` }
}

/** 游戏内反馈弹窗：描述 + Ctrl+V 粘贴截图 → 服务器代发 GitHub Issue。 */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState(readDraft)
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const seq = useRef(0)

  async function addFiles(files: File[]): Promise<void> {
    const images = files.filter((f) => IMAGE_TYPES.has(f.type))
    if (images.length === 0) {
      setError(tr('ui.feedback.010'))
      return
    }
    const room = MAX_IMAGES - shots.length
    if (room <= 0) {
      setError(tr('ui.feedback.011', { p1: MAX_IMAGES }))
      return
    }
    setError('')
    const accepted: Shot[] = []
    for (const file of images.slice(0, room)) {
      if (file.size > MAX_IMAGE_BYTES) {
        setError(tr('ui.feedback.012', { p1: MAX_IMAGE_BYTES / 1024 / 1024 }))
        continue
      }
      accepted.push(await fileToShot(file, ++seq.current))
    }
    if (images.length > room) setError(tr('ui.feedback.011', { p1: MAX_IMAGES }))
    if (accepted.length > 0) setShots((prev) => [...prev, ...accepted])
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>): void {
    const files: File[] = []
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    void addFiles(Array.from(e.dataTransfer.files))
  }

  async function submit(): Promise<void> {
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      setError(tr('ui.feedback.009'))
      return
    }
    if (trimmed.length > MAX_TEXT) {
      setError(tr('ui.feedback.013', { p1: MAX_TEXT }))
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          images: shots.map((s) => ({ data: s.base64 })),
          meta: {
            version: BUILD.version,
            platform: BUILD_FORM === 'web' ? 'web' : 'desktop',
            ua: navigator.userAgent,
          },
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || payload.ok !== true) {
        throw new Error(payload.message ?? `HTTP ${res.status}`)
      }
      setDone(true)
      writeDraft('')
    } catch (err) {
      setError(tr('ui.feedback.008', { p1: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="app-modal-mask app-feedback-mask" onClick={() => { if (!busy) onClose() }}>
      <div
        className="app-modal app-feedback-modal"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div className="app-modal-head">
          <span className="app-report-title">{tr('ui.feedback.001')}</span>
          <button className="app-btn is-small" disabled={busy} onClick={onClose}>
            {tr('ui.feedback.005')}
          </button>
        </div>
        <div className="app-modal-body">
          {done ? (
            <div className="app-feedback-done">
              <div className="app-feedback-done-title">{tr('ui.feedback.007')}</div>
            </div>
          ) : (
            <>
              <div className="app-feedback-hint">{tr('ui.feedback.002')}</div>
              <textarea
                className="app-feedback-textarea"
                value={text}
                maxLength={MAX_TEXT}
                placeholder={tr('ui.feedback.003')}
                onChange={(e) => {
                  setText(e.target.value)
                  writeDraft(e.target.value)
                }}
                onPaste={onPaste}
                disabled={busy}
                autoFocus
              />
              {shots.length > 0 ? (
                <div className="app-feedback-shots">
                  {shots.map((shot) => (
                    <div key={shot.id} className="app-feedback-shot">
                      <img src={shot.dataUrl} alt="" />
                      <button
                        className="app-feedback-shot-del"
                        title={tr('ui.feedback.015')}
                        disabled={busy}
                        onClick={() => setShots((prev) => prev.filter((s) => s.id !== shot.id))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {error !== '' ? <div className="app-feedback-error">{error}</div> : null}
              <div className="app-feedback-foot">
                <span className="app-dim">
                  {tr('ui.feedback.014', {
                    p1: BUILD.version,
                    p2: BUILD_FORM === 'web' ? tr('ui.App.172') : tr('ui.App.173'),
                  })}
                </span>
                <span className="app-settings-btns">
                  <button className="app-btn is-small" disabled={busy} onClick={onClose}>
                    {tr('ui.feedback.005')}
                  </button>
                  <button className="app-btn is-small is-primary" disabled={busy} onClick={() => void submit()}>
                    {busy ? tr('ui.feedback.006') : tr('ui.feedback.004')}
                  </button>
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
