/**
 * 网页版更新提示（2026-11-09 船长令：页面检测到有新版本时弹「有更新，点我刷新」）。
 *
 * 背景：挂机玩家长期不关页面，浏览器里跑的一直是打开那一刻加载的旧包——
 * 新规则上线后仍然按旧逻辑发请求，玩家却看不出区别，只会觉得「功能没生效」。
 *
 * 做法：定时 + 回到页面时拉一次线上 index.html（带时间戳绕缓存），
 * 比对入口脚本文件名；和当前运行的不一致就弹一条小提示，由玩家自己点刷新，
 * 不在回合中强行刷新，也不打断正在进行的操作。
 * 桌面版是打包加载、开发服务器没有哈希入口，这里都会自动不启用。
 */
import { tr } from '../../apps/desktop/src/renderer/src/i18n/locale'
import { isNewerBuild } from './buildFreshness'

/** 后台挂机时的轮询间隔 */
const CHECK_INTERVAL_MS = 5 * 60_000
/** 切回页面/获得焦点时的重查节流 */
const MIN_RECHECK_MS = 60_000
const BANNER_ID = 'whale-update-banner'

/** 当前页面正在运行的入口脚本地址（构建产物都在 /assets/ 下）。 */
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
      // 已经弹过就不再重复追加；玩家不刷新时也只保留一条提示。
      if (document.getElementById(BANNER_ID)) return
      if (isNewerBuild(currentSrc, html, indexUrl)) {
        showBanner(() => window.location.reload())
      }
    } catch {
      // 网络失败、离线、跨域限制都只是这一次没查成，下一轮再试。
    } finally {
      checking = false
    }
  }

  // 首帧先让位给启动流程，之后再开始查。
  window.setTimeout(() => void check(), 10_000)
  window.setInterval(() => void check(), CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check()
  })
  window.addEventListener('focus', () => void check())
}
