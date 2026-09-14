/**
 * 网页版启动入口：与桌面 renderer 同一份代码（App / GameEngine / styles 源码直连）。
 */
import { createRoot } from 'react-dom/client'
import { App } from '../../apps/desktop/src/renderer/src/App'
import { GameEngine } from '../../apps/desktop/src/renderer/src/game/engine'
import { applySpaceBg } from '../../apps/desktop/src/renderer/src/ui/spaceBg'
import '../../apps/desktop/src/renderer/src/styles.css'

// 宇宙背景（2026-09-10 船长）：与桌面入口同口径——启动时抽一张无缝贴图并写入 `--space-bg`，
// 放在首帧渲染之前，避免先闪一下纯色底。（此前只有桌面入口调，网页版一直只有 CSS 星点兜底；
// 图源本就随 App 打进网页版包，这里只是补上"启动时写变量"这一步，不增加包体。）
applySpaceBg()

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
