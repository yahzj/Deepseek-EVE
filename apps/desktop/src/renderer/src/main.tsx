/**
 * 启动入口：先显示"正在启动"，引擎就绪后再渲染主界面。
 */
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { GameEngine } from './game/engine'
import { runAutoPerf } from './game/autoPerf'
import './styles.css'

const engine = new GameEngine()
const root = createRoot(document.getElementById('root')!)

root.render(<div className="app-loading">正在启动星门引擎……</div>)

engine
  .start()
  .then(() => {
    root.render(<App engine={engine} />)
    // 性能自动采集模式（仅 Electron 环境变量注入时运行；玩家路径无感）
    const perfJson = window.__autoperf
    if (perfJson) {
      try {
        void runAutoPerf(engine, JSON.parse(perfJson) as Parameters<typeof runAutoPerf>[1])
      } catch (err) {
        console.error('性能自动采集启动失败：', err)
      }
    }
  })
  .catch((err: unknown) => {
    console.error('引擎启动失败：', err)
    root.render(<div className="app-loading">启动失败：{String(err)}（详见开发者控制台）</div>)
  })
