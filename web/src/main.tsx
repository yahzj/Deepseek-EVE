/**
 * 网页版启动入口：与桌面 renderer 同一份代码（App / GameEngine / styles 源码直连）。
 *
 * ⚠ **启动序列必须与桌面入口共用**（`game/boot.ts`）：本仓有**两个入口**——
 * 任何"首帧前要做的动作"（布局样式 / 宇宙背景 / 配色）或"启动引擎前要做的事"（存档存储体检）
 * 都写在那个共用模块里，这里只负责调用。2026-09-25 就漏过一次：存档体检只加在桌面入口，
 * 结果**网页版（Safari 玩家走的那条路）等于没体检**，存档丢了也看不到任何提示。
 */
import { createRoot } from 'react-dom/client'
import { App } from '../../apps/desktop/src/renderer/src/App'
import { GameEngine } from '../../apps/desktop/src/renderer/src/game/engine'
import { prebootRenderer, startGameEngine } from '../../apps/desktop/src/renderer/src/game/boot'
import { L10nProvider, tr } from '../../apps/desktop/src/renderer/src/i18n/locale'

// 首帧渲染之前的固定动作（布局样式 / 宇宙背景 / 配色）
prebootRenderer()

const engine = new GameEngine()
const root = createRoot(document.getElementById('root')!)

root.render(<div className="app-loading">{tr('ui.main.001')}</div>)

// 启动引擎（含存档存储体检）
startGameEngine(engine)
  .then(() => {
    root.render(
      <L10nProvider>
        <App engine={engine} />
      </L10nProvider>,
    )
  })
  .catch((err: unknown) => {
    console.error(tr('ui.main.004'), err)
    root.render(<div className="app-loading">{tr('ui.main.002', { err: String(err) })}</div>)
  })
