/**
 * 启动入口：先显示"正在启动"，引擎就绪后再渲染主界面。
 */
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { GameEngine } from './game/engine'
import { runAutoPerf } from './game/autoPerf'
import { applySpaceBg } from './ui/spaceBg'
import './styles.css'

// 宇宙背景（2026-09-10 船长）：启动时抽一张无缝贴图并写入 --space-bg；
// 放在首帧渲染之前，避免先闪一下纯色底
applySpaceBg()

const engine = new GameEngine()
const root = createRoot(document.getElementById('root')!)

root.render(<div className="app-loading">正在启动星门引擎……</div>)

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
          root.render(<App engine={engine} />)
          void runAutoPerf(engine, spec)
        })
        return
      } catch (err) {
        console.error('性能自动采集启动失败：', err)
      }
    }
    root.render(<App engine={engine} />)
  })
  .catch((err: unknown) => {
    console.error('引擎启动失败：', err)
    root.render(<div className="app-loading">启动失败：{String(err)}（详见开发者控制台）</div>)
  })
