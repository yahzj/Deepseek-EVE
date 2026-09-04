/**
 * 启动入口：先显示"正在启动"，引擎就绪后再渲染主界面。
 */
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { GameEngine } from './game/engine'
import './styles.css'

const engine = new GameEngine()
const root = createRoot(document.getElementById('root')!)

root.render(<div className="app-loading">正在启动星门引擎……</div>)

engine
  .start()
  .then(() => {
    root.render(<App engine={engine} />)
  })
  .catch((err: unknown) => {
    console.error('引擎启动失败：', err)
    root.render(<div className="app-loading">启动失败：{String(err)}（详见开发者控制台）</div>)
  })
