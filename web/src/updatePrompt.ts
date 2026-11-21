import { tr } from '../../apps/desktop/src/renderer/src/i18n/locale'
import { isNewerBuild } from './buildFreshness'

const CHECK_INTERVAL_MS = 5 * 60_000
const MIN_RECHECK_MS = 60_000
const BANNER_ID = 'whale-update-banner'

function runningEntryScript(): string | null {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
  for (const script of scripts) {
    if (script.src.includes('/assets/')) return script.src
  }
  return null
}

function showBanner(onReload: () => void): void {
  if (document.getElementById(BANNER_ID)) return
  const box = document.createElement('div')
  box.id = BANNER_ID
  box.setAttribute('role', 'status')
  box.style.cssText = [
    'position:fixed',
    'right:18px',
    'bottom:18px',
    'z-index:2147483000',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'max-width:min(420px, calc(100vw - 36px))',
    'padding:10px 12px 10px 14px',
    'border:1px solid #334155',
    'border-radius:10px',
    'background:rgba(15,20,30,0.96)',
    'box-shadow:0 12px 32px rgba(0,0,0,0.45)',
    'color:#e2e8f0',
    'font-size:13px',
    'line-height:1.5',
  ].join(';')

  const text = document.createElement('span')
  text.textContent = tr('ui.webUpdate.001')
  text.style.cssText = 'flex:1 1 auto;min-width:0'

  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = tr('ui.webUpdate.002')
  button.style.cssText = [
    'flex:0 0 auto',
    'padding:6px 12px',
    'border:0',
    'border-radius:6px',
    'background:#38bdf8',
    'color:#0f172a',
    'font-size:13px',
    'font-weight:600',
    'cursor:pointer',
  ].join(';')
  button.addEventListener('click', onReload)

  box.append(text, button)
  document.body.appendChild(box)
}

export function startUpdatePrompt(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return
  const currentSrc = runningEntryScript()
  if (currentSrc === null) return

  const indexUrl = new URL('index.html', new URL('.', location.href)).href
  let lastCheckAt = 0
  let checking = false

  const check = async (): Promise<void> => {
    const now = Date.now()
    if (checking || now - lastCheckAt < MIN_RECHECK_MS) return
    lastCheckAt = now
    checking = true
    try {
      const res = await fetch(`${indexUrl}?t=${now}`, { cache: 'no-store' })
      if (!res.ok) return
      const html = await res.text()
      if (document.getElementById(BANNER_ID)) return
      if (isNewerBuild(currentSrc, html, indexUrl)) {
        showBanner(() => window.location.reload())
      }
    } catch {
    } finally {
      checking = false
    }
  }

  window.setTimeout(() => void check(), 10_000)
  window.setInterval(() => void check(), CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check()
  })
  window.addEventListener('focus', () => void check())
}
