/**
 * 物品图标卡操作浮层（2026-09-05 船长：仓库/货仓图标模式也要能操作——点卡片弹浮层执行）。
 * 复用装配换装浮层的 app-fit-overlay / app-fit-modal 视觉族；内容由调用页提供（信息 + 操作按钮）。
 */
import type { ReactNode } from 'react'

export function ItemActionModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="app-fit-overlay" onClick={onClose}>
      <div className="app-fit-modal is-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="app-fit-modal-head">
          <span>物品操作</span>
          <button className="app-btn is-small" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
