/**
 * 网页版启动入口：与桌面 renderer 同一份代码（App / GameEngine / styles 源码直连）。
 */
import { createRoot } from 'react-dom/client'
import { App } from '../../apps/desktop/src/renderer/src/App'
import { GameEngine } from '../../apps/desktop/src/renderer/src/game/engine'
import { applySpaceBg } from '../../apps/desktop/src/renderer/src/ui/spaceBg'
import { bootstrapTheme } from '../../apps/desktop/src/renderer/src/ui/theme'
import { L10nProvider, tr } from '../../apps/desktop/src/renderer/src/i18n/locale'
import { installLayoutStyles } from '../../apps/desktop/src/renderer/src/ui/layoutStyles'

// **两套布局两套样式**（2026-09-25 船长令）：按玩家偏好只加载对应那一份。
// ⚠ 与桌面入口同口径、同样必须在首帧渲染之前调；两份样式类名高度重叠，同时生效会互相串味。
// ⚠ 网页版有**自己的入口**：桌面入口改了这里也必须改。
installLayoutStyles()

// 宇宙背景（2026-09-10 船长）：与桌面入口同口径——启动时抽一张无缝贴图并写入 `--space-bg`，
// 放在首帧渲染之前，避免先闪一下纯色底。（此前只有桌面入口调，网页版一直只有 CSS 星点兜底；
// 图源本就随 App 打进网页版包，这里只是补上"启动时写变量"这一步，不增加包体。）
applySpaceBg()
// 界面配色（2026-09-22 船长令）：与桌面入口同口径——首帧前把 `data-theme` 写上，避免先闪一下另一套配色。
// ⚠ 网页版有**自己的入口**：桌面入口改了这里也必须改（本批就漏过一次：探针在网页版读到 data-theme=null）。
bootstrapTheme()

const engine = new GameEngine()
const root = createRoot(document.getElementById('root')!)

root.render(<div className="app-loading">{tr('ui.main.001')}</div>)

engine
  .start()
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
