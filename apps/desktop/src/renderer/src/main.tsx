import { createRoot } from 'react-dom/client'
import { App } from './App'
import { GameEngine } from './game/engine'
import { prebootRenderer, startGameEngine } from './game/boot'
import { runAutoPerf } from './game/autoPerf'
import { L10nProvider, tr } from './i18n/locale'
import { SaveWriterGate } from './panels/SaveWriterGate'

prebootRenderer()

const engine = new GameEngine()
const root = createRoot(document.getElementById('root')!)

root.render(
  <div className="app-loading">{tr('ui.main.001')}</div>,
)

startGameEngine(engine)
  .then((started) => {
    if (!started) { root.render(<L10nProvider><SaveWriterGate /></L10nProvider>); return }
    const perfJson = window.__autoperf
    if (perfJson) {
      try {
        const spec = JSON.parse(perfJson) as Parameters<typeof runAutoPerf>[1]
        void import('./game/perf').then(({ perfHub }) => {
          perfHub.activate()
          root.render(
            <L10nProvider>
              <SaveWriterGate><App engine={engine} /></SaveWriterGate>
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
        <SaveWriterGate><App engine={engine} /></SaveWriterGate>
      </L10nProvider>,
    )
  })
  .catch((err: unknown) => {
    console.error(tr("ui.main.004"), err)
    root.render(
      <div className="app-loading">{tr('ui.main.002', { err: String(err) })}</div>,
    )
  })
