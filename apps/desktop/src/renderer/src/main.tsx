import { createRoot } from 'react-dom/client'
import { App } from './App'
import { GameEngine } from './game/engine'
import { prebootRenderer, startGameEngine } from './game/boot'
import { runAutoPerf } from './game/autoPerf'
import { L10nProvider, tr } from './i18n/locale'
import { SaveWriterGate } from './panels/SaveWriterGate'
import { BootGate, bootFail, bootReportStage, bootStopWatch } from './boot/BootGate'

prebootRenderer()

const engine = new GameEngine()
const root = createRoot(document.getElementById('root')!)

bootReportStage('sync')
root.render(<BootGate />)

startGameEngine(engine, { onStage: bootReportStage })
  .then((started) => {
    bootReportStage('bridge')
    bootStopWatch()
    if (!started) {
      root.render(<L10nProvider><SaveWriterGate code="SG-05" /></L10nProvider>)
      return
    }
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
    bootFail('SG-FF', err instanceof Error ? err.message : String(err))
  })
