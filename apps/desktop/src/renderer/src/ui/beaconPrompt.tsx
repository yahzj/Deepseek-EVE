/**
 * **目标星系属高安时的二次警告**（**2026-09-30 船长令**：「且当玩家在高安使用时候，弹出二次警告，
 * 警告玩家这么做会被扣声望」）。
 *
 * 口径（船长「按你推荐来」）：扣**可支配声望 10 点**（`core.HIGH_SEC_PENALTY`）· 不足则 core 直接拒。
 * 形态 = **弹层**（照 `ui/ItemActionModal` 那一套壳：`.app-fit-overlay` ＋ `.app-fit-modal.is-narrow`），
 * 因为"会扣声望"这个后果要写清、还要有明确的「取消 / 仍然启动」两颗按钮
 * （技能口径 UX「Confirmation Dialogs（High）：Confirm before irreversible actions」）。
 *
 * 🔴 **2026-10-03 船长裁「乙」改判**：判据从"玩家所在地是高安"改成「**玩家选定的目标星系**属高安」
 * （`beaconLaunchHighSecOf(ctx, 目标 id)`，单点在 core）⇒ 现在**只有星图的星系详细**（有选定目标）
 * 会走到这个弹层；物品页/货仓页那条默认路（无选定目标）永远不弹。
 */
import type { ReactNode } from 'react'
import { tr } from '../i18n/locale'

export function BeaconHighSecPrompt({
  galaxyName,
  penalty,
  onCancel,
  onConfirm,
}: {
  /** **玩家选定的目标星系**名（2026-10-03 裁「乙」后写的是目标、不再写"玩家所在地"） */
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
