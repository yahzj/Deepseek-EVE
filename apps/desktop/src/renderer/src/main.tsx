/**
 * 启动入口：先显示"正在启动"，引擎就绪后再渲染主界面。
 */
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { GameEngine } from './game/engine'
import { runAutoPerf } from './game/autoPerf'
import { applySpaceBg } from './ui/spaceBg'
import { bootstrapTheme } from './ui/theme'
import { L10nProvider, tr } from './i18n/locale'
import { installLayoutStyles } from './ui/layoutStyles'

// **两套布局两套样式**（2026-09-25 船长令）：按玩家偏好只加载对应那一份。
// ⚠ 必须在这里（首帧渲染之前）调用：两份样式的类名高度重叠，同时生效会互相串味。
installLayoutStyles()

// 宇宙背景（2026-09-10 船长）：启动时抽一张无缝贴图并写入 --space-bg；
// 放在首帧渲染之前，避免先闪一下纯色底
applySpaceBg()
// 界面配色（2026-09-22 船长令）：同样在首帧前把 data-theme 写上 ⇒ 不会先闪一下另一套配色
bootstrapTheme()

const engine = new GameEngine()
const root = createRoot(document.getElementById('root')!)

root.render(
  <div className="app-loading">{tr('ui.main.001')}</div>,
)

engine
  .start()
  .then(() => {
    // 性能自动采集模式（仅 Electron 环境变量注入时运行；玩家路径无感）：
    // 必须在 App 首帧渲染前激活 Hub，让 Profiler/埋点从第一个 commit 就记录
    const perfJson = window.__autoperf
    if (perfJson) {
      try {
        const spec = JSON.parse(perfJson) as Parameters<typeof runAutoPerf>[1]
        void import('./game/perf').then(({ perfHub }) => {
          perfHub.activate()
          root.render(
            <L10nProvider>
              <App engine={engine} />
            </L10nProvider>,
          )
          void runAutoPerf(engine, spec)
        })
        return
      } catch (err) {
        console.error(tr("ui.main.003"), err)
      }
    }
    root.render(
      <L10nProvider>
        <App engine={engine} />
      </L10nProvider>,
    )
  })
  .catch((err: unknown) => {
    console.error(tr("ui.main.004"), err)
    root.render(
      <div className="app-loading">{tr('ui.main.002', { err: String(err) })}</div>,
    )
  })
