/**
 * 启动入口：先显示"正在启动"，引擎就绪后再渲染主界面。
 *
 * ⚠ **启动序列与网页版共用**（`game/boot.ts` 的 `prebootRenderer` / `startGameEngine`）：
 * 本仓有**两个入口**（这里 + `web/src/main.tsx`），任何"首帧前要做的动作"或"启动引擎前要做的事"
 * 都必须加在那个共用模块里——2026-09-25 的存档体检就漏过一次网页版。
 */
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { GameEngine } from './game/engine'
import { prebootRenderer, startGameEngine } from './game/boot'
import { runAutoPerf } from './game/autoPerf'
import { L10nProvider, tr } from './i18n/locale'

// 首帧渲染之前的固定动作（布局样式 / 宇宙背景 / 配色）
prebootRenderer()

const engine = new GameEngine()
const root = createRoot(document.getElementById('root')!)

root.render(
  <div className="app-loading">{tr('ui.main.001')}</div>,
)

// 启动引擎（含存档存储体检）
startGameEngine(engine)
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
