/**
 * **高安点火前的二次警告**（**2026-09-30 船长令**：「且当玩家在高安使用时候，弹出二次警告，
 * 警告玩家这么做会被扣声望」）。
 *
 * 口径（船长「按你推荐来」）：扣**可支配声望 10 点**（`core.HIGH_SEC_PENALTY`）· 不足则 core 直接拒。
 * 形态 = **弹层**（照 `ui/ItemActionModal` 那一套壳：`.app-fit-overlay` ＋ `.app-fit-modal.is-narrow`），
 * 因为"会扣声望"这个后果要写清、还要有明确的「取消 / 仍然启动」两颗按钮
 * （技能口径 UX「Confirmation Dialogs（High）：Confirm before irreversible actions」）。
 *
 * 判据单点在 core：`beaconLaunchHighSecOf(state, ctx)`（此刻是否"在高安点火"）——四个使用入口共用。
 */
import type { ReactNode } from 'react'
import { tr } from '../i18n/locale'

export function BeaconHighSecPrompt({
  galaxyName,
  penalty,
  onCancel,
  onConfirm,
}: {
  /** 玩家此刻所在星系名（写进警告，玩家一眼知道"我在哪扣的") */
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
        <div className="app-dim app-beacon-warn">{tr('ui.beacon.007', { p1: galaxyName, p2: penalty })}</div>
        <div className="app-row-actions">
          <button className="app-btn is-small is-danger" onClick={onConfirm}>
            {tr('ui.beacon.009')}
          </button>
        </div>
      </div>
    </div>
  )
}
