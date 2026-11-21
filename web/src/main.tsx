import { createRoot } from 'react-dom/client'
import { App } from '../../apps/desktop/src/renderer/src/App'
import { GameEngine } from '../../apps/desktop/src/renderer/src/game/engine'
import { prebootRenderer, startGameEngine } from '../../apps/desktop/src/renderer/src/game/boot'
import { L10nProvider, tr } from '../../apps/desktop/src/renderer/src/i18n/locale'
import { SaveWriterGate } from '../../apps/desktop/src/renderer/src/panels/SaveWriterGate'
import { startUpdatePrompt } from './updatePrompt'
import { BootGate, bootFail, bootReportStage, bootStopWatch } from '../../apps/desktop/src/renderer/src/boot/BootGate'

/**
 * 网页端环境守卫：防范离线扒取、本地双击 (file://) 及未授权的第三方镜像
 *
 * 官方域名白名单（2026-11-12 船长令）：自建正式站 game.bajibaji.party 与本机 IP
 * 同样属于官方入口，放行；其余未知域名仍按第三方镜像拦截。
 */
function checkWebEnvironment(): boolean {
  if (typeof window === 'undefined') return true
  const proto = window.location.protocol
  const host = window.location.hostname
  const isDev = host === 'localhost' || host === '127.0.0.1' || host === ''
  const isOfficial =
    host === 'yahzj.github.io' ||
    host.endsWith('.github.io') ||
    host === 'game.bajibaji.party' ||
    host === '123.207.188.192'

  if (proto === 'file:' || (!isDev && !isOfficial)) {
    const rootEl = document.getElementById('root')
    const warningHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background-color:#0b0e14;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:24px;box-sizing:border-box;text-align:center;">
        <div style="max-width:540px;background:rgba(23,28,38,0.95);border:1px solid #334155;border-radius:12px;padding:32px 28px;box-shadow:0 20px 40px rgba(0,0,0,0.5);">
          <div style="font-size:44px;margin-bottom:12px;">🛰️</div>
          <h2 style="color:#f87171;margin:0 0 12px 0;font-size:20px;font-weight:600;">运行环境受限 / 非官方授权版本</h2>
          <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 20px 0;">
            检测到当前《大鲸鱼-深空放置》运行在未授权的离线副本或第三方镜像站点中。<br />
            为保障数据安全与游戏完整体验，请前往官方唯一正版页面游玩。
          </p>
          <div style="margin:20px 0;">
            <a href="https://yahzj.github.io/Deepseek-EVE/" style="display:inline-block;background:#38bdf8;color:#0f172a;padding:10px 24px;border-radius:6px;font-weight:600;text-decoration:none;font-size:14px;">
              前往官方 GitHub Pages 正版
            </a>
          </div>
          <div style="border-top:1px solid #1e293b;padding-top:16px;margin-top:20px;">
            <p style="color:#64748b;font-size:12px;line-height:1.5;margin:0;">
              本项目遵循 AGPLv3 商业双重许可协议。未经作者授权，严禁任何形式的闭源分发、离线打包与商业化运作。<br />
              官方仓库：<a href="https://github.com/yahzj/Deepseek-EVE" style="color:#64748b;text-decoration:underline;">github.com/yahzj/Deepseek-EVE</a>
            </p>
          </div>
        </div>
      </div>
    `
    if (rootEl) {
      rootEl.innerHTML = warningHtml
    } else {
      document.body.innerHTML = warningHtml
    }
    return false
  }
  return true
}

if (checkWebEnvironment()) {
  prebootRenderer()
  startUpdatePrompt()
  window.__WHALE_BOOT__?.bundleReady?.()

  const engine = new GameEngine()
  const root = createRoot(document.getElementById('root')!)

  bootReportStage('sync')
  root.render(<BootGate />)

  startGameEngine(engine, { onStage: bootReportStage })
    .then((started) => {
      bootReportStage('bridge')
      bootStopWatch()
      window.__WHALE_BOOT__?.handover?.()
      root.render(
        <L10nProvider>
          <SaveWriterGate code={started ? undefined : 'SG-05'}>{started ? <App engine={engine} /> : null}</SaveWriterGate>
        </L10nProvider>,
      )
    })
    .catch((err: unknown) => {
      console.error(tr('ui.main.004'), err)
      bootFail('SG-FF', err instanceof Error ? err.message : String(err))
    })
}
