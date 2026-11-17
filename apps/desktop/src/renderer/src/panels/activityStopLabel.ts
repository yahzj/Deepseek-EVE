import type { ActivityView } from '@whale/core'
import { tr, cmdText } from '../i18n/locale'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'

export function doStop(v: ActivityView, engine: GameEngine, onToast: ToastFn): void {
  const run = (r: { ok: boolean; error?: string; errorId?: string; errorParams?: Record<string, string | number> } | boolean, okText: string): void => {
    const ok = typeof r === 'boolean' ? r : r.ok
    if (!ok) onToast((typeof r === 'object' && (cmdText(r) || r.error)) || tr('ui.ActivityBar.061'), true)
    else onToast(okText)
  }
  switch (v.stop) {
    case 'cancel-station-pending':
      run(engine.cancelPendingStationActivityNow(), tr('ui.ActivityBar.004'))
      break
    case 'remove-training':
      run(engine.dequeueAt(0), tr("ui.ActivityBar.038"))
      break
    case 'stop-mining':
      run(engine.stopMiningNow(), tr("ui.MapPage.080"))
      break
    case 'stop-scan':
      run(engine.stopScanNow(), tr("ui.ActivityBar.039"))
      break
    case 'stop-whscan':
      run(engine.wormholeScanStop(), tr("ui.ActivityBar.040"))
      break
    case 'stop-whauto':
      if (v.stopParam) run(engine.wormholeAutoStop(v.stopParam), tr("ui.ActivityBar.041"))
      break
    case 'stop-salvage':
      run(engine.stopSalvageOpNow(), tr("ui.ActivityBar.042"))
      break
    case 'cancel-manufacture':
      if (v.stopParam) run(engine.cancelManufacturingAt(v.stopParam), tr("ui.ActivityBar.043"))
      break
    case 'stop-refine':
      if (v.stopParam) run(engine.stopRefineRunAt(v.stopParam), tr("ui.ActivityBar.044"))
      break
    case 'stop-lab':
      if (v.stopParam) run(engine.stopLabRunAt(v.stopParam), tr("ui.ActivityBar.068"))
      break
    case 'recall-expedition':
      run(engine.recallExpeditionNow(), tr("ui.ActivityBar.045"))
      break
    case 'recall-standby':
      run(engine.recallStandbyNow(), tr("ui.ActivityBar.046"))
      break
    case 'retreat-battle':
      run(engine.retreatNow(), tr("ui.ActivityBar.047"))
      break
    case 'cancel-ai':
      if (v.stopParam) run(engine.cancelAiTaskAt(v.stopParam), tr("ui.ShipPage.177"))
      break
    case 'cancel-deliver-trip':
      run(engine.cancelDeliverTripNow(), tr("ui.ActivityBar.048"))
      break
    case 'stop-loop':
      run(engine.bountyLoopAt(null), tr("ui.ActivityBar.049"))
      break
    case 'stop-invasion-loop':
      run(engine.invasionLoopAt(null), tr('core.weekend.034'))
      break
    case 'stop-hauling':
      {
        const fromSiteId = engine.state?.hauling?.fromSiteId
        const fromName = fromSiteId ? engine.ctx?.stations.get(fromSiteId)?.name ?? fromSiteId : tr('ui.Expedition.007')
        run(engine.stopHaulingNow(), tr(engine.state?.encounter?.active ? 'ui.industrial.008' : 'core.hauling.019', { p1: fromName }))
      }
      break
  }
}

export function stopLabel(v: ActivityView): string {
  switch (v.stop) {
    case 'cancel-station-pending':
      return tr('ui.ActivityBar.004')
    case 'remove-training':
      return tr('ui.ActivityBar.007')
    case 'stop-mining':
      return tr('ui.ActivityBar.005')
    case 'stop-scan':
      return tr('ui.ActivityBar.008')
    case 'stop-whscan':
      return tr('ui.ActivityBar.031')
    case 'stop-whauto':
      return tr('ui.ActivityBar.009')
    case 'stop-salvage':
      return tr('ui.ActivityBar.005')
    case 'cancel-manufacture':
      return tr('ui.ActivityBar.004')
    case 'stop-refine':
      return tr('ui.ActivityBar.010')
    case 'stop-lab':
      return tr('ui.hud.084')
    case 'recall-expedition':
      return tr('ui.ActivityBar.009')
    case 'recall-standby':
      return tr('ui.ActivityBar.011')
    case 'retreat-battle':
      return tr('ui.ActivityBar.012')
    case 'cancel-ai':
      return tr('ui.ActivityBar.004')
    case 'cancel-deliver-trip':
      return tr('ui.ActivityBar.013')
    case 'stop-loop':
    case 'stop-invasion-loop':
      return tr('ui.ActivityBar.032')
    case 'stop-hauling':
      return tr('ui.ActivityBar.014')
    default:
      return ''
  }
}
