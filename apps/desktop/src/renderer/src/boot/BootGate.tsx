import { useEffect, useState, type ReactElement } from 'react'
import './bootSplash.css'
import { FeedbackDialog } from '../panels/FeedbackDialog'
import { tr } from '../i18n/locale'
import {
  BOOT_CODES,
  BOOT_STAGES,
  bootCompletedPercentOf,
  bootStageDefOf,
  formatBootDiagnostics,
  type BootCodeId,
  type BootStageId,
} from '../game/bootProgress'

export interface PreBundleBootBridge {
  startedAt?: number
  bundleReady?: () => void
  handover?: () => void
  fail?: (code: string, detail?: string) => void
}

declare global {
  interface Window {
    __WHALE_BOOT__?: PreBundleBootBridge
  }
}

interface BootView {
  stage: BootStageId
  stageElapsedMs: number
  totalElapsedMs: number
  code: BootCodeId | null
  detail: string
  slow: boolean
}

const listeners = new Set<() => void>()
let view: BootView = { stage: 'sync', stageElapsedMs: 0, totalElapsedMs: 0, code: null, detail: '', slow: false }
let stageStartedAt = 0
let originMs = 0
let ticker: number | null = null
let slowTimer: number | null = null
let failTimer: number | null = null

function origin(): number {
  if (originMs === 0) {
    const started = typeof window !== 'undefined' ? window.__WHALE_BOOT__?.startedAt : undefined
    originMs = typeof started === 'number' && Number.isFinite(started) ? started : performance.now()
  }
  return originMs
}

function emit(): void {
  for (const fn of listeners) fn()
}

function clearTimers(): void {
  if (ticker !== null) {
    window.clearInterval(ticker)
    ticker = null
  }
  if (slowTimer !== null) {
    window.clearTimeout(slowTimer)
    slowTimer = null
  }
  if (failTimer !== null) {
    window.clearTimeout(failTimer)
    failTimer = null
  }
}

function tick(): void {
  const now = performance.now()
  view = { ...view, stageElapsedMs: now - stageStartedAt, totalElapsedMs: now - origin() }
  emit()
}

export function bootReportStage(stage: BootStageId): void {
  clearTimers()
  const def = bootStageDefOf(stage)
  stageStartedAt = performance.now()
  view = { ...view, stage, stageElapsedMs: 0, totalElapsedMs: stageStartedAt - origin(), code: null, detail: '', slow: false }
  emit()
  ticker = window.setInterval(tick, 250)
  if (def.slowMs > 0) {
    slowTimer = window.setTimeout(() => {
      view = { ...view, slow: true }
      emit()
    }, def.slowMs)
  }
  if (def.failMs > 0 && def.failCode !== null) {
    const code = def.failCode
    failTimer = window.setTimeout(() => {
      if (view.code === null) bootFail(code)
    }, def.failMs)
  }
}

export function bootFail(code: BootCodeId, detail = ''): void {
  clearTimers()
  const now = performance.now()
  view = { ...view, code, detail, slow: false, stageElapsedMs: now - stageStartedAt, totalElapsedMs: now - origin() }
  emit()
  window.__WHALE_BOOT__?.fail?.(code, detail)
}

export function bootStopWatch(): void {
  clearTimers()
}

export function bootSnapshot(): BootView {
  return view
}

export function subscribeBoot(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const SELF_HOSTS = ['game.bajibaji.party', '123.207.188.192']

function fallbackEntry(): string | null {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname
  if (host.endsWith('.github.io')) return 'https://game.bajibaji.party:7777/'
  if (SELF_HOSTS.includes(host)) return 'https://yahzj.github.io/Deepseek-EVE/'
  return null
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

function saveBytesOf(): number | null {
  try {
    return window.localStorage.getItem('whale:idle:save')?.length ?? null
  } catch {
    return null
  }
}

function diagnosticsOf(input: BootView, code: BootCodeId): string {
  return formatBootDiagnostics({
    code,
    stageId: input.stage,
    stageLabel: tr(bootStageDefOf(input.stage).labelKey),
    elapsedMs: input.totalElapsedMs,
    detail: input.detail,
    saveBytes: saveBytesOf(),
  })
}

export function BootGate(): ReactElement {
  const [current, setCurrent] = useState<BootView>(bootSnapshot())
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => subscribeBoot(() => setCurrent(bootSnapshot())), [])
  useEffect(() => () => bootStopWatch(), [])

  const code = current.code
  const stageIndex = BOOT_STAGES.findIndex((stage) => stage.id === current.stage)
  const percent = bootCompletedPercentOf(current.stage)
  const stageSeconds = (current.stageElapsedMs / 1000).toFixed(1)
  const totalSeconds = (current.totalElapsedMs / 1000).toFixed(0)
  const fallback = fallbackEntry()

  const onCopy = (): void => {
    if (code === null) return
    void copyText(diagnosticsOf(current, code)).then((ok) => {
      if (ok) setCopied(true)
    })
  }

  return (
    <div className={code === null ? 'boot-splash boot-splash--live' : 'boot-splash boot-splash--live is-failed'}>
      <div className="boot-splash__panel">
        <div className="boot-splash__line boot-splash__head">大鲸鱼级深空机库 · 固件自检 v2.6</div>
        <div className="boot-splash__line boot-splash__rule">────────────────────────────</div>
        {code === null ? (
          <>
            <div className="boot-splash__line">
              {tr('ui.boot.208', { p1: tr(bootStageDefOf(current.stage).labelKey) })}
              <span className="boot-splash__cursor" />
            </div>
            <div className="boot-splash__line boot-splash__stage">
              已完成：{BOOT_STAGES.slice(0, Math.max(0, stageIndex)).map((stage) => tr(stage.labelKey)).join(' · ') || '—'}
            </div>
            <div className="boot-splash__track">
              <div className="boot-splash__track-fill" style={{ width: percent + '%' }} />
            </div>
            <div className="boot-splash__line boot-splash__meta">
              {tr('ui.boot.209', { p1: String(percent) })} · {tr('ui.boot.206', { p1: stageSeconds })} · {tr('ui.boot.207', { p1: totalSeconds })}
            </div>
            {current.slow ? <div className="boot-splash__line boot-splash__warn">{tr('ui.boot.210')}</div> : null}
            <div className="boot-splash__line boot-splash__dim">{tr('ui.boot.211')}</div>
          </>
        ) : (
          <>
            <div className="boot-splash__fail-title">{tr(BOOT_CODES[code].titleKey)}</div>
            <div className="boot-splash__fail-advice">{tr(BOOT_CODES[code].adviceKey)}</div>
            <div className="boot-splash__fail-code">
              {tr('ui.boot.205', { p1: code })} · {tr('ui.boot.206', { p1: totalSeconds })}
            </div>
            <div className="boot-splash__fail-actions">
              <button type="button" className="boot-splash__btn" onClick={() => window.location.reload()}>
                {tr('ui.boot.201')}
              </button>
              <button type="button" className="boot-splash__btn is-primary" onClick={() => setFeedbackOpen(true)}>
                {tr('ui.boot.202')}
              </button>
              <button type="button" className="boot-splash__btn" onClick={onCopy}>
                {copied ? tr('ui.boot.204') : tr('ui.boot.203')}
              </button>
              {fallback !== null ? (
                <a className="boot-splash__btn" href={fallback}>
                  {tr('ui.boot.213')}
                </a>
              ) : null}
            </div>
            <div className="boot-splash__fail-note">{tr('ui.boot.212')}</div>
          </>
        )}
      </div>
      {feedbackOpen && code !== null ? (
        <FeedbackDialog
          onClose={() => setFeedbackOpen(false)}
          initialText={diagnosticsOf(current, code)}
          bootCode={code}
        />
      ) : null}
    </div>
  )
}