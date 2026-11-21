import type { ReactNode } from 'react'
import { tr } from '../i18n/locale'

export function BeaconHighSecPrompt({
  galaxyName,
  penalty,
  onCancel,
  onConfirm,
}: {
  galaxyName: string
  penalty: number
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  return (
    <div className="app-fit-overlay" onClick={onCancel}>
      <div className="app-fit-modal is-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="app-fit-head">
          <span className="app-fit-title">{tr('ui.beacon.006', { p1: penalty })}</span>
          <button className="app-btn is-small" onClick={onCancel}>
            {tr('ui.beacon.008')}
          </button>
        </div>
        {/* ⟪文案调整 2026-10-03⟫ 复用已批准的目标效果句，移除与指定高安落点相反的旧说明。 */}
        <div className="app-dim app-beacon-warn">{tr('ui.beacon.002', { p1: galaxyName })}</div>
        <div className="app-row-actions">
          <button className="app-btn is-small is-danger" onClick={onConfirm}>
            {tr('ui.beacon.009')}
          </button>
        </div>
      </div>
    </div>
  )
}
