import type { ReactNode } from 'react'
import { tr } from '../i18n/locale'

export function ItemActionModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="app-fit-overlay" onClick={onClose}>
      <div className="app-fit-modal is-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="app-fit-modal-head">
          <span>{tr("ui.ItemActionModal.001")}</span>
          <button className="app-btn is-small" onClick={onClose}>
            {tr("ui.FitPage.055")}
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
