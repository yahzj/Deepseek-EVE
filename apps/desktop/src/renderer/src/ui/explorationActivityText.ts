import type { ActivityView } from '@whale/core'
import { logText } from '../i18n/locale'

export function explorationActivityText(view: ActivityView): ActivityView {
  return {
    ...view,
    label: view.labelId ? logText({ text: view.label, textId: view.labelId, textParams: view.labelParams }) : view.label,
    sub: view.subId ? logText({ text: view.sub, textId: view.subId, textParams: view.subParams }) : view.sub,
    stopReason: view.stopReasonId ? logText({ text: view.stopReason ?? '', textId: view.stopReasonId }) : view.stopReason,
  }
}
