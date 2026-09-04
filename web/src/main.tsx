/**
 * 网页版启动入口：与桌面 renderer 同一份代码（App / GameEngine / styles 源码直连）。
 */
import { createRoot } from 'react-dom/client'
import { App } from '../../apps/desktop/src/renderer/src/App'
import { GameEngine } from '../../apps/desktop/src/renderer/src/game/engine'
import '../../apps/desktop/src/renderer/src/styles.css'

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
    root.render(<div className="app-loading">启动失败：{String(err)}（请见开发者控制台）</div>)
  })
